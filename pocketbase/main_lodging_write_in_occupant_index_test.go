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

// commentFold collapses a JSDoc line break -- newline, leading spaces and
// the continuation asterisk -- plus any run of whitespace, into one space,
// so an assertion about what a header CLAIMS cannot be defeated by
// re-wrapping the paragraph it claims it in (kindred#2642 scan).
var commentFold = regexp.MustCompile(`\s*\n\s*\*?\s*|\s+`)

func readMigration(t *testing.T, path string) string {
	t.Helper()
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read migration %s: %v", path, err)
	}
	return jsConcat.ReplaceAllString(string(content), "")
}

// constValue returns the source of one top-level `const NAME = ...` binding,
// so an assertion about a statement's TEXT cannot be satisfied by a constant
// the migration never uses. It reads to the next top-level declaration.
func constValue(t *testing.T, body, name string) string {
	t.Helper()
	at := strings.Index(body, "const "+name+" =")
	if at < 0 {
		t.Fatalf("migration %s declares no `const %s`", writeInIndexMigration, name)
	}
	tail := body[at+len("const "+name+" ="):]
	for _, stop := range []string{"\nconst ", "\n/**", "\nfunction ", "\nmigrate("} {
		if end := strings.Index(tail, stop); end >= 0 {
			tail = tail[:end]
		}
	}
	return tail
}

// migrationHalves splits the file at the two `(app) => {` arrows `migrate`
// takes, so an assertion can say WHICH DIRECTION a statement is wired into.
// Asserting only that the text appears somewhere in the file passes on a
// migration that declares the narrowed statement and installs the old one --
// mutation-checked, and that is exactly what it did before this split existed.
func migrationHalves(t *testing.T, body string) (up, down string) {
	t.Helper()
	const arrow = "(app) => {"
	upAt := strings.Index(body, arrow)
	if upAt < 0 {
		t.Fatalf("migration %s has no up path", writeInIndexMigration)
	}
	rest := body[upAt+len(arrow):]
	downAt := strings.Index(rest, arrow)
	if downAt < 0 {
		t.Fatalf("migration %s has no down path", writeInIndexMigration)
	}
	return rest[:downAt], rest[downAt+len(arrow):]
}

// TestWriteInUniqueIndexesNarrowOntoTheOccupant pins the up path of step 8.
//
// BOTH indexes move, not one. The draft twin RETAINS `scenario`: a scenario is
// a legitimate second axis, and dropping it would let two scenarios' rows for
// one unit collide -- the same reasoning 1500000161 gives for putting it there.
func TestWriteInUniqueIndexesNarrowOntoTheOccupant(t *testing.T) {
	body := readMigration(t, writeInIndexMigration)

	if got := constValue(t, body, "LIVE_AFTER"); !strings.Contains(got, liveIndexAfter) {
		t.Errorf("migration %s must narrow the live index onto occupant_name:\n  want %s\n  got %s",
			writeInIndexMigration, liveIndexAfter, strings.TrimSpace(got))
	}
	if got := constValue(t, body, "DRAFT_AFTER"); !strings.Contains(got, draftIndexAfter) {
		t.Errorf("migration %s must narrow the draft index onto occupant_name while KEEPING scenario:"+
			"\n  want %s\n  got %s", writeInIndexMigration, draftIndexAfter, strings.TrimSpace(got))
	}

	up, _ := migrationHalves(t, body)
	for _, name := range []string{"LIVE_AFTER", "DRAFT_AFTER"} {
		if !strings.Contains(up, name) {
			t.Errorf("migration %s's up path must install %s -- a narrowed statement the "+
				"migration declares and never uses narrows nothing", writeInIndexMigration, name)
		}
	}
	for _, name := range []string{"LIVE_BEFORE", "DRAFT_BEFORE"} {
		if strings.Contains(up, name) {
			t.Errorf("migration %s's up path installs %s, which is the statement it exists to replace",
				writeInIndexMigration, name)
		}
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
	if got := constValue(t, body, "LIVE_BEFORE"); !strings.Contains(got, liveIndexBefore) {
		t.Errorf("migration %s must restore %s's live index VERBATIM:\n  want %s\n  got %s",
			writeInIndexMigration, writeInCreateMigration, liveIndexBefore, strings.TrimSpace(got))
	}
	if got := constValue(t, body, "DRAFT_BEFORE"); !strings.Contains(got, draftIndexBefore) {
		t.Errorf("migration %s must restore %s's draft index VERBATIM:\n  want %s\n  got %s",
			writeInIndexMigration, writeInCreateMigration, draftIndexBefore, strings.TrimSpace(got))
	}

	_, down := migrationHalves(t, body)
	for _, name := range []string{"LIVE_BEFORE", "DRAFT_BEFORE"} {
		if !strings.Contains(down, name) {
			t.Errorf("migration %s's down path must install %s", writeInIndexMigration, name)
		}
	}
	for _, name := range []string{"LIVE_AFTER", "DRAFT_AFTER"} {
		if strings.Contains(down, name) {
			t.Errorf("migration %s's down path installs %s -- the down path restores, it does not narrow",
				writeInIndexMigration, name)
		}
	}
}

// TestWriteInIndexMigrationDocumentsItsOneWayDownPath pins the header's
// statement that this migration cannot be undone once the feature is used.
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

// TestTombstoneReasoningNoLongerCitesAWriteBlockThatCannotHappen keeps
// 1500000173's header arguing from reasons that are still true.
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

	// ⚠️ NORMALISE THE COMMENT FOLD BEFORE MATCHING (kindred#2642 scan).
	// This used to search for the old text at its exact 80-column wrap --
	// "blocks staff from\n * ever writing that unit again for the weekend".
	// Nothing pins that fold (prettier is not configured for pb_migrations),
	// so re-flowing the paragraph to any other width would have retired this
	// guard silently with the wrong reason fully intact. Collapsing the
	// leading comment asterisks and runs of whitespace makes the assertion
	// about the CLAIM rather than about where the line happened to break.
	flat := commentFold.ReplaceAllString(body, " ")

	// THE CLAIM MAY APPEAR EXACTLY ONCE, AND ONLY AS A QUOTATION OF ITSELF.
	// Normalising the fold showed what the wrap-sensitive check had been
	// hiding: the corrected header RESTATES the old sentence, deliberately,
	// so the next reader can see which words moved. An absence check is
	// therefore the wrong shape -- it was passing only because the quotation
	// happened to fold at a different column than the original did. What has
	// to hold is that every occurrence is introduced as superseded rather
	// than argued from.
	const claim = "blocks staff from ever writing that unit again for the weekend"
	if n := strings.Count(flat, claim); n != 1 {
		t.Errorf("1500000173's header mentions the retired unit-grain write block %d times; "+
			"want exactly 1, as the quotation inside the ⚠️ CORRECTED note", n)
	} else if lead, _, found := strings.Cut(flat, claim); found {
		if !strings.HasSuffix(lead, `⚠️ CORRECTED. This used to read "the live table's unique index `+
			"(unit, session_cm_id, year) means a tombstone ") {
			t.Errorf("1500000173's header still ARGUES from a unit-grain write block that " +
				"kindred#2583 step 8 removed; it may only quote it, introduced by " +
				"`⚠️ CORRECTED. This used to read ...`")
		}
	}

	// ASSERT THE CORRECTION IS PRESENT, not merely that the old text is gone.
	// Deleting the paragraph outright would satisfy an absence check while
	// leaving the next reader with no account of why the reason changed --
	// and `strings.Contains(body, "kindred#2583")` alone was satisfied by the
	// issue number appearing anywhere in the file, including inside a line
	// arguing the opposite.
	if !strings.Contains(flat, "1500000176 narrowed that index onto `occupant_name`") {
		t.Errorf("1500000173's header must say which change moved the first reason " +
			"(1500000176 narrowing the index onto `occupant_name`), so the next reader can follow it")
	}
	if !strings.Contains(flat, "Physical delete is still the answer") {
		t.Errorf("1500000173's header must still reach the unchanged ANSWER -- the argument moved, " +
			"the ruling did not")
	}
}
