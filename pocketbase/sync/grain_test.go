package sync

import (
	"os"
	"path/filepath"
	"reflect"
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

	found := map[string]string{}
	callSites := 0
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || filepath.Ext(name) != ".go" || strings.HasSuffix(name, "_test.go") {
			continue
		}
		named, sites := parseGuardedSweeps(readSourceFile(t, name))
		for _, collection := range named {
			found[collection] = name
		}
		callSites += sites
	}

	// A caller that passes the collection as a CONSTANT rather than an inline
	// literal is invisible to the naming regex, and the floor check below would
	// still pass on the six literals. Counting call sites separately is what
	// makes this parser admit it missed one instead of silently under-reporting.
	if callSites != len(found) {
		t.Fatalf("guardedSweepCollections: found %d DeleteOrphansGuarded call site(s) but "+
			"could only name the collection for %d of them (%v) -- a caller is passing a "+
			"constant or variable instead of an inline string literal; teach the regex to "+
			"read it rather than letting it go undeclared", callSites, len(found), found)
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

	// The path must be ABSOLUTE, and saying so beats letting SQLite answer
	// "unable to open database file (14)". `go test` runs each test binary with
	// its own PACKAGE directory as the working directory -- pocketbase/sync here
	// -- not the directory the `go test` command was invoked from, so a caller
	// that writes ./pb_test_data/data.db relative to pocketbase/ (which is where
	// the CI job's other steps read it from) misses by one level.
	if !filepath.IsAbs(dbPath) {
		t.Fatalf("KINDRED_PROD_SCHEMA_DB=%q is relative; it must be absolute, because "+
			"this test binary runs with pocketbase/sync as its working directory, not "+
			"the directory `go test` was invoked from", dbPath)
	}
	if _, err := os.Stat(dbPath); err != nil {
		t.Fatalf("KINDRED_PROD_SCHEMA_DB=%s is not readable: %v -- the boot step that "+
			"produces it did not run, or was cleaned up first", dbPath, err)
	}

	// query_only so reading the schema cannot alter the database the neighboring
	// pocketbase-types freshness step reads next.
	db, err := dbx.Open("sqlite", dbPath+"?_pragma=query_only(true)")
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
			if !isUniqueIndexDDL(idx.SQL) {
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

// parseGuardedSweeps reads one Go source file and reports the collection name of
// every BaseSyncService.DeleteOrphansGuarded call site it can read, plus the
// TOTAL number of call sites in the file.
//
// The two numbers are returned separately on purpose. A call site whose first
// argument this parser cannot read contributes to the count but not to the
// names -- and the caller compares them, rather than trusting a set that may
// silently be short.
//
// It reads two argument shapes: an inline string literal, and an identifier
// that names a string constant declared in this SAME file (kindred#2665 --
// attendees.go passes attendeesCollection). A constant declared in another file
// stays unreadable, deliberately: resolving across files would mean tracking
// which package the identifier belongs to, and the counted-but-unnamed path
// already fails loudly rather than under-reporting.
func parseGuardedSweeps(src string) (named []string, callSites int) {
	consts := stringConstsIn(src)
	for _, m := range guardedSweepNameRe.FindAllStringSubmatch(src, -1) {
		if literal := m[1]; literal != "" {
			named = append(named, literal)
			continue
		}
		if value, ok := consts[m[2]]; ok {
			named = append(named, value)
		}
	}
	return named, len(guardedSweepCallRe.FindAllString(src, -1))
}

// stringConstsIn harvests the string constants one source file declares, in the
// two forms this package writes them: a top-level `const name = "value"` (how
// attendees.go declares attendeesCollection and persons.go personsCollection)
// and an entry inside a `const ( ... )` block (how camper_transportation.go
// declares its column names).
//
// Deliberately not a full parse. It reads exactly the shapes a sweep's
// collection argument is declared in; anything else stays unreadable, which
// leaves that call site counted-but-unnamed and fails guardedSweepCollections
// loudly instead of quietly shrinking the set.
func stringConstsIn(src string) map[string]string {
	out := map[string]string{}
	inBlock := false
	for _, line := range strings.Split(src, "\n") {
		decl := strings.TrimSpace(line)
		switch {
		case decl == "const (":
			inBlock = true
			continue
		case inBlock && decl == ")":
			inBlock = false
			continue
		case strings.HasPrefix(decl, "const "):
			decl = strings.TrimPrefix(decl, "const ")
		case !inBlock:
			continue
		}
		if m := stringConstRe.FindStringSubmatch(decl); m != nil {
			out[m[1]] = m[2]
		}
	}
	return out
}

// stringConstRe reads one `name = "value"` declaration, with the `const` keyword
// already stripped. The value charset matches guardedSweepNameRe's: a PocketBase
// collection name, not any Go string.
var stringConstRe = regexp.MustCompile(`^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"([a-z0-9_]+)"$`)

// guardedSweepNameRe reads the collection off a call site that passes it either
// as an inline string literal (group 1) or as an identifier (group 2), which
// parseGuardedSweeps then resolves against the file's own string constants.
var guardedSweepNameRe = regexp.MustCompile(
	`DeleteOrphansGuarded\(\s*(?:"([a-z0-9_]+)"|([A-Za-z_][A-Za-z0-9_]*))`)

// guardedSweepCallRe counts call sites whatever their first argument looks like.
// The leading "." is what excludes BaseSyncService's own method DECLARATION in
// base_sync.go, which is not a call.
var guardedSweepCallRe = regexp.MustCompile(`\.DeleteOrphansGuarded\(`)

// isUniqueIndexDDL reports whether a sqlite_master `sql` column describes a
// UNIQUE index.
//
// Anchored on the CREATE ... INDEX prefix rather than substring-matching
// "UNIQUE" anywhere in the DDL. The DDL contains the index's own NAME, and three
// of the six declared names end in "_unique" -- so a substring match reads the
// name as evidence about the index, and a non-unique index enforcing no grain at
// all would pass. A column named unique_key would do it too.
func isUniqueIndexDDL(sql string) bool {
	return uniqueIndexDDLRe.MatchString(sql)
}

var uniqueIndexDDLRe = regexp.MustCompile(`(?i)^\s*CREATE\s+UNIQUE\s+INDEX\b`)

// TestIsUniqueIndexDDLRejectsANonUniqueIndexNamedUnique pins the one input that
// matters: three of the six declared index names END in "_unique", so a
// predicate that substring-matches "UNIQUE" against the whole DDL reads the
// index's own NAME as evidence that it is unique. That is a false green for half
// the table -- the index would enforce no grain at all and the assertion would
// still pass.
func TestIsUniqueIndexDDLRejectsANonUniqueIndexNamedUnique(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		name string
		sql  string
		want bool
	}{
		{
			name: "unique index",
			sql:  "CREATE UNIQUE INDEX `idx_attendees_unique` ON `attendees` (`person_id`, `year`, `session`)",
			want: true,
		},
		{
			name: "non-unique index whose NAME says unique",
			sql:  "CREATE INDEX `idx_attendees_unique` ON `attendees` (`person_id`, `year`, `session`)",
			want: false,
		},
		{
			name: "non-unique index on a plainly named column",
			sql:  "CREATE INDEX `idx_attendees_year` ON `attendees` (`year`)",
			want: false,
		},
		{
			name: "non-unique index over a column called unique_key",
			sql:  "CREATE INDEX `idx_x` ON `attendees` (`unique_key`)",
			want: false,
		},
		{
			name: "lowercase ddl",
			sql:  "create unique index `idx_x` on `attendees` (`year`)",
			want: true,
		},
	} {
		if got := isUniqueIndexDDL(tc.sql); got != tc.want {
			t.Errorf("%s: isUniqueIndexDDL(%q) = %v, want %v", tc.name, tc.sql, got, tc.want)
		}
	}
}

// TestParseGuardedSweepsCountsCallSitesItCannotName pins the gap the naming
// regex has by construction: it reads an inline string literal only. A seventh
// guarded caller that passes a constant would be unnamed AND uncounted, leaving
// the floor check satisfied by the existing six and the new sweep undeclared --
// the exact silent exemption grain.go exists to prevent.
func TestParseGuardedSweepsCountsCallSitesItCannotName(t *testing.T) {
	t.Parallel()

	const src = `
func (s *Alpha) deleteOrphans() error {
	return s.DeleteOrphansGuarded(
		"alpha",
		nil, "alpha", "", OrphanSweepGuard{},
	)
}

const betaCollection = "beta"

func (s *Beta) deleteOrphans() error {
	return s.DeleteOrphansGuarded(
		betaCollection,
		nil, "beta", "", OrphanSweepGuard{},
	)
}

const (
	gammaCollection = "gamma"
)

func (s *Gamma) deleteOrphans() error {
	return s.DeleteOrphansGuarded(
		gammaCollection,
		nil, "gamma", "", OrphanSweepGuard{},
	)
}

func (s *Delta) deleteOrphans() error {
	return s.DeleteOrphansGuarded(
		deltaCollection,
		nil, "delta", "", OrphanSweepGuard{},
	)
}
`

	named, callSites := parseGuardedSweeps(src)

	if callSites != 4 {
		t.Errorf("callSites = %d, want 4 -- every call site must be COUNTED even "+
			"where the collection cannot be read, or a caller passing something "+
			"this parser does not understand goes undetected", callSites)
	}

	// alpha is the inline literal; beta and gamma are string constants declared
	// in this same source, in the two forms the package actually uses (a
	// top-level `const x = "..."` as attendees.go declares attendeesCollection,
	// and an entry inside a `const ( ... )` block). delta's constant is declared
	// in some OTHER file, which this per-file parser cannot see -- so it stays
	// counted-but-unnamed and the caller's mismatch check fires, which is the
	// property that must survive teaching the parser about constants.
	want := []string{"alpha", "beta", "gamma"}
	if !reflect.DeepEqual(named, want) {
		t.Errorf("named = %v, want %v -- an inline literal and an in-file string "+
			"constant are both readable; a constant declared elsewhere is not",
			named, want)
	}
}

// TestGrainForServiceResolvesSameGrainAs covers the one piece of NON-test logic
// this file's subject introduces. GrainForService is exported for kindred#2643's
// orphan-replay wirings to read a service's write key instead of repeating the
// literal, so it lands here with no production caller yet -- which is exactly
// how an exported helper ships untested and hands its first real caller a bug.
func TestGrainForServiceResolvesSameGrainAs(t *testing.T) {
	t.Parallel()

	t.Run("a base service returns its own Writes", func(t *testing.T) {
		t.Parallel()

		got, ok := GrainForService(serviceNamePersonCustomValues)
		if !ok {
			t.Fatalf("%s is declared; GrainForService said otherwise",
				serviceNamePersonCustomValues)
		}
		var pcv *CollectionGrain
		for i := range got.Writes {
			if got.Writes[i].Collection == serviceNamePersonCustomValues {
				pcv = &got.Writes[i]
			}
		}
		if pcv == nil {
			t.Fatalf("no %s collection in %+v", serviceNamePersonCustomValues, got.Writes)
		}
		if !pcv.HasFullGrain() {
			t.Errorf("%s must carry a full grain, got %+v", serviceNamePersonCustomValues, pcv)
		}
		if pcv.WriteKey != pcv.OrphanKey {
			t.Errorf("WriteKey %q and OrphanKey %q disagree -- that disagreement IS the "+
				"bug this declaration exists to make legible", pcv.WriteKey, pcv.OrphanKey)
		}
	})

	// The scoped family-camp passes are the SAME Go type under a narrower cohort,
	// so they must resolve to the base's keys verbatim. This is what lets the
	// table hold exactly six full-grain literals while all 35 services declare.
	t.Run("a scoped variant resolves to its base's keys", func(t *testing.T) {
		t.Parallel()

		for _, tc := range []struct{ variant, base string }{
			{serviceNamePersonCustomValues + "_family_camp", serviceNamePersonCustomValues},
			{serviceNameHouseholdCustomValues + "_family_camp", serviceNameHouseholdCustomValues},
		} {
			variant, ok := GrainForService(tc.variant)
			if !ok {
				t.Errorf("%s: not resolved", tc.variant)
				continue
			}
			base, ok := GrainForService(tc.base)
			if !ok {
				t.Errorf("%s: not resolved", tc.base)
				continue
			}
			if variant.Service != tc.variant {
				t.Errorf("%s: resolved Service is %q -- the caller must still see the "+
					"name it asked about", tc.variant, variant.Service)
			}
			if len(variant.Writes) == 0 {
				t.Errorf("%s: resolved to no Writes at all -- SameGrainAs did not follow",
					tc.variant)
				continue
			}
			if !reflect.DeepEqual(variant.Writes, base.Writes) {
				t.Errorf("%s: Writes differ from %s.\n variant=%+v\n base=%+v",
					tc.variant, tc.base, variant.Writes, base.Writes)
			}
		}
	})

	t.Run("a WritesNothing service keeps its reason", func(t *testing.T) {
		t.Parallel()

		got, ok := GrainForService("multi_workbook_export")
		if !ok {
			t.Fatal("multi_workbook_export is declared; GrainForService said otherwise")
		}
		if got.WritesNothing == "" {
			t.Errorf("the WritesNothing reason was dropped in resolution: %+v", got)
		}
		if len(got.Writes) != 0 {
			t.Errorf("a WritesNothing service must resolve to no Writes, got %+v", got.Writes)
		}
	})

	t.Run("an unregistered name is reported missing", func(t *testing.T) {
		t.Parallel()

		if got, ok := GrainForService("no_such_sync_service"); ok {
			t.Errorf("an undeclared service resolved to %+v -- a caller reading a key "+
				"off that would silently get the zero value", got)
		}
	})
}
