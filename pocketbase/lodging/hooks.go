// Package lodging enforces the weekend-lodging invariants that the database
// does not.
//
// PocketBase blocks deleting a record behind a REQUIRED relation, but a
// placement's `units` is optional and cascadeDelete:false (1500000134).
// Deleting a unit therefore returns HTTP 204 and PocketBase's own cleanup
// quietly strips that id out of every placement holding it, re-saving each row
// unvalidated — deleteRefRecords, core/record_model.go. A party in a two-room
// slot silently loses a room; a party in one room is left with no cabin at all,
// invisible to every read. Two spec rules depend on stopping that:
//
//	§3.4 an occupied slot cannot have a room taken out from under it
//	§3.8 deactivate, don't delete, for units with historical assignments
//
// lodging_ingest_issues.resolved_alias is the same shape and the worst case:
// deleting the alias behind a RESOLVED queue item silences that item forever,
// because ingest only ever writes is_resolved on create. See guardAliasDelete.
//
// None of these has any database backing, so they all live here. So does the
// dual grain: the DB accepts a confirmed assignment naming no unit at all, and
// one with both household_cm_id and person_cm_id set.
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
	collectionUnits            = "lodging_units"
	collectionAreas            = "lodging_areas"
	collectionAssignments      = "lodging_assignments"
	collectionAssignmentsDraft = "lodging_assignments_draft"
	collectionAliases          = "lodging_unit_aliases"
	collectionIngestIssues     = "lodging_ingest_issues"
	collectionAvailability     = "lodging_availability"
	collectionSlotMerges       = "lodging_slot_merges"
)

// yearScopedRef is one relation the year guard follows: the field to read on
// the row, and the collection its ids resolve in. A SLICE of these rather than
// a field->collection map, because map iteration is randomized and
// lodging_units is the first entry carrying two relations -- a row cross-year
// on both would otherwise name a different field on every run.
type yearScopedRef struct {
	field  string
	target string
}

// yearScopedRefs are the collections carrying BOTH a year of their own and a
// relation into a year-scoped registry table. Once the registry is year-scoped
// (1500000141 gives lodging_units AND lodging_areas their own `year`, making
// (code, year) a distinct record) those two years can disagree -- a 2027 row
// pointing at a 2026 building -- a state that was unrepresentable before and
// that nothing in the database prevents.
//
// lodging_units is here as of kindred#2039 and is the odd one out twice over:
// it is both a referencing and a referenced table, and its `area` resolves in
// lodging_areas rather than in itself. Neither of its relations is reachable
// cross-year from the Kindred UI -- both pickers are fed year-scoped lists
// (unitTree.ts, and the area select from the year-scoped areas query) -- but
// 1500000130 widened create/update on lodging_units to bunking.manage, so the
// admin UI and a direct REST write both reach it.
//
// lodging_assignment_history is deliberately absent: it stores old_unit /
// new_unit as TEXT so an unresolvable historical string is still recorded
// (1500000119). It cannot express this bug and must not be given a relation
// to "fix" it.
//
// wireHooks binds only to the collections it can actually find, so a table
// that is absent in an older environment -- or removed in a future one --
// logs a warning instead of taking the boot down.
//
// SCOPE: this guard is one-directional. It checks the row being written
// against the OUTGOING relations listed in its own entry above; it never
// re-checks rows elsewhere that point back AT the thing just written. Two
// gaps follow, both residual as of kindred#2039, not regressions:
//
//   - lodging_areas is a valid TARGET above (lodging_units.area resolves into
//     it) but is not itself a key in this map, so it carries no binding at
//     all. A superuser or bunking.manage PATCH that edits an existing area
//     row's own `year` in place hits no check, and every lodging_units row
//     already pointing at that area -- written for whatever year it was
//     created -- is now silently cross-season.
//   - Editing a lodging_units row's own `year` is checked against that row's
//     OWN area/parent_unit, but nothing re-validates the rows that point AT
//     it: lodging_availability, lodging_assignments,
//     lodging_assignments_draft, lodging_slot_merges. Those keep whatever
//     year they were written with, now possibly disagreeing with the unit's
//     new one.
//
// Closing either gap means cascading to every DEPENDENT row on a parent's
// write, not validating only the row under write -- a materially bigger
// change than this guard makes anywhere else, so it is not done here.
var yearScopedRefs = map[string][]yearScopedRef{
	collectionAvailability:     {{field: "unit", target: collectionUnits}},
	collectionAssignments:      {{field: "units", target: collectionUnits}},
	collectionAssignmentsDraft: {{field: "units", target: collectionUnits}},
	collectionSlotMerges:       {{field: "unit", target: collectionUnits}},
	collectionUnits: {
		{field: "area", target: collectionAreas},
		{field: "parent_unit", target: collectionUnits},
	},
}

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
	app.OnRecordDelete(collectionAliases).BindFunc(guardAliasDelete)
	app.OnRecordCreate(collectionAssignments).BindFunc(guardAssignmentGrain)
	app.OnRecordUpdate(collectionAssignments).BindFunc(guardAssignmentGrain)
	app.OnRecordCreate(collectionAssignmentsDraft).BindFunc(guardDraftAssignmentGrain)
	app.OnRecordUpdate(collectionAssignmentsDraft).BindFunc(guardDraftAssignmentGrain)
	app.OnRecordUpdate(collectionUnits).BindFunc(guardUnitParentCycle)
	app.OnRecordAfterUpdateSuccess(collectionIngestIssues).BindFunc(replayOnResolve)

	// Bind only to collections that actually exist -- a future table removal
	// must not take the boot down, so this checks rather than assumes before
	// binding (see yearScopedRefs).
	for name := range yearScopedRefs {
		if _, err := app.FindCollectionByNameOrId(name); err != nil {
			// app.Logger(), not the package-level slog: the latter's default
			// handler writes to stderr, invisible to captureStdout (the only
			// way this test suite can observe a log line -- see its doc
			// comment), and would leave this skip path untested rather than
			// merely undocumented.
			app.Logger().Warn("year guard skipped: collection absent", "collection", name)
			continue
		}
		app.OnRecordCreate(name).BindFunc(func(e *core.RecordEvent) error {
			if err := guardUnitYear(e.App, e.Record); err != nil {
				return apis.NewBadRequestError(err.Error(), nil)
			}
			return e.Next()
		})
		app.OnRecordUpdate(name).BindFunc(func(e *core.RecordEvent) error {
			if err := guardUnitYear(e.App, e.Record); err != nil {
				return apis.NewBadRequestError(err.Error(), nil)
			}
			return e.Next()
		})
	}
}

// guardUnitYear refuses a row whose own year disagrees with any registry row
// it names, for every collection in yearScopedRefs.
//
// A multi-valued relation (`units`, maxSelect 20, added to the placement
// tables by 1500000134 when lodging_merges was folded in) has every element
// checked, not just the first -- it is the column lodging_assignments_sync.go
// writes, and therefore exactly the one a stale alias resolution would
// corrupt. GetStringSlice reads a single relation (`unit`) as a one-element
// slice, so one loop over yearScopedRefs[collection] covers both shapes.
func guardUnitYear(app core.App, rec *core.Record) error {
	refs, watched := yearScopedRefs[rec.Collection().Name]
	if !watched {
		return nil
	}
	rowYear := rec.GetInt("year")
	if rowYear == 0 {
		return nil // required elsewhere; not this guard's complaint to make
	}

	for _, ref := range refs {
		for _, id := range rec.GetStringSlice(ref.field) {
			// A row cannot disagree with ITSELF about its own year, and
			// lodging_units is the only table that can name itself
			// (parent_unit is a self-relation). Two failures without this:
			// on update FindRecordById returns the STORED row, so editing a
			// self-parented row's year would be refused naming the row itself;
			// on create the id is autogenerated inside e.Next(), AFTER this
			// runs, so an explicitly-self-parenting create resolves to a row
			// that does not exist yet and fails with a lookup error instead.
			// Inert everywhere else: GetStringSlice never yields an empty id,
			// so this never accidentally matches a blank rec.Id on create.
			if id == rec.Id {
				continue
			}
			target, err := app.FindRecordById(ref.target, id)
			if err != nil {
				return fmt.Errorf("resolving %s %q: %w", ref.field, id, err)
			}
			if targetYear := target.GetInt("year"); targetYear != rowYear {
				return fmt.Errorf(
					"%s row is for year %d but its %s relation names %q from year %d",
					rec.Collection().Name, rowYear, ref.field,
					target.GetString("code"), targetYear)
			}
		}
	}
	return nil
}

// countAssignments counts the placements holding this unit, across BOTH grains.
//
// The draft table is not optional here (kindred#1923(a)). A scenario's
// placements are exactly the rows a unit delete would empty, and the person
// deleting the unit from /manage/lodging is typically not the person who made
// them, so counting the confirmed board alone leaves the case with the LEAST
// oversight unguarded.
//
// THE FILTER STRING IS LOAD-BEARING IN BOTH HALVES, and neither half is
// guessable. TestMultiRelationAnyMatchFilter pins both against the running
// engine, having measured them rather than assumed:
//
//   - `.id` is what makes PocketBase join into lodging_units at all. A bare
//     "units ?= {:id}" compares against the field's raw stored value and
//     matches ZERO rows against a real id.
//   - `?=` is required once `.id` is in play, because under that join plain
//     `=` demands EVERY joined row equal the operand — meaningless for a slot
//     of two rooms, and again zero rows.
//
// Either mistake returns 0 for a unit that is in fact occupied, and a delete
// guard that counts 0 refuses nothing. That failure is silent in exactly the
// direction that matters, which is why it is pinned by a test rather than left
// to this comment.
func countAssignments(app core.App, unitID string) (int, error) {
	total := 0
	for _, collection := range []string{collectionAssignments, collectionAssignmentsDraft} {
		records, err := app.FindRecordsByFilter(
			collection,
			"units.id ?= {:id}",
			"",
			0, // 0 = unlimited
			0,
			map[string]any{"id": unitID},
		)
		if err != nil {
			return 0, fmt.Errorf("count %s holding unit %s: %w", collection, unitID, err)
		}
		total += len(records)
	}
	return total, nil
}

// guardUnitDelete refuses to delete a unit that still holds placements.
//
// Nothing below this stops the damage. `units` is cascadeDelete:false by
// design — deleting a unit must not take a placement row with it — so
// PocketBase's cleanup removes this id FROM each holding set and re-saves the
// row with SaveNoValidate. A two-room slot silently becomes a one-room slot; a
// one-room placement silently becomes a placement with no cabin. Neither
// surfaces anywhere, which is why the refusal has to happen here.
//
// This subsumes the old guardMergeDelete and spec §3.4 with it: a merged slot
// is now a placement whose set has two or more members, so "don't break up an
// occupied merge" and "don't delete an occupied unit" are the same sentence.
//
// Deactivating instead (is_active = false) keeps 2022-2025 history resolvable,
// which is exactly why that field exists.
func guardUnitDelete(e *core.RecordEvent) error {
	count, err := countAssignments(e.App, e.Record.Id)
	if err != nil {
		return err
	}
	if count > 0 {
		return apis.NewBadRequestError(
			fmt.Sprintf(
				"Cannot delete %q: %d lodging placement(s) reference it, on the "+
					"confirmed board or in a saved scenario. Set it inactive instead "+
					"so historical placements stay resolvable.",
				e.Record.GetString("name"),
				count,
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

// guardAssignmentGrain enforces the two invariants on a CONFIRMED assignment.
//
//	units non-empty                   -- a placement names at least one room
//	household_cm_id XOR person_cm_id  -- family camp is household-grain,
//	                                     adult weekends are person-grain, and a
//	                                     person row OVERRIDES its household's row
//
// The target half was "unit XOR merge" until 1500000134 collapsed both columns
// into `units`. Its intent survives; its shape could not. A merged slot is now
// a set of two or more and is indistinguishable from any other placement, so
// the only illegal target state left is a set holding NOTHING. This mirrors
// sync.ValidateAssignmentGrain's ErrGrainNoPlacement for the writes that never
// reach the sync package: a POST straight at the PocketBase REST API, and
// 1500000134's own backfill.
//
// THAT BACKFILL RUNS UNDER THIS FUNCTION on the deploy that ships it, and must
// pass. app.saveNoValidate() does not exempt it: withValidations skips FIELD
// validation only, and Save and SaveNoValidate both reach BaseApp.save, which
// fires OnRecordUpdate either way. The backfill writes exactly one shape — a
// non-empty units set on a row whose party grain the database already held —
// and it is legal here. If that ever stops being true the migration throws,
// every pending migration rolls back with it, and the container crash-loops on
// boot with no override. TestABackfillShapedRowPassesTheGrainGuard pins it.
//
// The cm_id checks use "> 0" rather than a non-empty test: PocketBase
// declares number columns NUMERIC DEFAULT 0 NOT NULL, so an unset id is 0.
func guardAssignmentGrain(e *core.RecordEvent) error {
	if len(e.Record.GetStringSlice("units")) == 0 {
		return apis.NewBadRequestError(
			"A lodging assignment must reference at least one lodging unit.",
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

// guardDraftAssignmentGrain enforces the PARTY GRAIN on lodging_assignments_draft:
//
//	household_cm_id XOR person_cm_id
//
// and deliberately nothing else. 1500000132 grants bunking.manage create and
// update on this table, so a write can arrive straight at the PocketBase REST
// API without passing through PartyGrainRequest._exactly_one_grain in the
// FastAPI schemas — the same reason guardUnitParentCycle exists for the write
// access 1500000130 widened.
//
// It is a SEPARATE function from guardAssignmentGrain rather than the same one
// re-bound, because the target rule differs and must: guardAssignmentGrain
// rejects an EMPTY units set (1500000134) and this one tolerates it. That
// tolerance used to be a feature — the empty set was the draft's tombstone,
// "staff took this party off the board" — and kindred#1974 retired the
// tombstone by making a scenario REPLACE the mirror instead of overlaying it,
// so an empty set now means only that the row places nobody. The API refuses
// to create one: PlacementWriteRequest.unit_ids requires at least one member,
// and unplacing a party DELETES its row.
//
// The tolerance stays anyway, and rejecting the empty set here would break two
// live paths rather than tighten one:
//
//   - 1500000134's backfill saves the party grain first and the units second
//     (TestABackfillShapedDraftRowPassesTheGrainGuard), so a guard on units
//     would fail the first save, roll back every pending migration, and
//     crash-loop the boot.
//   - deleteRefRecords empties `units` on every placement holding a deleted
//     unit and re-saves the row. A guard here would turn that into an error on
//     a path PocketBase owns.
//
// That the collapse touched only the target half is also why this function's
// BODY needed no edit for 1500000134: it reads the party columns and nothing
// else, and those are untouched.
//
// A row naming neither grain is what makes this worth guarding: it keys on
// nothing, so both partial unique indexes (gated on `> 0`) skip it and it
// dedupes against nothing, while placement_grain in the roster service
// silently drops it. The row accumulates and does nothing, invisibly.
func guardDraftAssignmentGrain(e *core.RecordEvent) error {
	hasHousehold := e.Record.GetInt("household_cm_id") > 0
	hasPerson := e.Record.GetInt("person_cm_id") > 0
	if hasHousehold == hasPerson {
		return apis.NewBadRequestError(
			"A draft lodging assignment must set exactly one of household_cm_id or person_cm_id.",
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
