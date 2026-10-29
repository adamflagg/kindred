package sync

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	pbtests "github.com/pocketbase/pocketbase/tests"
)

// The tests in this file pin the end of the 10-29 nightly's failure: the 2026 persons season
// pass deleted one orphaned person and then failed to delete a second with
//
//	category: Value must be unique; person: Value must be unique; session: Value must be unique.
//
// Both people were attendees of the same adult weekend session, and each had a city row in
// normalized_mappings. normalized_mappings.person did not cascade, so deleting the first person
// BLANKED that row's person and re-saved it as ('', session, city). Deleting the second person
// blanked a second row to the very same ('', session, city), which UNIQUE(person, session,
// category) rejects -- PocketBase reports a blanking collision on a DELETE as that field list --
// so the delete failed, the run counted one error, and the season pass went red. The same night's
// normalize_geographic then removed both rows as orphans of the season, which is why no row
// pointed at the surviving person afterwards.
//
// That is bug B1's class (kindred#3303's staff.person) and kindred#2394's (person_custom_values),
// a third time. So these tests run against the REAL schema, every pb_migrations file applied:
// the bug lives in a relation's cascadeDelete flag, and a hand-built fixture would only pin
// whatever its author typed.

// newBootedSyncApp clones the database CI's Migration smoke test built by applying the REAL
// pb_migrations (KINDRED_PROD_SCHEMA_DB) into a throwaway test app, as rbac's newBootedTestApp
// does. Replaying the JS migrations in-process instead costs ~200s under -race (pocketbase/CLAUDE.md),
// so the -race shards skip this and CI's Migrations & Schema Agreement job runs it by name.
func newBootedSyncApp(t *testing.T) core.App {
	t.Helper()
	dbPath := os.Getenv("KINDRED_PROD_SCHEMA_DB")
	if dbPath == "" {
		t.Skip("KINDRED_PROD_SCHEMA_DB not set -- runs in CI's Migrations & Schema Agreement job")
	}
	if !filepath.IsAbs(dbPath) {
		t.Fatalf("KINDRED_PROD_SCHEMA_DB=%q must be absolute: this binary runs in pocketbase/sync", dbPath)
	}
	dir := t.TempDir()
	for _, suffix := range []string{"", "-wal"} {
		src, err := os.ReadFile(dbPath + suffix)
		if err != nil {
			if suffix != "" && os.IsNotExist(err) {
				continue
			}
			t.Fatalf("read %s: %v", dbPath+suffix, err)
		}
		if err := os.WriteFile(filepath.Join(dir, "data.db"+suffix), src, 0o600); err != nil {
			t.Fatalf("copy booted database: %v", err)
		}
	}
	app, err := pbtests.NewTestApp(dir)
	if err != nil {
		t.Fatalf("boot test app from %s: %v", dbPath, err)
	}
	t.Cleanup(app.Cleanup)
	return app
}

// TestBootedSweepDeletesDoNotCollideOnABlankedUniqueRelation runs every case against one clone of
// the booted schema, its subtests in sequence. Each case keeps to its own season, so none sees
// another's rows.
func TestBootedSweepDeletesDoNotCollideOnABlankedUniqueRelation(t *testing.T) {
	t.Parallel()
	app := newBootedSyncApp(t)

	// The 10-29 failure itself: two orphaned persons, each with a city row in the same session.
	t.Run("persons sweep deletes two people who share a session's geo mapping", func(t *testing.T) {
		const year = 2026
		session := saveRecord(t, app, "camp_sessions", map[string]any{
			"cm_id": 9400001, "name": "Adult Weekend", "year": year, "session_type": "adult",
			"start_date": "2026-10-02 00:00:00.000Z", "end_date": "2026-10-04 00:00:00.000Z",
		})
		gone := []int{9400101, 9400102}
		for _, cmID := range gone {
			pid := saveRecord(t, app, "persons", map[string]any{
				"cm_id": cmID, "first_name": "Ava", "last_name": "Johnson", "year": year,
			})
			saveRecord(t, app, "normalized_mappings", map[string]any{
				"category": categoryCity, "normalized_value": "Springfield", "original_value": "springfield",
				"year": year, "person": pid, "session": session,
			})
		}

		s := NewPersonsSync(app, nil)
		processThreeCampers(t, s, year)
		if err := s.deleteOrphans(year); err != nil {
			t.Fatalf("persons sweep: %v", err)
		}

		if s.Stats.Errors != 0 {
			t.Errorf("Stats.Errors = %d, want 0: deleting the second person collided on "+
				"normalized_mappings' UNIQUE(person, session, category)", s.Stats.Errors)
		}
		if s.Stats.Deleted != len(gone) {
			t.Errorf("Stats.Deleted = %d, want %d", s.Stats.Deleted, len(gone))
		}
		for _, cmID := range gone {
			if existsByCMID(t, app, "persons", cmID, year) {
				t.Errorf("person %d survived the sweep", cmID)
			}
		}
		if n := countRows(t, app, "normalized_mappings", fmt.Sprintf("year = %d", year)); n != 0 {
			t.Errorf("%d normalized_mappings rows left for %d, want 0: a mapping goes with its person", n, year)
		}

		// The run's verdict, from the one place that weighs it. Before the fix this read
		// failed / "1 database operations failed", which is what sync_runs recorded on 10-29.
		var completed Status
		applyCompletionStatus(&completed, &s.Stats, nil)
		if completed.Status != statusSuccess {
			t.Errorf("run status = %q (%q), want %q", completed.Status, completed.Error, statusSuccess)
		}
	})

	// The household half of the same pass: two orphaned households answering the same field.
	t.Run("household sweep deletes two households that answer the same custom field", func(t *testing.T) {
		const year = 2025
		def := saveRecord(t, app, "custom_field_defs", map[string]any{
			"cm_id": 9400201, "name": "HH-Test Field", "partition": "Family",
		})
		gone := []int{9400301, 9400302}
		for _, cmID := range gone {
			hid := saveRecord(t, app, "households", map[string]any{"cm_id": cmID, "year": year})
			saveRecord(t, app, "household_custom_values", map[string]any{
				"household": hid, "field_definition": def, "value": "yes", "year": year,
			})
		}

		s := NewPersonsSync(app, nil)
		if err := s.deleteHouseholdOrphans(year, map[int]bool{}); err != nil {
			t.Fatalf("household sweep: %v", err)
		}

		if s.Stats.Errors != 0 {
			t.Errorf("Stats.Errors = %d, want 0: deleting the second household collided on "+
				"household_custom_values' UNIQUE(year, household, field_definition)", s.Stats.Errors)
		}
		for _, cmID := range gone {
			if existsByCMID(t, app, "households", cmID, year) {
				t.Errorf("household %d survived the sweep", cmID)
			}
		}
		if n := countRows(t, app, "household_custom_values", fmt.Sprintf("year = %d", year)); n != 0 {
			t.Errorf("%d household_custom_values rows left for %d, want 0: a value goes with its household", n, year)
		}
	})

	// The sessions sweep: one person's mappings in two sessions that both go away.
	t.Run("deleting two sessions that hold one person's geo mappings", func(t *testing.T) {
		const year = 2024
		pid := saveRecord(t, app, "persons", map[string]any{
			"cm_id": 9400401, "first_name": "Liam", "last_name": "Smith", "year": year,
		})
		sessions := make([]string, 0, 2)
		for _, cmID := range []int{9400501, 9400502} {
			sid := saveRecord(t, app, "camp_sessions", map[string]any{
				"cm_id": cmID, "name": "Session", "year": year, "session_type": "main",
				"start_date": "2024-06-20 00:00:00.000Z", "end_date": "2024-07-10 00:00:00.000Z",
			})
			sessions = append(sessions, sid)
			saveRecord(t, app, "normalized_mappings", map[string]any{
				"category": categorySchool, "normalized_value": "Oak Elementary", "original_value": "oak elem",
				"year": year, "person": pid, "session": sid,
			})
		}

		for _, sid := range sessions {
			rec, err := app.FindRecordById("camp_sessions", sid)
			if err != nil {
				t.Fatalf("find session: %v", err)
			}
			if err := app.Delete(rec); err != nil {
				t.Errorf("delete session %s: %v", sid, err)
			}
		}
		if n := countRows(t, app, "normalized_mappings", fmt.Sprintf("year = %d", year)); n != 0 {
			t.Errorf("%d normalized_mappings rows left for %d, want 0: a mapping goes with its session", n, year)
		}
	})

	// The class, so a fourth instance fails here rather than in a nightly.
	t.Run("no other optional relation blanks into a unique index", func(t *testing.T) {
		assertNoUnreviewedBlankingUniqueRelations(t, app)
	})
}

// blankingUniqueRelationsReviewed lists every relation that is optional, does not cascade, and
// sits in a UNIQUE index -- so a delete of the record it points at blanks it, and a second such
// blank on the same remaining key collides and fails the delete -- and says why each is left that
// way. Adding a relation of that shape anywhere means adding it here with a reason, or making it
// cascade.
var blankingUniqueRelationsReviewed = map[string]string{
	"staff.person": "the persons sweep RETIRES a staff-linked person instead of deleting it " +
		"(owner ruling C, kindred#3303), so staff.person is never blanked by the sweep",
	"bunk_assignments_draft.person": "a scenario placement is staff work; stranded_assignment_cleanup " +
		"UNASSIGNS a draft whose camper left rather than deleting it, so cascading is an owner call",
	"bunk_assignments_draft.session": "as for .person; and saved_scenarios.session is required, so a " +
		"session that still has a scenario cannot be deleted at all",
	"person_custom_values.field_definition": "cascading would let one custom_field_defs sweep delete every " +
		"answer to that field; the collision is today's only brake on that, so it is an owner call",
	"household_custom_values.field_definition": "as for person_custom_values.field_definition",
}

var uniqueIndexColumns = regexp.MustCompile(`(?is)^\s*CREATE\s+UNIQUE\s+INDEX\b.*?\((.*?)\)`)

func assertNoUnreviewedBlankingUniqueRelations(t *testing.T, app core.App) {
	t.Helper()
	cols, err := app.FindAllCollections()
	if err != nil {
		t.Fatalf("list collections: %v", err)
	}

	var found []string
	for _, c := range cols {
		inUnique := map[string]bool{}
		for _, idx := range c.Indexes {
			m := uniqueIndexColumns.FindStringSubmatch(idx)
			if m == nil {
				continue
			}
			for _, part := range strings.Split(m[1], ",") {
				inUnique[strings.Trim(strings.TrimSpace(part), "`\"[]")] = true
			}
		}
		for _, f := range c.Fields {
			rel, ok := f.(*core.RelationField)
			if !ok || rel.CascadeDelete || rel.Required || !inUnique[rel.Name] {
				continue
			}
			found = append(found, c.Name+"."+rel.Name)
		}
	}
	sort.Strings(found)

	seen := map[string]bool{}
	for _, key := range found {
		seen[key] = true
		if _, ok := blankingUniqueRelationsReviewed[key]; !ok {
			t.Errorf("%s: an optional, non-cascading relation inside a UNIQUE index. Deleting the record it "+
				"points at blanks it, and a second blank on the same key fails that delete. Make it cascade, or "+
				"add it to blankingUniqueRelationsReviewed with the reason it must not", key)
		}
	}
	for key := range blankingUniqueRelationsReviewed {
		if !seen[key] {
			t.Errorf("%s: listed in blankingUniqueRelationsReviewed but no longer that shape; remove the entry", key)
		}
	}
}
