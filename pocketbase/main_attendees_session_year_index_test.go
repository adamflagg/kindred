package main

import (
	"os"
	"regexp"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/search"
)

// kindred#2803, item B. The family weekend landing (`/api/lodging/summary`)
// reads each weekend's attendees with
//
//	session = "<pb id>" && year = <year> && status_id = 2, sort=id
//
// (api/services/lodging_repository.py `fetch_attendees_for_session`), twelve
// times per load. `attendees` carried only `(person)` and the unique
// `(person_id, year, session)`, neither of which can seek on `session`, so
// SQLite walked the whole table in id order for every one of them: 25-37 ms of
// raw SQL each on the production snapshot, under 0.5 ms with this index.
//
// Asserted two ways, because each half catches what the other cannot:
//
//   - the migration FILE declares the index, installs it on the up path and
//     removes it by name on the down path (JS migrations cannot be applied
//     from a Go test -- tests.NewTestApp() does not bootstrap jsvm against
//     pb_migrations/, see main_lodging_write_in_occupant_index_test.go);
//   - the statement the file declares, installed on a collection shaped like
//     `attendees`, is what SQLite's planner picks for the filter the
//     repository issues -- translated to SQL by PocketBase's own filter
//     resolver, not hand-written, so the test follows what PocketBase sends.
const (
	attendeesIndexMigration  = "pb_migrations/1500000179_attendees_session_year_index.js"
	attendeesCreateMigration = "pb_migrations/1500000016_attendees.js"
	attendeesIndexName       = "idx_attendees_session_year"
	attendeesIndexSQL        = "CREATE INDEX `idx_attendees_session_year` ON `attendees` (`session`, `year`)"

	// The repository's per-weekend read, with a fictional session id.
	attendeesSessionFilter = `session = "sess00000000001" && year = 2026 && status_id = 2`
	repositoryPath         = "../api/services/lodging_repository.py"
)

var attendeesIndexStatement = regexp.MustCompile("CREATE (?:UNIQUE )?INDEX `[a-z_]+` ON `attendees` \\([^)]*\\)")

func TestAttendeesSessionYearIndexMigrationDeclaresIt(t *testing.T) {
	body := readMigration(t, attendeesIndexMigration)

	if !strings.Contains(body, attendeesIndexSQL) {
		t.Fatalf("migration %s must declare\n  %s", attendeesIndexMigration, attendeesIndexSQL)
	}

	up, down := migrationHalves(t, body)
	if !strings.Contains(up, "indexes.push(INDEX_SQL)") {
		t.Errorf("migration %s's up path must push INDEX_SQL onto the collection", attendeesIndexMigration)
	}
	if strings.Contains(down, "indexes.push") {
		t.Errorf("migration %s's down path must remove the index, not add one", attendeesIndexMigration)
	}
	for name, half := range map[string]string{"up": up, "down": down} {
		// Both directions drop any entry under the index's NAME first, so a
		// partial apply cannot leave two statements under one name.
		if !strings.Contains(half, "withoutIndex(collection)") {
			t.Errorf("migration %s's %s path must drop the index by name first", attendeesIndexMigration, name)
		}
	}
	if !strings.Contains(constValue(t, body, "INDEX_NAME"), "'"+attendeesIndexName+"'") {
		t.Errorf("migration %s must filter by the name %s", attendeesIndexMigration, attendeesIndexName)
	}
}

// TestAttendeesSessionYearIndexIsNotADuplicate pins the premise: no earlier
// migration already gives `attendees` an index leading with `session`.
func TestAttendeesSessionYearIndexIsNotADuplicate(t *testing.T) {
	entries, err := os.ReadDir("pb_migrations")
	if err != nil {
		t.Fatalf("read pb_migrations: %v", err)
	}
	for _, entry := range entries {
		path := "pb_migrations/" + entry.Name()
		if path == attendeesIndexMigration || !strings.HasSuffix(path, ".js") {
			continue
		}
		for _, stmt := range attendeesIndexStatement.FindAllString(readMigration(t, path), -1) {
			if strings.Contains(stmt, "(`session`") {
				t.Errorf("%s already declares an attendees index leading with session: %s", path, stmt)
			}
		}
	}
}

// TestRepositoryStillIssuesTheIndexedFilter ties the filter below to the one
// the Python repository actually sends. If that read changes shape, the plan
// this file asserts is no longer the plan production runs.
func TestRepositoryStillIssuesTheIndexedFilter(t *testing.T) {
	src, err := os.ReadFile(repositoryPath)
	if err != nil {
		t.Fatalf("read %s: %v", repositoryPath, err)
	}
	const want = `"filter": f'session = "{pb_escape(session_pb_id)}" && year = {year} && {ACTIVE_ENROLLED_FILTER}'`
	if !strings.Contains(string(src), want) {
		t.Errorf("%s no longer issues the per-weekend attendees filter this index serves:\n  want %s\n"+
			"Re-measure the plan against the new filter before changing this test.", repositoryPath, want)
	}
}

func TestAttendeesSessionYearIndexServesThePerWeekendRead(t *testing.T) {
	existing := attendeesIndexStatement.FindAllString(readMigration(t, attendeesCreateMigration), -1)
	if len(existing) != 2 {
		t.Fatalf("%s declares %d attendees indexes, this test was written against 2: %v",
			attendeesCreateMigration, len(existing), existing)
	}
	declared := attendeesIndexStatement.FindString(readMigration(t, attendeesIndexMigration))
	if declared != attendeesIndexSQL {
		t.Fatalf("migration %s declares %q, want %q", attendeesIndexMigration, declared, attendeesIndexSQL)
	}

	t.Run("without the index the read cannot seek on session", func(t *testing.T) {
		plan := attendeesQueryPlan(t, existing)
		if strings.Contains(plan, attendeesIndexName) || strings.Contains(plan, "SEARCH attendees USING INDEX") {
			t.Fatalf("control: the pre-migration indexes already serve this read, so the index proves nothing:\n%s", plan)
		}
	})

	t.Run("with the index the planner seeks on session and year", func(t *testing.T) {
		plan := attendeesQueryPlan(t, append(existing, declared))
		want := "SEARCH attendees USING INDEX " + attendeesIndexName + " (session=? AND year=?)"
		if !strings.Contains(plan, want) {
			t.Fatalf("query plan does not use %s:\n  want %s\n  got\n%s", attendeesIndexName, want, plan)
		}
	})
}

// attendeesQueryPlan builds an `attendees` collection carrying `indexes`, then
// asks SQLite how it would run the repository's per-weekend read.
func attendeesQueryPlan(t *testing.T, indexes []string) string {
	t.Helper()
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("new test app: %v", err)
	}
	t.Cleanup(app.Cleanup)

	sessions := core.NewBaseCollection("camp_sessions")
	sessions.Fields.Add(&core.NumberField{Name: "cm_id"})
	if err := app.Save(sessions); err != nil {
		t.Fatalf("save camp_sessions: %v", err)
	}
	persons := core.NewBaseCollection("persons")
	persons.Fields.Add(&core.NumberField{Name: "cm_id"})
	if err := app.Save(persons); err != nil {
		t.Fatalf("save persons: %v", err)
	}

	attendees := core.NewBaseCollection("attendees")
	attendees.Fields.Add(
		&core.RelationField{Name: "person", CollectionId: persons.Id, MaxSelect: 1},
		&core.NumberField{Name: "person_id"},
		&core.RelationField{Name: "session", CollectionId: sessions.Id, MaxSelect: 1},
		&core.NumberField{Name: "status_id"},
		&core.NumberField{Name: "year"},
	)
	attendees.Indexes = indexes
	if err := app.Save(attendees); err != nil {
		t.Fatalf("save attendees: %v", err)
	}

	query := app.RecordQuery(attendees)
	resolver := core.NewRecordFieldResolver(app, attendees, nil, true)
	expr, err := search.FilterData(attendeesSessionFilter).BuildExpr(resolver)
	if err != nil {
		t.Fatalf("build filter: %v", err)
	}
	query.AndWhere(expr)
	if err := resolver.UpdateQuery(query); err != nil {
		t.Fatalf("resolver update: %v", err)
	}
	query.OrderBy("[[attendees.id]] ASC")
	built := query.Build()

	var rows []struct {
		Detail string `db:"detail"`
	}
	if err := app.DB().NewQuery("EXPLAIN QUERY PLAN " + built.SQL()).Bind(built.Params()).All(&rows); err != nil {
		t.Fatalf("explain %s: %v", built.SQL(), err)
	}
	lines := make([]string, 0, len(rows))
	for _, row := range rows {
		lines = append(lines, row.Detail)
	}
	return strings.Join(lines, "\n")
}
