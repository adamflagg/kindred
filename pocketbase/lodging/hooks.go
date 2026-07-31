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
