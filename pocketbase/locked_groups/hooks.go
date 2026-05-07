// Package lockedgroups provides PocketBase hooks for the locked_groups and
// locked_group_members collections.
//
// Constraint: a camper (attendee + year) may belong to at most one locked
// friend group per scenario. Both a DB UNIQUE index on a generated scenario
// column AND this app-level hook enforce the constraint; the hook provides a
// friendly 409 error message naming the conflicting group.
package lockedgroups

import (
	"fmt"
	"log/slog"
	"net/http"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
)

// RegisterHooks wires the one-group-per-camper-per-scenario guard onto the
// locked_group_members collection.
func RegisterHooks(app *pocketbase.PocketBase) {
	wireHooks(app)
	slog.Info("locked_group_members one-group-per-camper hooks registered")
}

// wireHooks accepts core.App so tests (which use *tests.TestApp) can reuse it.
func wireHooks(app core.App) {
	// Guard both create and update operations.
	app.OnRecordCreate("locked_group_members").BindFunc(func(e *core.RecordEvent) error {
		if err := checkUniqueGroupPerScenario(e.App, e.Record, ""); err != nil {
			return err
		}
		return e.Next()
	})

	app.OnRecordUpdate("locked_group_members").BindFunc(func(e *core.RecordEvent) error {
		if err := checkUniqueGroupPerScenario(e.App, e.Record, e.Record.Id); err != nil {
			return err
		}
		return e.Next()
	})
}

// checkUniqueGroupPerScenario queries whether the attendee already belongs to
// a different locked group within the same scenario and year. If so it returns
// a 409 ApiError with a human-readable message naming the existing group.
//
// excludeID is the ID of the record being updated (so a member row can be
// re-saved without conflicting with itself). Pass "" for new records.
func checkUniqueGroupPerScenario(app core.App, record *core.Record, excludeID string) error {
	groupID := record.GetString("group")
	attendeeID := record.GetString("attendee")

	if groupID == "" || attendeeID == "" {
		// Incomplete record — let normal validation handle it.
		return nil
	}

	// Resolve the parent group to get its scenario ID.
	parentGroup, err := app.FindRecordById("locked_groups", groupID)
	if err != nil {
		// Group not found; let normal validation reject the foreign-key violation.
		return nil //nolint:nilerr
	}
	scenarioID := parentGroup.GetString("scenario")
	if scenarioID == "" {
		return nil
	}

	// Find all groups in the same scenario — we'll then check if any of those
	// groups already contain this attendee/year combination.
	//
	// Two-step approach because the Go test app's SQLite engine handles simple
	// IN expressions more reliably than join-based filter dot-notation.
	siblingsGroups, err := app.FindAllRecords("locked_groups",
		dbx.HashExp{"scenario": scenarioID},
	)
	if err != nil {
		slog.Error("locked_group uniqueness check: failed to list sibling groups", "error", err)
		return nil
	}

	// Build the list of sibling group IDs (excluding the current group being
	// written — a member CAN exist in their own group, obviously).
	var siblingIDs []string
	for _, g := range siblingsGroups {
		if g.Id == groupID {
			continue
		}
		siblingIDs = append(siblingIDs, g.Id)
	}

	if len(siblingIDs) == 0 {
		// No other groups in this scenario — constraint satisfied.
		return nil
	}

	// Check if the attendee already appears in any sibling group.
	existing, err := app.FindRecordsByFilter(
		"locked_group_members",
		"attendee = {:attendee}",
		"",
		0, 0,
		dbx.Params{"attendee": attendeeID},
	)
	if err != nil {
		slog.Error("locked_group uniqueness check: member query failed", "error", err)
		return nil
	}

	// Build a set of sibling IDs for O(1) lookup.
	siblingSet := make(map[string]struct{}, len(siblingIDs))
	for _, id := range siblingIDs {
		siblingSet[id] = struct{}{}
	}

	// Filter out the record being updated and rows in unrelated groups.
	for _, row := range existing {
		if row.Id == excludeID {
			continue
		}
		conflictGroupID := row.GetString("group")
		if _, inSiblingSet := siblingSet[conflictGroupID]; !inSiblingSet {
			continue
		}

		// Found a conflicting membership. Resolve the existing group's name.
		groupName := conflictGroupID // fallback to ID
		if existingGroup, err := app.FindRecordById("locked_groups", conflictGroupID); err == nil {
			if n := existingGroup.GetString("name"); n != "" {
				groupName = n
			}
		}

		return router.NewApiError(
			http.StatusConflict,
			fmt.Sprintf("Camper is already in friend group %q.", groupName),
			nil,
		)
	}

	return nil
}
