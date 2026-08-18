package main

import (
	"os"
	"strings"
	"testing"
)

const lodgingWriteInMigration = "pb_migrations/1500000161_lodging_write_ins.js"

func readLodgingWriteInMigration(t *testing.T) string {
	t.Helper()
	content, err := os.ReadFile(lodgingWriteInMigration)
	if err != nil {
		t.Fatalf("read migration %s: %v", lodgingWriteInMigration, err)
	}
	return string(content)
}

// TestLodgingWriteInDraftScenarioIsRequiredAndCascades pins the two properties
// that make lodging_write_ins_draft a draft, the same pair
// TestLodgingDraftScenarioIsRequiredAndCascades pins for 1500000132's twins.
//
// It matters from PR 3 of kindred#2382 onward rather than from the migration
// that wrote it, which is why it is asserted here and not there. Up to PR 2 the
// draft table was dark: nothing read it, nothing wrote it, and either property
// could have drifted without consequence. Now a scenario's write-ins REPLACE
// the live ones on read, so:
//
// REQUIRED: a draft row with no scenario belongs to no board at all. It would
// be invisible to the live read (which never touches this table) and to every
// scenario read (which filters on the scenario id), while still holding a slot
// in idx_lodging_write_in_draft_unique that no board can clear.
//
// cascadeDelete: this is the WHOLE of the scenario-delete answer for write-ins.
// Nothing in pocketbase/lodging/hooks.go and nothing in Python's
// `delete_scenario` sweeps a lodging draft table -- that router deletes
// bunk_assignments_draft rows by hand for summer and touches no lodging
// collection. The lodging tables have always relied on the relation, and
// bunk_assignments_draft was itself flipped to cascadeDelete purely to delete
// the N+1 pre-delete loop that compensated for not having it.
//
// Asserts on the migration FILE for the reason
// TestLodgingDraftMigrationUsesTheCanonicalBunkingManageRule gives: applying JS
// migrations from a Go test needs jsvm bootstrapped against the migrations dir,
// which tests.NewTestApp() does not do. The EFFECT of a declaration of this
// shape is asserted against the running engine by
// TestDeletingAScenarioSweepsItsDraftWriteIns in pocketbase/lodging. Two
// halves: this one fails when the declaration drifts, that one fails when a
// declaration of this shape stops doing what it says.
func TestLodgingWriteInDraftScenarioIsRequiredAndCascades(t *testing.T) {
	body := readLodgingWriteInMigration(t)

	const scenarioField = `type: 'relation', name: 'scenario', required: true, presentable: false,`
	if !strings.Contains(body, scenarioField) {
		t.Errorf("migration %s must declare the draft's scenario relation as required",
			lodgingWriteInMigration)
	}

	// Scoped to the draft's own field rather than to the file, which already
	// carries `cascadeDelete: true` on `unit` in the fields BOTH collections
	// share -- a bare file-wide Contains would pass with the scenario relation
	// set to false.
	scenarioAt := strings.Index(body, scenarioField)
	if scenarioAt < 0 {
		return
	}
	tail := body[scenarioAt+len(scenarioField):]
	if end := strings.Index(tail, "});"); end >= 0 {
		tail = tail[:end]
	}
	if !strings.Contains(tail, "cascadeDelete: true") {
		t.Errorf("migration %s must set cascadeDelete on the DRAFT scenario relation, "+
			"so deleting a scenario sweeps its write-ins", lodgingWriteInMigration)
	}
}

// TestLodgingWriteInLiveTableHasNoScenarioColumn is the property that makes the
// live board a scope in its own right rather than the absence of one.
//
// The owner's second requirement on 2026-08-15 -- "we need to allow write ins
// to happen in campminder prod, not just scenarios, for staff to properly
// evaluate the board" -- is what rules out the nullable-`scenario` sentinel
// this repository has already turned down once (api/services/lodging_repository.py
// records the reasoning verbatim: lodging_assignments dropped its scenario
// column because it "was dead weight that invited a `scenario != \"\"` write
// rule instead of a draft table"). A scenario column growing back onto the live
// table is that sentinel returning, and it would make `fetch_write_ins`'s
// unpredicated read silently wrong rather than loudly broken.
func TestLodgingWriteInLiveTableHasNoScenarioColumn(t *testing.T) {
	body := readLodgingWriteInMigration(t)

	// The live collection is built from occupancyFields() alone; the draft
	// pushes `scenario` onto its own copy. Exactly ONE scenario relation may
	// appear in this file, and it is the draft's.
	if got := strings.Count(body, `name: 'scenario'`); got != 1 {
		t.Errorf("migration %s declares %d scenario relations, want exactly 1 (the draft's); "+
			"the live table is a scope in its own right and must carry none",
			lodgingWriteInMigration, got)
	}

	if !strings.Contains(body, "draftFields.push({") {
		t.Errorf("migration %s must add scenario to the DRAFT's fields only, not to the shared "+
			"occupancyFields() both collections are built from", lodgingWriteInMigration)
	}
}
