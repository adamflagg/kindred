// Package lodging enforces the weekend-lodging invariants that the database
// does not.
//
// PocketBase blocks deleting a record behind a REQUIRED relation, but
// lodging_assignments.unit and .merge are both optional. Deleting their
// target therefore returns HTTP 204 and leaves the assignment pointing at
// nothing — a placement with no cabin, invisible to every read. Two spec
// rules depend on stopping that:
//
//	§3.4 unmerging is blocked while the slot is occupied
//	§3.8 deactivate, don't delete, for units with historical assignments
//
// lodging_ingest_issues.resolved_alias is the same shape and the worst case:
// deleting the alias behind a RESOLVED queue item silences that item forever,
// because ingest only ever writes is_resolved on create. See guardAliasDelete.
//
// None of these has any database backing, so they all live here. So does the
// dual-grain XOR: the DB currently accepts an assignment with neither unit nor
// merge, with both, and with both household_cm_id and person_cm_id set.
//
// These are MODEL-level hooks (OnRecordDelete / OnRecordCreate /
// OnRecordUpdate), not the *Request variants, so they cover programmatic Go
// writes as well as HTTP API calls.
package lodging

import (
	"fmt"
	"log/slog"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"

	"github.com/camp/kindred/pocketbase/sync"
)

const (
	collectionUnits        = "lodging_units"
	collectionMerges       = "lodging_merges"
	collectionAssignments  = "lodging_assignments"
	collectionAliases      = "lodging_unit_aliases"
	collectionIngestIssues = "lodging_ingest_issues"
)

// RegisterHooks wires the lodging integrity guards onto the app.
func RegisterHooks(app *pocketbase.PocketBase) {
	wireHooks(app)
	slog.Info("lodging integrity hooks registered")
}

// wireHooks binds the guards to any core.App. Extracted so the test suite,
// which uses *tests.TestApp rather than *pocketbase.PocketBase, shares one
// binding implementation with production.
func wireHooks(app core.App) {
	app.OnRecordDelete(collectionUnits).BindFunc(guardUnitDelete)
	app.OnRecordDelete(collectionMerges).BindFunc(guardMergeDelete)
	app.OnRecordDelete(collectionAliases).BindFunc(guardAliasDelete)
	app.OnRecordCreate(collectionAssignments).BindFunc(guardAssignmentGrain)
	app.OnRecordUpdate(collectionAssignments).BindFunc(guardAssignmentGrain)
	app.OnRecordUpdate(collectionUnits).BindFunc(guardUnitParentCycle)
	app.OnRecordAfterUpdateSuccess(collectionIngestIssues).BindFunc(replayOnResolve)
}

// countAssignments counts lodging_assignments rows whose `field` points at id.
func countAssignments(app core.App, field, id string) (int, error) {
	records, err := app.FindRecordsByFilter(
		collectionAssignments,
		fmt.Sprintf("%s = {:id}", field),
		"",
		0, // 0 = unlimited
		0,
		map[string]any{"id": id},
	)
	if err != nil {
		return 0, fmt.Errorf("count %s assignments: %w", field, err)
	}
	return len(records), nil
}

// guardUnitDelete refuses to delete a unit that still has placements.
//
// Deactivating instead (is_active = false) keeps 2022-2025 history
// resolvable, which is exactly why the field exists.
func guardUnitDelete(e *core.RecordEvent) error {
	count, err := countAssignments(e.App, "unit", e.Record.Id)
	if err != nil {
		return err
	}
	if count > 0 {
		return apis.NewBadRequestError(
			fmt.Sprintf(
				"Cannot delete %q: %d lodging assignment(s) reference it. "+
					"Set it inactive instead so historical placements stay resolvable.",
				e.Record.GetString("name"),
				count,
			),
			nil,
		)
	}
	return e.Next()
}

// guardMergeDelete refuses to unmerge an occupied slot.
//
// Deliberately STRICTER than spec §3.4's "more than one party": deleting a
// merge with exactly one occupant orphans that placement through the same
// optional-relation hole, so one occupant blocks too. The message
// distinguishes the cases so staff know what to do next.
func guardMergeDelete(e *core.RecordEvent) error {
	count, err := countAssignments(e.App, "merge", e.Record.Id)
	if err != nil {
		return err
	}
	if count > 1 {
		return apis.NewBadRequestError(
			fmt.Sprintf(
				"Cannot unmerge %q: %d parties occupy this slot. Move them to separate units first.",
				e.Record.GetString("display_name"),
				count,
			),
			nil,
		)
	}
	if count == 1 {
		return apis.NewBadRequestError(
			fmt.Sprintf(
				"Cannot unmerge %q: one party is assigned to this slot. "+
					"Reassign or clear that placement first, or it would be left with no cabin.",
				e.Record.GetString("display_name"),
			),
			nil,
		)
	}
	return e.Next()
}

// guardAliasDelete refuses to delete an alias a resolved queue item points at.
//
// This is the third optional-relation hole, and the worst of them, because it
// fails SILENTLY and PERMANENTLY rather than merely orphaning a row.
// `lodging_ingest_issues.resolved_alias` is declared cascadeDelete:false on
// purpose (migration 1500000122) so deleting an alias does not destroy the
// audit trail of it having been created. What that leaves behind is a queue
// row still marked is_resolved.
//
// IssueRecorder.Flush (sync/lodging_issues.go) writes is_resolved only on
// CREATE — "once staff tick an item, a later sync must not un-tick it" — and
// findExisting matches the re-encountered cabin string on the same six
// columns. So the next ingest run finds that row, bumps occurrences, and
// leaves it resolved. The string never returns to the work queue, and the
// placement never resolves again. Nothing surfaces it.
//
// The admin UI reopens the queue row before deleting, which clears the
// reference and restores the work item. This guard is the backstop for every
// path that does not: the PocketBase admin UI, and Go.
func guardAliasDelete(e *core.RecordEvent) error {
	records, err := e.App.FindRecordsByFilter(
		collectionIngestIssues,
		"resolved_alias = {:id}",
		"",
		0, // 0 = unlimited
		0,
		map[string]any{"id": e.Record.Id},
	)
	if err != nil {
		return fmt.Errorf("count issues resolved by alias: %w", err)
	}
	if len(records) > 0 {
		return apis.NewBadRequestError(
			fmt.Sprintf(
				"Cannot delete the alias %q: %d resolved work-queue item(s) point at it. "+
					"Reopen those items first, or the cabin name they resolved would "+
					"stop resolving without ever returning to the queue.",
				e.Record.GetString("alias_string"),
				len(records),
			),
			nil,
		)
	}
	return e.Next()
}

// guardAssignmentGrain enforces the two XOR invariants on an assignment.
//
//	unit XOR merge                    -- a placement is in a room or a merged slot
//	household_cm_id XOR person_cm_id  -- family camp is household-grain,
//	                                     adult weekends are person-grain, and a
//	                                     person row OVERRIDES its household's row
//
// The cm_id checks use "> 0" rather than a non-empty test: PocketBase
// declares number columns NUMERIC DEFAULT 0 NOT NULL, so an unset id is 0.
func guardAssignmentGrain(e *core.RecordEvent) error {
	hasUnit := e.Record.GetString("unit") != ""
	hasMerge := e.Record.GetString("merge") != ""
	if hasUnit == hasMerge {
		return apis.NewBadRequestError(
			"A lodging assignment must reference exactly one of unit or merge.",
			nil,
		)
	}

	hasHousehold := e.Record.GetInt("household_cm_id") > 0
	hasPerson := e.Record.GetInt("person_cm_id") > 0
	if hasHousehold == hasPerson {
		return apis.NewBadRequestError(
			"A lodging assignment must set exactly one of household_cm_id or person_cm_id.",
			nil,
		)
	}

	return e.Next()
}

// guardUnitParentCycle rejects a parent_unit write that would close a loop
// (#1899). The frontend picker already filters these (unitTree.ts); this is
// the backstop for a direct write, which 1500000130 widened who can make.
func guardUnitParentCycle(e *core.RecordEvent) error {
	parentID := e.Record.GetString("parent_unit")
	if parentID == "" {
		return e.Next()
	}
	// Judge the WRITE, not the stored state. A unit already on a cycle -- data
	// predating this hook, which it cannot un-write -- would otherwise fail
	// every edit that leaves parent_unit alone, including Confirm and
	// Deactivate, with a message about a loop the write did not create. Bulk
	// confirm would report a partial failure with no way to see why.
	//
	// Original() is blank on create, and a create cannot close a cycle (a new
	// record has no descendants), so comparing "" to a real parent id there
	// simply means the check runs -- harmless, and the create binding is
	// deliberately absent anyway.
	if e.Record.Original().GetString("parent_unit") == parentID {
		return e.Next()
	}
	tree, err := sync.BuildUnitTree(e.App)
	if err != nil {
		return fmt.Errorf("checking for a parent cycle: %w", err)
	}
	if sync.HasParentCycle(tree, e.Record.Id, parentID) {
		return apis.NewBadRequestError(
			"That parent would create a loop in the unit tree.", nil)
	}
	return e.Next()
}

// replayOnResolve materializes the placement behind a queue row the moment
// staff resolve it, instead of leaving it for the next 8-10 minute sync.
//
// AfterUpdateSuccess, not Update: replay reads the alias the resolve just
// created, so it must run after the transaction commits.
//
// Two entry points, because the queue has two row shapes. A party-scoped row
// (no_session, ambiguous_session, write_failed) replays one
// placement. A party-LESS row (unresolved_alias, ambiguous_alias) stands for a
// cabin string rather than a party -- the dedup key collapses it that way on
// purpose -- so it fans out over every party that wrote the string. Routing
// both through ReplayIssue would silently no-op on the commonest case.
//
// ROUTING IS NOT TOTAL. The party guards are complements, so no row is accepted
// by both -- but some rows are accepted by NEITHER. ReplayPartylessIssue
// refuses field_zero_values, an empty raw_value, and an unregistered
// source_field, and ReplayIssue has no counterpart for any of them. There is a
// real open field_zero_values row in the production database today. So this
// hook must SURFACE the refusal rather than assume every resolved row replays,
// and Task 7 must not offer a replay control on a row nothing will accept.
//
// A fourth case this hook refuses on its own, before either entry point sees
// it: an unresolved_alias/ambiguous_alias row resolved with resolved_alias
// still empty, which is what ignoreIngestIssue writes for "not a cabin name."
// ReplayPartylessIssue itself accepts those two kinds unconditionally, so
// without this check a fan-out over every party who wrote the string would
// re-fail identically for all of them and reopenRecorded would undo the
// ignore. field_zero_values and unknown_party stay untouched by this check --
// their own refusal inside ReplayPartylessIssue must still surface.
//
// A replay failure must NOT fail the resolve. Staff corrected the registry and
// that correction is valid regardless; the placement can be picked up by the
// next sync. Log and continue.
//
// Gated on the TRANSITION to resolved, not merely on being resolved: Flush
// (sync/lodging_issues.go) re-saves an already-resolved row every time a
// replay re-hits the same blocker -- occurrences and last_seen move,
// is_resolved does not, by design, since a later sync must not un-tick what
// staff ticked. That re-save is itself an update on this collection. Gating on
// the current value alone means this hook fires on its own re-save, replays
// again, re-saves again -- unbounded, and each level pays a full replay scope
// (~1-2s). reopenRecorded would break the cycle by clearing is_resolved, but
// it runs only after Flush returns, and Flush never returns from inside this
// call chain. Original() holds the record's state as loaded, before this
// write -- so this only proceeds on a genuine false -> true transition.
func replayOnResolve(e *core.RecordEvent) error {
	wasResolved := e.Record.Original().GetBool("is_resolved")
	isResolved := e.Record.GetBool("is_resolved")
	if wasResolved || !isResolved {
		return e.Next()
	}
	partyScoped := e.Record.GetInt("household_cm_id") > 0 ||
		e.Record.GetInt("person_cm_id") > 0

	// An unresolved_alias/ambiguous_alias row resolved with no resolved_alias
	// is an IGNORE, not a mapping: ignoreIngestIssue (frontend/src/services/
	// lodgingCrud.ts) deliberately leaves resolved_alias empty -- that
	// emptiness is what distinguishes an ignored row from a mapped one, per
	// its own doc comment. mapUnresolvedAlias always sets it, so this does not
	// touch the real mapping path.
	//
	// Scoped to those two kinds specifically, not "any party-less row with no
	// resolved_alias": field_zero_values and unknown_party are ALSO
	// party-less and ALSO never carry a resolved_alias, but their refusal has
	// to keep reaching ReplayPartylessIssue so it surfaces (see
	// TestReplayRefusalDoesNotBlockTheTick) -- resolved_alias means nothing
	// for those two kinds, so treating its emptiness as an ignore marker
	// there would swallow a refusal this hook is supposed to log.
	//
	// Fanning a replay out over every party who wrote this string when no
	// alias resolves it can only re-fail identically for every one of them:
	// ReplayPartylessIssue accepts unresolved_alias/ambiguous_alias
	// unconditionally, so with nothing to skip on, ingestValue re-records the
	// same collapsed issue, Flush writes it onto the row staff just ticked,
	// and reopenRecorded flips is_resolved back to false -- undoing the
	// ignore, after paying a full fan-out (a whole-year session index plus
	// one ingestValue per party) for it, and risking a fresh
	// no_session/ambiguous_session row for any of those parties' unrelated
	// attribution failures as a side effect.
	//
	// Party-SCOPED rows are untouched by this check: resolved_alias means
	// nothing for them either way.
	kind := e.Record.GetString("kind")
	isPartylessAliasKind := kind == "unresolved_alias" || kind == "ambiguous_alias"
	if !partyScoped && isPartylessAliasKind && e.Record.GetString("resolved_alias") == "" {
		return e.Next()
	}

	var err error
	if partyScoped {
		var res sync.ReplayResult
		res, err = sync.ReplayIssue(e.App, e.Record.Id)
		if err == nil && !res.Placed {
			e.App.Logger().Info("Replay placed nothing; row re-opened",
				"issue", e.Record.Id, "blockers", res.Blockers)
		}
	} else {
		var placed int
		placed, err = sync.ReplayPartylessIssue(e.App, e.Record.Id)
		if err == nil {
			e.App.Logger().Info("Party-less replay finished",
				"issue", e.Record.Id, "placed", placed)
		}
	}
	if err != nil {
		e.App.Logger().Warn("Replaying a resolved lodging issue",
			"issue", e.Record.Id, "party_scoped", partyScoped, "error", err)
	}
	return e.Next()
}
