package main

import (
	"os"
	"strings"
	"testing"
)

const lodgingDraftMigration = "pb_migrations/1500000132_lodging_draft_writes.js"

// lodgingDraftCollections are the two twins 1500000132 introduces. Staff write
// these; the ingest keeps sole ownership of the tables they mirror.
var lodgingDraftCollections = []string{
	"lodging_assignments_draft",
	"lodging_merges_draft",
}

func readLodgingDraftMigration(t *testing.T) string {
	t.Helper()
	content, err := os.ReadFile(lodgingDraftMigration)
	if err != nil {
		t.Fatalf("read migration %s: %v", lodgingDraftMigration, err)
	}
	return string(content)
}

// TestLodgingDraftMigrationUsesTheCanonicalBunkingManageRule pins the draft
// collections to the same rule string every other staff-writable collection in
// this repo carries, spelled identically.
//
// Asserts on the migration FILE, as TestLodgingRBACMigrationGrantsBunkingManageWrites
// does and for the same reason: applying JS migrations from a Go test needs
// jsvm bootstrapped against the migrations dir, which tests.NewTestApp() does
// not do. The RUNTIME schema is asserted empirically by
// scripts/dev/verify-lodging-schema.sh, which boots PocketBase against a
// scratch DB and reads the applied rules back out of _collections. The two
// halves are deliberate: this one fails when the spelling drifts, that one
// fails when the effect does.
func TestLodgingDraftMigrationUsesTheCanonicalBunkingManageRule(t *testing.T) {
	body := readLodgingDraftMigration(t)

	if !strings.Contains(body, `'@request.auth.is_admin = true || @request.auth.cached_permissions ~ "bunking.manage"'`) {
		t.Errorf("migration %s must contain the canonical bunkingManage rule", lodgingDraftMigration)
	}

	for _, col := range lodgingDraftCollections {
		if !strings.Contains(body, `name: "`+col+`"`) {
			t.Errorf("migration %s must create collection %q", lodgingDraftMigration, col)
		}
	}

	if !strings.Contains(body, "migrate((app)") {
		t.Errorf("migration %s must define an up function via migrate((app) => ...)", lodgingDraftMigration)
	}
	if !strings.Contains(body, "}, (app)") {
		t.Errorf("migration %s must define a down function", lodgingDraftMigration)
	}
}

// TestLodgingDraftMigrationLeavesTheRecordOfTruthAdminOnly is the point of the
// whole draft split.
//
// 1500000130 deferred this decision in as many words -- "Lodging has no draft
// table yet ... widen them in the PR that adds the writer" -- and the answer
// this migration gives is that the writer never touches them. Summer has never
// granted bunking.manage on bunk_assignments or attendee_status_history
// either; what staff write there is the DRAFT.
//
// lodging_assignments IS named in this migration, but only to drop its dead
// scenario column, so the check below is scoped: the two collections that have
// no business appearing at all must not appear at all, and no rule assignment
// may sit next to the record of truth.
func TestLodgingDraftMigrationLeavesTheRecordOfTruthAdminOnly(t *testing.T) {
	body := readLodgingDraftMigration(t)

	for _, col := range []string{"lodging_assignment_history", "lodging_field_mappings"} {
		if strings.Contains(body, `"`+col+`"`) {
			t.Errorf("migration %s references %q; the draft writer has no business touching it",
				lodgingDraftMigration, col)
		}
	}

	// The truth tables are opened by a `createRule:` sitting in the same
	// Collection literal as their name. Creating one would mean this migration
	// had redefined the collection rather than altered it.
	for _, col := range []string{"lodging_assignments", "lodging_merges"} {
		if strings.Contains(body, `name: "`+col+`"`) {
			t.Errorf("migration %s declares a Collection named %q; it must ALTER the truth table, not redefine it",
				lodgingDraftMigration, col)
		}
	}
}

// TestLodgingDraftMigrationDropsTheDeadScenarioColumn guards the other half of
// the design: scenario is a property of PLANNING, not of record.
//
// Both truth grains were created carrying a scenario relation that nothing ever
// wrote -- all 67 assignment rows had scenario = ” when this was written. Left
// in place it is an invitation to widen the truth table and scope staff by a
// `scenario != ""` write rule, which is a guard by convention: one string edit
// from opening the synced rows.
func TestLodgingDraftMigrationDropsTheDeadScenarioColumn(t *testing.T) {
	body := readLodgingDraftMigration(t)

	if !strings.Contains(body, `removeByName("scenario")`) {
		t.Errorf("migration %s must drop the dead scenario column from the truth grains",
			lodgingDraftMigration)
	}
}

// TestLodgingDraftIndexesGateOnGreaterThanZero is a regression guard on the
// dual-grain predicate, which has been "simplified" once already.
//
// PocketBase declares number fields as `NUMERIC DEFAULT 0 NOT NULL`, so an
// unset household_cm_id is 0 -- and SQLite evaluates `0 != ”` as TRUE. With
// `!= ”` the household index captures every person-grain row, collides them,
// and permits exactly ONE adult assignment per session. Silent, and only
// visible as adult weekends mysteriously refusing a second placement.
//
// The four partial indexes in this file (two rebuilt on the truth table, two
// new on the draft) must all gate on `> 0`.
func TestLodgingDraftIndexesGateOnGreaterThanZero(t *testing.T) {
	body := readLodgingDraftMigration(t)

	// Look only at the index SQL, never at the whole file: the migration's
	// comments quote `!= ''` precisely to explain why it is wrong, and a
	// whole-file scan trips over its own rationale. verify-no-hardcoded-lodging.sh
	// had this exact defect and was red on main until #1891 taught it to skip
	// comments.
	var indexLines []string
	for _, line := range strings.Split(body, "\n") {
		if strings.Contains(line, "CREATE") && strings.Contains(line, "INDEX") {
			indexLines = append(indexLines, line)
		}
	}
	if len(indexLines) == 0 {
		t.Fatalf("migration %s declares no indexes; the predicate guard below would be vacuous",
			lodgingDraftMigration)
	}

	partialIndexes := 0
	for _, line := range indexLines {
		if strings.Contains(line, `!= ''`) {
			t.Errorf("migration %s uses a \"!= ''\" index predicate; it must be \"> 0\" (0 != '' is TRUE in SQLite): %s",
				lodgingDraftMigration, strings.TrimSpace(line))
		}
		if strings.Contains(line, "WHERE") {
			partialIndexes++
			if !strings.Contains(line, "> 0") {
				t.Errorf("migration %s has a partial index whose predicate is not \"> 0\": %s",
					lodgingDraftMigration, strings.TrimSpace(line))
			}
		}
	}

	// At least four: two rebuilt on the truth table without scenario and two
	// new on the draft with it. Not an exact count -- the down path carries its
	// own copies of the truth-table pair to restore, and pinning the total
	// would make adding a reverse step fail a test about predicates.
	if partialIndexes < 4 {
		t.Errorf("migration %s declares %d partial indexes, want at least 4 (two rebuilt, two new)",
			lodgingDraftMigration, partialIndexes)
	}

	for _, idx := range []string{
		"idx_lodging_assign_hh_live",
		"idx_lodging_assign_person_live",
		"idx_lodging_draft_hh",
		"idx_lodging_draft_person",
	} {
		if !strings.Contains(body, idx) {
			t.Errorf("migration %s must define index %s", lodgingDraftMigration, idx)
		}
	}

	// The draft's uniqueness is per-scenario -- that is the entire point of the
	// column. Whether the REBUILT live indexes correctly lost it is asserted
	// empirically by verify-lodging-schema.sh against the applied schema, which
	// is the honest place for it: this file still carries the old definitions
	// for the down path, so a text scan here cannot tell up from down.
	// The UNIQUE ones only. idx_lodging_draft_session_year is an ordinary
	// lookup index and has no business carrying the column.
	for _, line := range indexLines {
		if !strings.Contains(line, "idx_lodging_draft_") || !strings.Contains(line, "UNIQUE") {
			continue
		}
		if !strings.Contains(line, "`scenario`") {
			t.Errorf("migration %s: draft index must key on scenario: %s",
				lodgingDraftMigration, strings.TrimSpace(line))
		}
	}
}

// TestLodgingDraftScenarioIsRequiredAndCascades pins the two properties that
// make the draft a draft.
//
// REQUIRED: a draft row with no scenario would shadow the CampMinder mirror for
// everyone in production mode, which is the read-only guarantee the
// no-scenario board rests on. The truth table's column was nullable and that is
// exactly what made it dead weight.
//
// cascadeDelete: deleting a saved scenario has to sweep its drafts server-side.
// bunk_assignments_draft was created with this false and later flipped, purely
// to delete an N+1 client-side pre-delete loop that existed to compensate.
func TestLodgingDraftScenarioIsRequiredAndCascades(t *testing.T) {
	body := readLodgingDraftMigration(t)

	const scenarioField = `type: "relation", name: "scenario", required: true, presentable: false,`
	if got := strings.Count(body, scenarioField); got != len(lodgingDraftCollections) {
		t.Errorf("migration %s declares %d required scenario relations, want %d (one per draft collection)",
			lodgingDraftMigration, got, len(lodgingDraftCollections))
	}

	if !strings.Contains(body, "cascadeDelete: true") {
		t.Errorf("migration %s must set cascadeDelete on the draft scenario relation, "+
			"so deleting a scenario sweeps its drafts", lodgingDraftMigration)
	}
}
