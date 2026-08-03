package lodging

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// TestMultiRelationAnyMatchFilter is the evidence behind the one filter string
// countAssignments (hooks.go) depends on. A filter that silently matches
// nothing would make guardUnitDelete permissive rather than erroring, so this
// is a characterisation test of PocketBase's filter DSL, not a unit test of our
// own code. It runs against the package fixture, which declares `units`
// exactly as 1500000134 does — the spike's own private fixture existed only
// while setupCollections still carried the dropped unit/merge columns.
//
// RESULT: the filter is "units.id ?= {:id}" -- both parts matter, and
// countAssignments uses this string verbatim:
//
//   - The `.id` sub-field reference is required. A bare "units" compares
//     against the field's raw stored representation without ever joining
//     into the related collection, so both "units = {:id}" and
//     "units ?= {:id}" -- the operator the plan originally assumed --
//     silently match ZERO rows against a real id. That is exactly the
//     silent-failure shape guardUnitDelete cannot afford (see the package
//     doc and #1921): a same-collection id, e.g. an accidental self-compare,
//     would look identical to "not referenced anywhere."
//   - `?=` ("any of") is required over plain `=` once `.id` is in play:
//     `.id` triggers PocketBase's multi-match JOIN against the related rows,
//     and under a join plain `=` demands ALL joined rows equal the operand
//     (meaningless once a unit set has 2+ members), while `?=` requires only
//     one. "units.id = {:id}" matches zero rows for exactly that reason,
//     confirmed below alongside the working form.
//
// (The LIKE operators "~"/"?~" also returned a match, but only by accident:
// they substring-search the field's raw serialized value, so they would
// false-positive on an id that happens to be a substring of another stored
// id. Not used, for that reason.)
func TestMultiRelationAnyMatchFilter(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	setupCollections(t, app)

	alpha := newUnit(t, app, "ALPHA", "Alpha")
	bravo := newUnit(t, app, "BRAVO", "Bravo")
	charlie := newUnit(t, app, "CHARLIE", "Charlie")
	holdsAlpha := newAssignment(t, app, []string{alpha.Id, bravo.Id}, 2000001, 0)
	// A sibling row that does NOT hold alpha. Without it, a filter that
	// matched every row regardless of id (or errored into an empty result on
	// the other end) would look identical to a correct one at len(got) == 1.
	newAssignment(t, app, []string{charlie.Id}, 2000002, 0)

	// Distinct names rather than reusing `got`/`err`: either would shadow the
	// outer binding and draw a govet shadow report.
	byID := func(id string) []*core.Record {
		t.Helper()
		matched, filterErr := app.FindRecordsByFilter(
			"lodging_assignments", "units.id ?= {:id}", "", 0, 0,
			map[string]any{"id": id},
		)
		if filterErr != nil {
			t.Fatalf("filter errored for id %q: %v", id, filterErr)
		}
		return matched
	}

	// alpha sits FIRST in the set -- the case Step 1's original assertion
	// alone would cover.
	got := byID(alpha.Id)
	if len(got) != 1 || got[0].Id != holdsAlpha.Id {
		t.Fatalf("units.id ?= alpha: got %d row(s), want exactly %q", len(got), holdsAlpha.Id)
	}

	// bravo sits SECOND. A filter that only inspected index 0 of the array
	// (or a hand-rolled Go loop bug of the same shape) would pass the alpha
	// case above and still miss this one.
	got = byID(bravo.Id)
	if len(got) != 1 || got[0].Id != holdsAlpha.Id {
		t.Fatalf("units.id ?= bravo: got %d row(s), want exactly %q", len(got), holdsAlpha.Id)
	}

	// A unit referenced by NEITHER row must match nothing -- the actual
	// production failure mode: guardUnitDelete calling this on a genuinely
	// unreferenced unit must see 0, or the delete guard can never release one.
	unreferenced := newUnit(t, app, "DELTA", "Delta")
	got = byID(unreferenced.Id)
	if len(got) != 0 {
		t.Fatalf("units.id ?= an unreferenced unit matched %d row(s), want 0", len(got))
	}

	// Confirms the sibling row's own member (charlie) resolves to ITSELF, not
	// to holdsAlpha -- guards against a filter that matches every row once
	// any array is non-empty.
	got = byID(charlie.Id)
	if len(got) != 1 {
		t.Fatalf("units.id ?= charlie: got %d row(s), want 1", len(got))
	}

	// The operator this plan originally guessed. Recorded as a negative
	// control so a future refactor of this test can't silently drop the
	// evidence for why it was rejected: it must keep matching nothing.
	bare, err := app.FindRecordsByFilter(
		"lodging_assignments", "units ?= {:id}", "", 0, 0,
		map[string]any{"id": alpha.Id},
	)
	if err != nil {
		t.Fatalf("bare units ?= filter errored: %v", err)
	}
	if len(bare) != 0 {
		t.Fatalf(
			"bare \"units ?= {:id}\" unexpectedly matched %d row(s); "+
				"if PocketBase now supports this form, update the RESULT doc "+
				"comment and countAssignments to use it instead of "+
				"\"units.id ?= {:id}\"",
			len(bare),
		)
	}
}
