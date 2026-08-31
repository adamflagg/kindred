package main

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

// kindred#2583 step 8 -- the on-switch. Both write-in unique indexes narrow
// onto `occupant_name`, which is what makes two paper families in one
// shareable cabin two ROWS rather than two names crammed into one.
//
// Asserted against the migration FILE for the reason
// TestLodgingWriteInDraftScenarioIsRequiredAndCascades gives: applying JS
// migrations from a Go test needs jsvm bootstrapped against the migrations
// dir, which tests.NewTestApp() does not do. The EFFECT -- that a real
// PocketBase boot lands these columns and enforces them -- is asserted by
// scripts/dev/verify-writein-occupant-index.sh, which boots the binary twice
// and reads the applied schema. Two halves: this one fails when the
// declaration drifts, that one fails when a declaration of this shape stops
// doing what it says.
const (
	writeInIndexMigration  = "pb_migrations/1500000176_lodging_write_in_occupant_index.js"
	writeInCreateMigration = "pb_migrations/1500000161_lodging_write_ins.js"
)

// The four index statements this migration moves between. Written out in full
// rather than assembled from parts, because "the down path restores the
// original SQL EXACTLY" is the property under test and a builder that
// generated both ends would pass while restoring something else.
const (
	liveIndexBefore = "CREATE UNIQUE INDEX `idx_lodging_write_in_unique` ON `lodging_write_ins` " +
		"(`session_cm_id`, `year`, `unit`)"
	liveIndexAfter = "CREATE UNIQUE INDEX `idx_lodging_write_in_unique` ON `lodging_write_ins` " +
		"(`session_cm_id`, `year`, `unit`, `occupant_name`)"
	draftIndexBefore = "CREATE UNIQUE INDEX `idx_lodging_write_in_draft_unique` ON `lodging_write_ins_draft` " +
		"(`session_cm_id`, `year`, `unit`, `scenario`)"
	draftIndexAfter = "CREATE UNIQUE INDEX `idx_lodging_write_in_draft_unique` ON `lodging_write_ins_draft` " +
		"(`session_cm_id`, `year`, `unit`, `scenario`, `occupant_name`)"
)

// Adjacent JS string literals joined by `+`, so a statement wrapped across
// source lines reads as the one statement it compiles to. What is under test is
// the SQL the migration installs, not how its source is folded -- and folding
// is not optional at these lengths.
var jsConcat = regexp.MustCompile(`'\s*\+\s*'`)

func readMigration(t *testing.T, path string) string {
	t.Helper()
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read migration %s: %v", path, err)
	}
	return jsConcat.ReplaceAllString(string(content), "")
}

// TestWriteInUniqueIndexesNarrowOntoTheOccupant pins the up path of step 8.
//
// BOTH indexes move, not one. The draft twin RETAINS `scenario`: a scenario is
// a legitimate second axis, and dropping it would let two scenarios' rows for
// one unit collide -- the same reasoning 1500000161 gives for putting it there.
func TestWriteInUniqueIndexesNarrowOntoTheOccupant(t *testing.T) {
	body := readMigration(t, writeInIndexMigration)

	if !strings.Contains(body, liveIndexAfter) {
		t.Errorf("migration %s must narrow the live index onto occupant_name:\n  want %s",
			writeInIndexMigration, liveIndexAfter)
	}
	if !strings.Contains(body, draftIndexAfter) {
		t.Errorf("migration %s must narrow the draft index onto occupant_name while KEEPING scenario:\n  want %s",
			writeInIndexMigration, draftIndexAfter)
	}
}

// TestWriteInIndexDownPathRestoresTheOriginalStatements pins the down path
// against the file that wrote the originals.
//
// A down path that restores something merely SIMILAR is worse than no down
// path: it leaves the table carrying an index nothing in the tree declares,
// and the next migration to filter by name would push a second one beside it.
// So this asserts the restored text against 1500000161's own literals rather
// than against a copy that could drift with it.
func TestWriteInIndexDownPathRestoresTheOriginalStatements(t *testing.T) {
	created := readMigration(t, writeInCreateMigration)
	if !strings.Contains(created, liveIndexBefore) {
		t.Fatalf("%s no longer declares the live index this test compares against:\n  want %s",
			writeInCreateMigration, liveIndexBefore)
	}
	if !strings.Contains(created, draftIndexBefore) {
		t.Fatalf("%s no longer declares the draft index this test compares against:\n  want %s",
			writeInCreateMigration, draftIndexBefore)
	}

	body := readMigration(t, writeInIndexMigration)
	if !strings.Contains(body, liveIndexBefore) {
		t.Errorf("migration %s must restore %s's live index VERBATIM on the down path:\n  want %s",
			writeInIndexMigration, writeInCreateMigration, liveIndexBefore)
	}
	if !strings.Contains(body, draftIndexBefore) {
		t.Errorf("migration %s must restore %s's draft index VERBATIM on the down path:\n  want %s",
			writeInIndexMigration, writeInCreateMigration, draftIndexBefore)
	}
}

// TestWriteInIndexMigrationDocumentsItsOneWayDownPath.
//
// Restoring a unique index over a table that by then holds two rows on one
// unit FAILS, so this migration is one-way in practice like every widening
// migration. The header has to say so: a reader who finds a down path and
// assumes it is a way back discovers otherwise against production data.
func TestWriteInIndexMigrationDocumentsItsOneWayDownPath(t *testing.T) {
	body := readMigration(t, writeInIndexMigration)
	header := body
	if at := strings.Index(body, "migrate("); at > 0 {
		header = body[:at]
	}
	if !strings.Contains(header, "ONE-WAY IN PRACTICE") {
		t.Errorf("migration %s's header must state that the down path cannot succeed "+
			"once two rows share a unit (look for \"ONE-WAY IN PRACTICE\")", writeInIndexMigration)
	}
}

// TestTombstoneReasoningNoLongerCitesAWriteBlockThatCannotHappen.
//
// 1500000173's header rules out a `deleted_at` tombstone for three reasons,
// and step 8 makes the FIRST one untrue: with the index keyed on
// `(session_cm_id, year, unit, occupant_name)`, a tombstone no longer blocks
// staff from writing that unit again for the weekend -- only from re-writing
// that same occupant onto it. Physical deletes stay physical on the other two
// reasons, which are untouched; what has to change is the argument, not the
// answer. Per this repo's rule about wrong bodies, the header is corrected in
// the same PR that makes it wrong.
func TestTombstoneReasoningNoLongerCitesAWriteBlockThatCannotHappen(t *testing.T) {
	body := readMigration(t, "pb_migrations/1500000173_lodging_write_in_pushes.js")
	if strings.Contains(body, "blocks staff from\n * ever writing that unit again for the weekend") {
		t.Errorf("1500000173's header still argues from a unit-grain write block that " +
			"kindred#2583 step 8 removed; correct the reason, keep the answer")
	}
	if !strings.Contains(body, "kindred#2583") {
		t.Errorf("1500000173's header must say which change moved the first reason, " +
			"so the next reader can follow it")
	}
}
