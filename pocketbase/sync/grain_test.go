package sync

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"

	"github.com/pocketbase/dbx"
)

// The tests in this file are kindred#2627's conformance half. grain.go is the
// declaration; this is what makes it non-optional.
//
// Two constraints from the audit are pinned here on purpose, and both were
// ruled explicitly rather than chosen:
//
//  1. An undeclared service must FAIL, not warn. Optional is worthless -- next
//     year's author reads none of this and passes green.
//  2. The unique index is asserted against a BOOTED PocketBase's sqlite_master,
//     never a regex over pb_migrations. A regex passes on a migration that never
//     applied.

// grainDeclaredServices returns the set of service names the table declares,
// and fails on a duplicate (which would make every other assertion here
// ambiguous about which entry it checked).
func grainDeclaredServices(t *testing.T) map[string]ServiceGrain {
	t.Helper()

	byName := make(map[string]ServiceGrain, len(serviceGrainDeclarations))
	for _, d := range serviceGrainDeclarations {
		if d.Service == "" {
			t.Errorf("serviceGrainDeclarations has an entry with no Service name")
			continue
		}
		if _, dup := byName[d.Service]; dup {
			t.Errorf("%s: declared twice in serviceGrainDeclarations", d.Service)
		}
		byName[d.Service] = d
	}
	return byName
}

// allRegisteredServiceNames is the union of the registry's TWO registration
// sites -- orchestrator.go's RegisterService literals and scope.go's
// scopedServiceRegistrations. Reusing registry_test.go's proven pair rather
// than inventing a third parser: registeredServiceNames carries its own t.Fatal
// floor check, so a regex broken by a future refactor fails loudly there
// instead of silently shrinking the set every test in this file measures
// against.
func allRegisteredServiceNames(t *testing.T) map[string]bool {
	t.Helper()

	names := registeredServiceNames(t)
	for _, reg := range scopedServiceRegistrations(nil, nil) {
		names[scopedID(reg.base, reg.scope)] = true
	}
	return names
}

// TestEverySyncServiceDeclaresItsGrain is the fail-an-undeclared-service rule.
//
// It runs both directions. A registered service with no declaration fails,
// which is the point of the whole file. A declaration naming nothing registered
// fails too, because that is how the table rots: a service is renamed or
// deleted, its declaration is left behind, and the next reader takes a
// statement about code that no longer exists as current.
func TestEverySyncServiceDeclaresItsGrain(t *testing.T) {
	t.Parallel()

	registered := allRegisteredServiceNames(t)
	declared := grainDeclaredServices(t)

	for _, name := range sortedKeys(registered) {
		if _, ok := declared[name]; !ok {
			t.Errorf("%s: registered sync service with no entry in "+
				"serviceGrainDeclarations (grain.go) -- every service must declare "+
				"what it writes; see kindred#2627", name)
		}
	}

	for _, name := range sortedKeys(boolSet(declared)) {
		if !registered[name] {
			t.Errorf("%s: serviceGrainDeclarations declares a grain for a service "+
				"nothing registers -- renamed or deleted? remove the entry rather "+
				"than leaving a claim about code that is gone", name)
		}
	}

	// syncJobMeta is what schedules and what the admin UI publishes. Asserting
	// it separately from the registration union costs one loop and catches the
	// case where the two disagree, rather than assuming they cannot.
	for _, m := range syncJobMeta {
		if _, ok := declared[m.ID]; !ok {
			t.Errorf("%s: syncJobMeta row with no grain declaration (grain.go)", m.ID)
		}
	}
}

// TestGrainDeclarationsAreWellFormed pins the shape rules. Without these, a
// declaration could satisfy the test above while saying nothing -- an entry
// with an empty Writes slice and no reason is exactly as useful as no entry.
func TestGrainDeclarationsAreWellFormed(t *testing.T) {
	t.Parallel()

	declared := grainDeclaredServices(t)

	for _, name := range sortedKeys(boolSet(declared)) {
		d := declared[name]

		arms := 0
		if len(d.Writes) > 0 {
			arms++
		}
		if d.WritesNothing != "" {
			arms++
		}
		if d.SameGrainAs != "" {
			arms++
		}
		if arms != 1 {
			t.Errorf("%s: exactly one of Writes, WritesNothing and SameGrainAs must "+
				"be set, got %d of them", name, arms)
			continue
		}

		if d.SameGrainAs != "" {
			base, ok := declared[d.SameGrainAs]
			if !ok {
				t.Errorf("%s: SameGrainAs names %q, which is not a declared service",
					name, d.SameGrainAs)
				continue
			}
			if len(base.Writes) == 0 {
				t.Errorf("%s: SameGrainAs names %q, which carries no Writes of its own "+
					"-- point it at the declaration that actually holds the keys",
					name, d.SameGrainAs)
			}
			continue
		}

		seen := map[string]bool{}
		for _, w := range d.Writes {
			if w.Collection == "" {
				t.Errorf("%s: a Writes entry has no Collection name", name)
				continue
			}
			if seen[w.Collection] {
				t.Errorf("%s: collection %q declared twice", name, w.Collection)
			}
			seen[w.Collection] = true

			full := w.HasFullGrain()
			partial := !full &&
				(w.WriteKey != "" || w.OrphanKey != "" || w.UniqueIndex != "" || w.Reduce != "")

			switch {
			case partial:
				t.Errorf("%s/%s: a partial grain declaration is worse than none -- set "+
					"WriteKey, OrphanKey, UniqueIndex and Reduce together, or give a "+
					"NoGrain reason instead", name, w.Collection)
			case full && w.NoGrain != "":
				t.Errorf("%s/%s: carries a full grain AND a NoGrain reason -- one or the "+
					"other", name, w.Collection)
			case !full && w.NoGrain == "":
				t.Errorf("%s/%s: no grain and no reason -- say in one line why this "+
					"collection has no declarable write/orphan key pair", name, w.Collection)
			}

			if full {
				switch w.Reduce {
				case ReduceNone, ReduceLastWriteWins, ReduceRejectDuplicate:
				default:
					t.Errorf("%s/%s: Reduce %q is not a declared ReducePolicy",
						name, w.Collection, w.Reduce)
				}
			}
		}
	}
}

// guardedSweepCollections parses every non-test source file in this package for
// the collection name each BaseSyncService.DeleteOrphansGuarded call site
// sweeps.
//
// Derived from source rather than listed, so a SEVENTH guarded caller added
// later fails TestGuardedSweepsCarryFullGrain until it declares its keys,
// instead of quietly joining a list nobody updates. Same t.Fatal floor
// discipline as registry_test.go's registeredServiceNames: a partial parse is
// reported, never trusted.
func guardedSweepCollections(t *testing.T) map[string]string {
	t.Helper()

	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatalf("reading the package directory: %v", err)
	}

	re := regexp.MustCompile(`DeleteOrphansGuarded\(\s*"([a-z0-9_]+)"`)
	found := map[string]string{}
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || filepath.Ext(name) != ".go" || strings.HasSuffix(name, "_test.go") {
			continue
		}
		for _, m := range re.FindAllStringSubmatch(readSourceFile(t, name), -1) {
			found[m[1]] = name
		}
	}

	// Six callers exist as of kindred#2627: attendees, bunk_assignments,
	// bunk_plans, household_custom_values, person_custom_values and persons.
	// A parser that finds fewer has broken, and the assertions below would
	// then pass by checking nothing.
	if len(found) < 6 {
		t.Fatalf("guardedSweepCollections: parsed only %d DeleteOrphansGuarded call "+
			"site(s) (%v) -- the regex is broken or the call shape changed; update it "+
			"rather than trust a partial result", len(found), found)
	}
	return found
}

// TestGuardedSweepsCarryFullGrain is the link between the declaration and the
// code it describes: every collection swept through DeleteOrphansGuarded must
// carry a FULL grain somewhere in the table.
//
// This is what keeps the "only the guarded six" scope honest without hardcoding
// six names. A new guarded sweep is exactly the case where WriteKey and
// OrphanKey can disagree, so it is exactly the case that must declare them.
func TestGuardedSweepsCarryFullGrain(t *testing.T) {
	t.Parallel()

	guarded := guardedSweepCollections(t)

	full := map[string]bool{}
	for _, d := range serviceGrainDeclarations {
		for _, w := range d.Writes {
			if w.HasFullGrain() {
				full[w.Collection] = true
			}
		}
	}

	for _, collection := range sortedKeys(stringSet(guarded)) {
		if !full[collection] {
			t.Errorf("%s: swept by DeleteOrphansGuarded in %s, but no grain "+
				"declaration carries a full {WriteKey, OrphanKey, UniqueIndex, Reduce} "+
				"for it -- a guarded sweep is exactly where the two key builders can "+
				"drift apart", collection, guarded[collection])
		}
	}
}

// TestDeclaredUniqueIndexesExistInBootedSchema asserts every declared
// UniqueIndex against a booted PocketBase's sqlite_master.
//
// Needs KINDRED_PROD_SCHEMA_DB: the path to a data.db produced by applying
// pocketbase/pb_migrations, with no Go fixture involved. PocketBase's JS
// migrations do not run under `go test` (see newSyncRunsApp's doc comment in
// sync_runs_test.go), so only .github/workflows/ci.yml's Migration Smoke Test
// job produces one -- this SKIPS everywhere else rather than reimplementing
// that boot a second time, exactly as
// TestLodgingTestsupportFixtureFieldsExistInProductionSchema does with
// KINDRED_PROD_SCHEMA_JSON.
//
// Reading sqlite_master rather than /api/collections' `indexes` field is
// deliberate and is the ruled constraint: the collection metadata records what
// PocketBase MEANT to create, while sqlite_master records what SQLite actually
// has.
func TestDeclaredUniqueIndexesExistInBootedSchema(t *testing.T) {
	t.Parallel()

	dbPath := os.Getenv("KINDRED_PROD_SCHEMA_DB")
	if dbPath == "" {
		t.Skip("KINDRED_PROD_SCHEMA_DB not set -- this check runs in CI's " +
			"Migration Smoke Test job only (.github/workflows/ci.yml); see kindred#2627")
	}

	db, err := dbx.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("opening the migrated database at %s: %v", dbPath, err)
	}
	t.Cleanup(func() { _ = db.Close() })

	type indexRow struct {
		Name  string `db:"name"`
		Table string `db:"tbl_name"`
		SQL   string `db:"sql"`
	}
	var rows []indexRow
	if err := db.NewQuery(
		"SELECT name, tbl_name, COALESCE(sql, '') AS sql FROM sqlite_master WHERE type = 'index'",
	).All(&rows); err != nil {
		t.Fatalf("reading sqlite_master from %s: %v", dbPath, err)
	}
	// A database with no indexes at all means the boot step produced nothing
	// worth asserting against, and every check below would vacuously pass.
	if len(rows) == 0 {
		t.Fatalf("sqlite_master at %s lists no indexes -- the migrated database is "+
			"empty or the boot step is broken", dbPath)
	}

	byName := make(map[string]indexRow, len(rows))
	for _, r := range rows {
		byName[r.Name] = r
	}

	checked := 0
	for _, d := range serviceGrainDeclarations {
		for _, w := range d.Writes {
			if !w.HasFullGrain() {
				continue
			}
			checked++
			idx, ok := byName[w.UniqueIndex]
			if !ok {
				t.Errorf("%s/%s: declares UniqueIndex %q, which does not exist in the "+
					"migrated schema at %s", d.Service, w.Collection, w.UniqueIndex, dbPath)
				continue
			}
			if idx.Table != w.Collection {
				t.Errorf("%s/%s: index %q is on table %q, not %q",
					d.Service, w.Collection, w.UniqueIndex, idx.Table, w.Collection)
			}
			if !strings.Contains(strings.ToUpper(idx.SQL), "UNIQUE") {
				t.Errorf("%s/%s: index %q exists but is not UNIQUE -- it enforces no "+
					"grain: %s", d.Service, w.Collection, w.UniqueIndex, idx.SQL)
			}
		}
	}

	if checked == 0 {
		t.Fatal("no full-grain declaration was checked -- the table lost its " +
			"UniqueIndex declarations and this test passed by checking nothing")
	}
}

// sortedKeys returns a set's keys in a stable order, so a failing run lists its
// errors the same way twice.
func sortedKeys(set map[string]bool) []string {
	out := make([]string, 0, len(set))
	for k := range set {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func boolSet(m map[string]ServiceGrain) map[string]bool {
	out := make(map[string]bool, len(m))
	for k := range m {
		out[k] = true
	}
	return out
}

func stringSet(m map[string]string) map[string]bool {
	out := make(map[string]bool, len(m))
	for k := range m {
		out[k] = true
	}
	return out
}
