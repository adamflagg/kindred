package lodging

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// newRollForwardTestApp reuses setupRegistryCollections (registry_test.go) so
// the roll-forward tests run against the same shape production has: (code,
// year) composite unique indexes on both lodging_areas and lodging_units, per
// 1500000141.
func newRollForwardTestApp(t *testing.T) core.App {
	t.Helper()
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)
	setupRegistryCollections(t, app)
	return app
}

// seedYear seeds one self-contained season: 2 areas and 3 units, one of which
// (test-unit-a-room-1) has a parent (test-unit-a) — the minimum shape that
// exercises the area-index pass, the parent-relink pass, and a deny-listed
// field (is_confirmed) that must NOT copy across a roll-forward (kindred#2392).
func seedYear(t *testing.T, app core.App, year int) {
	t.Helper()

	areasCol, err := app.FindCollectionByNameOrId("lodging_areas")
	if err != nil {
		t.Fatalf("lodging_areas collection: %v", err)
	}
	unitsCol, err := app.FindCollectionByNameOrId("lodging_units")
	if err != nil {
		t.Fatalf("lodging_units collection: %v", err)
	}

	areaA := core.NewRecord(areasCol)
	areaA.Set("code", "test-area-a")
	areaA.Set("name", "Test Area A")
	areaA.Set("year", year)
	if err := app.Save(areaA); err != nil {
		t.Fatalf("save area test-area-a: %v", err)
	}

	areaB := core.NewRecord(areasCol)
	areaB.Set("code", "test-area-b")
	areaB.Set("name", "Test Area B")
	areaB.Set("year", year)
	if err := app.Save(areaB); err != nil {
		t.Fatalf("save area test-area-b: %v", err)
	}

	parent := core.NewRecord(unitsCol)
	parent.Set("area", areaA.Id)
	parent.Set("code", "test-unit-a")
	parent.Set("name", "Test Building A")
	parent.Set("is_confirmed", true)
	parent.Set("year", year)
	if err := app.Save(parent); err != nil {
		t.Fatalf("save unit test-unit-a: %v", err)
	}

	child := core.NewRecord(unitsCol)
	child.Set("area", areaA.Id)
	child.Set("code", "test-unit-a-room-1")
	child.Set("name", "Test Building A, Room 1")
	child.Set("parent_unit", parent.Id)
	child.Set("year", year)
	if err := app.Save(child); err != nil {
		t.Fatalf("save unit test-unit-a-room-1: %v", err)
	}

	other := core.NewRecord(unitsCol)
	other.Set("area", areaB.Id)
	other.Set("code", "test-unit-b")
	other.Set("name", "Test Building B")
	other.Set("year", year)
	if err := app.Save(other); err != nil {
		t.Fatalf("save unit test-unit-b: %v", err)
	}
}

func TestApplyRollForwardCopiesEveryUnitAndArea(t *testing.T) {
	t.Parallel()
	app := newRollForwardTestApp(t)
	seedYear(t, app, 2026) // 2 areas, 3 units, one with a parent

	plan, err := ApplyRollForward(app, 2026, 2027)
	if err != nil {
		t.Fatalf("ApplyRollForward: %v", err)
	}
	if plan.UnitsToCreate != 3 || plan.AreasToCreate != 2 {
		t.Errorf("plan = %+v, want 3 units and 2 areas", plan)
	}
}

// TestApplyRollForwardDoesNotCarryIsConfirmedForward pins kindred#2392's fix.
// `is_confirmed` asserts a human physically walked the cabin for THIS season
// (docs/reference/lodging-registry.md:377) -- it is not a fact about the
// building that outlives the season it was checked in. Before this fix
// `notCarried` held only `year`, `area` and `parent_unit`, so is_confirmed
// rode along with every other ordinary column through carriedFields, and
// any roll-forward -- including a BACKWARD one onto a season nobody has
// walked -- stamped is_confirmed = true on a row nobody confirmed.
func TestApplyRollForwardDoesNotCarryIsConfirmedForward(t *testing.T) {
	t.Parallel()
	app := newRollForwardTestApp(t)
	seedYear(t, app, 2026) // parent unit test-unit-a seeds with is_confirmed = true

	if _, err := ApplyRollForward(app, 2026, 2027); err != nil {
		t.Fatalf("ApplyRollForward: %v", err)
	}

	rec, err := findByCodeAndYear(app, "lodging_units", "test-unit-a", 2027)
	if err != nil || rec == nil {
		t.Fatalf("unit not carried forward: %v", err)
	}
	if rec.GetBool("is_confirmed") {
		t.Error("is_confirmed carried forward from the source season; want false -- " +
			"a new season's registry starts unconfirmed until staff walk it")
	}
}

// TestApplyRollForwardUnitAreaPointsAtItsOwnYear pins spec §3.1's invariant:
// a rolled-forward unit's `area` relation points at its OWN year's area row,
// never at the source year's. Areas are created first (copyAreas, before
// copyUnits) for exactly this reason.
//
// Nothing observed this before. lodging_repository.fetch_units expands
// `area`, so a regression to the naive `rec.Set("area", src.Get("area"))`
// would ship every rolled-forward unit pointing at the PRIOR season's area --
// wrong name, wrong sort_order on the board, the map and the roster -- and
// every other roll-forward test would still pass, because none of them
// resolve the relation, only compare ids against the row they expect.
func TestApplyRollForwardUnitAreaPointsAtItsOwnYear(t *testing.T) {
	t.Parallel()
	app := newRollForwardTestApp(t)
	seedYear(t, app, 2026)

	if _, err := ApplyRollForward(app, 2026, 2027); err != nil {
		t.Fatalf("ApplyRollForward: %v", err)
	}

	area2026, err := findByCodeAndYear(app, "lodging_areas", "test-area-a", 2026)
	if err != nil || area2026 == nil {
		t.Fatalf("2026 area missing: %v", err)
	}
	area2027, err := findByCodeAndYear(app, "lodging_areas", "test-area-a", 2027)
	if err != nil || area2027 == nil {
		t.Fatalf("2027 area missing: %v", err)
	}
	unit, err := findByCodeAndYear(app, "lodging_units", "test-unit-a", 2027)
	if err != nil || unit == nil {
		t.Fatalf("2027 unit missing: %v", err)
	}

	if got := unit.GetString("area"); got != area2027.Id {
		t.Errorf("unit area = %q, want the 2027 area row %q", got, area2027.Id)
	}
	if got := unit.GetString("area"); got == area2026.Id {
		t.Error("unit area points at the SOURCE year's area row, not its own season's")
	}

	// Resolve the relation, rather than only comparing ids -- the invariant is
	// about what the relation POINTS AT, and a wrong-but-plausible id (a typo
	// in this test, say) would pass an id-only check for the wrong reason.
	areaRec, err := app.FindRecordById("lodging_areas", unit.GetString("area"))
	if err != nil {
		t.Fatalf("resolving unit's area: %v", err)
	}
	if got := areaRec.GetInt("year"); got != 2027 {
		t.Errorf("unit's area.year = %d, want 2027", got)
	}
}

func TestApplyRollForwardIsIdempotent(t *testing.T) {
	t.Parallel()
	app := newRollForwardTestApp(t)
	seedYear(t, app, 2026)

	if _, err := ApplyRollForward(app, 2026, 2027); err != nil {
		t.Fatalf("first apply: %v", err)
	}
	second, err := ApplyRollForward(app, 2026, 2027)
	if err != nil {
		t.Fatalf("second apply: %v", err)
	}
	if second.UnitsToCreate != 0 {
		t.Errorf("second run created %d units; want 0", second.UnitsToCreate)
	}
	if len(second.SkippedCodes) != 3 {
		t.Errorf("SkippedCodes = %v, want all 3 reported", second.SkippedCodes)
	}
}

func TestApplyRollForwardLinksParentsWithinTheNewYear(t *testing.T) {
	t.Parallel()
	app := newRollForwardTestApp(t)
	seedYear(t, app, 2026)

	if _, err := ApplyRollForward(app, 2026, 2027); err != nil {
		t.Fatalf("ApplyRollForward: %v", err)
	}
	child, _ := findByCodeAndYear(app, "lodging_units", "test-unit-a-room-1", 2027)
	parent, _ := findByCodeAndYear(app, "lodging_units", "test-unit-a", 2027)
	if child == nil || parent == nil {
		t.Fatal("rows missing after roll-forward")
	}
	if got := child.GetString("parent_unit"); got != parent.Id {
		t.Errorf("parent_unit = %q, want the 2027 parent %q", got, parent.Id)
	}
}

func TestApplyRollForwardPreservesCodeAcrossARename(t *testing.T) {
	t.Parallel()
	app := newRollForwardTestApp(t)
	seedYear(t, app, 2026)

	// THE ORDER IS THE TEST. Renaming the 2027 row after the copy — which is
	// what this test used to do — only proves that Set("name", ...) leaves
	// `code` alone. That is true of any record and never observes the
	// roll-forward at all. The season a building is renamed IN is the source
	// season, and `code` is the thread that has to survive it: a roll-forward
	// deriving the target code from the name would sever a renamed building
	// from its own history, and only this order can see that happen.
	src, err := findByCodeAndYear(app, "lodging_units", "test-unit-a", 2026)
	if err != nil {
		t.Fatalf("looking up test-unit-a in 2026: %v", err)
	}
	if src == nil {
		t.Fatal("seeding did not produce test-unit-a in 2026")
	}
	src.Set("name", "Test Building A (renamed)")
	if saveErr := app.Save(src); saveErr != nil {
		t.Fatalf("rename in the source season: %v", saveErr)
	}

	if _, rollErr := ApplyRollForward(app, 2026, 2027); rollErr != nil {
		t.Fatalf("ApplyRollForward: %v", rollErr)
	}

	carried, err := findByCodeAndYear(app, "lodging_units", "test-unit-a", 2027)
	if err != nil {
		t.Fatalf("looking up test-unit-a in 2027: %v", err)
	}
	if carried == nil {
		t.Fatal("the renamed building did not carry its code into 2027")
	}
	// The new name traveled too, so the row is the renamed building and not
	// some earlier copy that happened to keep the code.
	if got := carried.GetString("name"); got != "Test Building A (renamed)" {
		t.Errorf("carried the code but not the rename: name = %q", got)
	}
}

func TestPreviewRollForwardWritesNothing(t *testing.T) {
	t.Parallel()
	app := newRollForwardTestApp(t)
	seedYear(t, app, 2026)

	if _, err := PreviewRollForward(app, 2026, 2027); err != nil {
		t.Fatalf("PreviewRollForward: %v", err)
	}
	rec, _ := findByCodeAndYear(app, "lodging_units", "test-unit-a", 2027)
	if rec != nil {
		t.Error("preview created a row")
	}
}

// TestPreviewRollForwardEmptySourceMarshalsEmptyArraysNotNull pins the wire
// format, not the struct: a source year with no registry at all leaves
// UnitCodes and SkippedCodes never appended to, so an unintialized `[]string`
// field stays nil and encoding/json marshals a nil slice as `null`, not `[]`.
// The frontend's RollForwardPlan type declares both fields as non-nullable
// string[], so a `null` on the wire crashes the Season tab's render. Asserting
// on the struct fields would NOT catch this -- nil and []string{} are both
// falsy-empty and indistinguishable there. Only json.Marshal exposes the bug.
func TestPreviewRollForwardEmptySourceMarshalsEmptyArraysNotNull(t *testing.T) {
	t.Parallel()
	app := newRollForwardTestApp(t)
	// Deliberately no seedYear call: 2030 has no registry at all, so both
	// passes iterate zero source rows and neither append ever runs.

	plan, err := PreviewRollForward(app, 2030, 2031)
	if err != nil {
		t.Fatalf("PreviewRollForward: %v", err)
	}

	raw, err := json.Marshal(plan)
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}

	body := string(raw)
	if !strings.Contains(body, `"unit_codes":[]`) {
		t.Errorf("expected unit_codes to marshal as [], got: %s", body)
	}
	if !strings.Contains(body, `"skipped_codes":[]`) {
		t.Errorf("expected skipped_codes to marshal as [], got: %s", body)
	}
}

// TestApplyRollForwardDoesNotRelinkAHandAddedStandaloneUnit pins the
// left-untouched contract across BOTH passes, not just copyUnits.
//
// Staff hand-add test-unit-a-room-1 into 2027 ahead of the roll-forward,
// deliberately leaving parent_unit empty -- it used to be a room inside
// test-unit-a, but is being split out as its own standalone cabin. copyUnits
// correctly treats that row as authoritative and skips creating it. But
// relinkParents iterates the SOURCE season's units and, before this fix, had
// no way to tell "this target row already existed" from "this target row is
// mine to wire" -- so it would attach 2026's parent to the hand-added row
// anyway, even though the row was reported as skipped.
func TestApplyRollForwardDoesNotRelinkAHandAddedStandaloneUnit(t *testing.T) {
	t.Parallel()
	app := newRollForwardTestApp(t)
	seedYear(t, app, 2026)

	unitsCol, err := app.FindCollectionByNameOrId("lodging_units")
	if err != nil {
		t.Fatalf("lodging_units collection: %v", err)
	}

	// Reuses the 2026 area rather than creating a fresh 2027 one, since only
	// the units/parent-linking behavior is under test here.
	area2026, err := findByCodeAndYear(app, "lodging_areas", "test-area-a", 2026)
	if err != nil || area2026 == nil {
		t.Fatalf("seeded 2026 area missing: %v", err)
	}

	handAdded := core.NewRecord(unitsCol)
	handAdded.Set("area", area2026.Id)
	handAdded.Set("code", "test-unit-a-room-1")
	handAdded.Set("name", "Test Building A, Room 1 (now standalone)")
	handAdded.Set("year", 2027)
	// parent_unit deliberately left empty -- this is the point of the test.
	if err = app.Save(handAdded); err != nil {
		t.Fatalf("save hand-added 2027 unit: %v", err)
	}

	plan, err := ApplyRollForward(app, 2026, 2027)
	if err != nil {
		t.Fatalf("ApplyRollForward: %v", err)
	}

	skipped := false
	for _, code := range plan.SkippedCodes {
		if code == "test-unit-a-room-1" {
			skipped = true
		}
	}
	if !skipped {
		t.Errorf("SkippedCodes = %v, want test-unit-a-room-1 reported as skipped", plan.SkippedCodes)
	}

	rec, err := findByCodeAndYear(app, "lodging_units", "test-unit-a-room-1", 2027)
	if err != nil || rec == nil {
		t.Fatalf("hand-added unit missing after roll-forward: %v", err)
	}
	if got := rec.GetString("parent_unit"); got != "" {
		t.Errorf("parent_unit = %q, want empty -- the hand-added row was reported as skipped and must be left untouched", got)
	}
}

// failUnitCreate makes saving the named unit code fail, so a test can stop a
// roll-forward partway through copyUnits. Returns a func that lifts the
// failure, for the retry half of the contract.
//
// A hook is the only honest injection point: every other way to fail a save
// mid-run (a duplicate code, a bad relation) is a state the passes themselves
// treat as meaningful, so it would exercise a different branch than the one
// under test — an unexpected save failure.
func failUnitCreate(app core.App, code string) (lift func()) {
	armed := true
	app.OnRecordCreate("lodging_units").BindFunc(func(e *core.RecordEvent) error {
		if armed && e.Record.GetString("code") == code {
			return fmt.Errorf("injected failure saving %q", code)
		}
		return e.Next()
	})
	return func() { armed = false }
}

// TestApplyRollForwardLeavesNothingBehindWhenAPassFails pins ATOMICITY.
//
// The three passes were shipped non-transactional on the stated ground that
// idempotency is a sufficient mitigation — "a mid-run failure needs only a
// second ApplyRollForward; nothing lands unrepairable". The companion test
// below shows why that is not true. This one pins the simpler half: a failed
// apply must leave the target season exactly as it found it, so the retry
// starts from a clean slate rather than from a half-built registry.
func TestApplyRollForwardLeavesNothingBehindWhenAPassFails(t *testing.T) {
	t.Parallel()
	app := newRollForwardTestApp(t)
	seedYear(t, app, 2026)
	failUnitCreate(app, "test-unit-b") // the third unit; two are created first

	if _, err := ApplyRollForward(app, 2026, 2027); err == nil {
		t.Fatal("ApplyRollForward succeeded; want the injected failure to surface")
	}

	units, err := app.FindRecordsByFilter("lodging_units", "year = 2027", "", 0, 0)
	if err != nil {
		t.Fatalf("counting 2027 units: %v", err)
	}
	if len(units) != 0 {
		t.Errorf("%d units survived a failed roll-forward; want 0 -- a partial "+
			"apply leaves a half-built season the retry cannot finish", len(units))
	}

	areas, err := app.FindRecordsByFilter("lodging_areas", "year = 2027", "", 0, 0)
	if err != nil {
		t.Fatalf("counting 2027 areas: %v", err)
	}
	if len(areas) != 0 {
		t.Errorf("%d areas survived a failed roll-forward; want 0", len(areas))
	}
}

// TestApplyRollForwardRetryAfterAFailureLinksParents is the test that refutes
// "nothing lands unrepairable", and it is the reason atomicity is not optional.
//
// relinkParents deliberately relinks ONLY the codes copyUnits created THIS run
// (plan.UnitCodes) — a row someone hand-added to the target year is the
// authority and must keep its cleared parent. That filter is correct, and it is
// exactly what makes a partial apply permanent: on the retry, units the FAILED
// run committed are found by findByCodeAndYear, counted into UnitsPresent,
// reported in SkippedCodes, and therefore never enter plan.UnitCodes. They are
// indistinguishable from a hand-added row. Their parents are never wired, by
// this run or any future one.
//
// Without the transaction this fails with parent_unit empty. It cannot be
// fixed by loosening the relink filter without reintroducing the hand-added-row
// bug that filter exists to prevent (see the test above this one).
func TestApplyRollForwardRetryAfterAFailureLinksParents(t *testing.T) {
	t.Parallel()
	app := newRollForwardTestApp(t)
	seedYear(t, app, 2026)
	lift := failUnitCreate(app, "test-unit-b")

	if _, err := ApplyRollForward(app, 2026, 2027); err == nil {
		t.Fatal("first apply succeeded; want the injected failure to surface")
	}

	lift() // whatever broke is fixed; staff click the button again
	if _, err := ApplyRollForward(app, 2026, 2027); err != nil {
		t.Fatalf("retry after a failed apply: %v", err)
	}

	child, err := findByCodeAndYear(app, "lodging_units", "test-unit-a-room-1", 2027)
	if err != nil || child == nil {
		t.Fatalf("child unit missing after the retry: %v", err)
	}
	parent, err := findByCodeAndYear(app, "lodging_units", "test-unit-a", 2027)
	if err != nil || parent == nil {
		t.Fatalf("parent unit missing after the retry: %v", err)
	}
	if got := child.GetString("parent_unit"); got != parent.Id {
		t.Errorf("parent_unit = %q, want the 2027 parent %q -- a retry after a "+
			"partial apply must produce a fully-linked season, not an orphan",
			got, parent.Id)
	}
}

// TestApplyRollForwardSurvivesTheUnitYearGuard is the reason kindred#2039 is
// safe to ship. Extending guardUnitYear to lodging_units means the guard now
// fires on every write the roll-forward makes, inside its transaction, and the
// roll-forward is the only thing in the system that writes a whole season's
// worth of `area` and `parent_unit` at once.
//
// It passes by construction today -- copyUnits resolves `area` into the TARGET
// year and leaves parent_unit unset, and relinkParents resolves the parent by
// (code, targetYear), so every write is same-year. This test exists so that
// stops being something a future reader has to re-derive from rollforward.go.
//
// GREEN BEFORE AND AFTER kindred#2039: a regression guard, not a red-first test.
func TestApplyRollForwardSurvivesTheUnitYearGuard(t *testing.T) {
	t.Parallel()
	app := newRollForwardTestApp(t)
	seedYear(t, app, 2026)

	wireHooks(app)

	plan, err := ApplyRollForward(app, 2026, 2027)
	if err != nil {
		t.Fatalf("the year guard refused the roll-forward: %v", err)
	}
	if plan.UnitsToCreate == 0 {
		t.Fatal("the roll-forward created no units; the assertion above is vacuous")
	}
}
