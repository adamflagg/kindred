package sync

import (
	"fmt"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

// ---------------------------------------------------------------------------
// kindred#2279 part (a) + (b) -- the shared guard
// ---------------------------------------------------------------------------

func TestOrphanSweepGuardCheck(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name       string
		computed   int
		existing   int
		wantRefuse bool
	}{
		{"nothing on disk is never a collapse", 0, 0, false},
		{"empty computed set against rows on disk refuses at any size", 0, 1, true},
		{"empty computed set against a full year refuses", 0, 5000, true},
		{"healthy full sweep passes", 5000, 5000, false},
		{"a computed set larger than disk passes", 6000, 5000, false},
		{"a small table is left to the empty-set arm alone", 1, 19, false},
		{"partial collapse at the floor boundary passes", 10, 20, false},
		{"partial collapse just under the floor refuses", 9, 20, true},
		{"the kindred#2279 case: 5 computed against 300 on disk refuses", 5, 300, true},
		{"a normal season's churn passes", 4800, 5000, false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			g := OrphanSweepGuard{Entity: "widgets", Year: 2026, Computed: tc.computed}
			err := g.Check(tc.existing)

			if tc.wantRefuse && err == nil {
				t.Fatalf("Check(%d) with computed=%d returned nil, want a refusal",
					tc.existing, tc.computed)
			}
			if !tc.wantRefuse && err != nil {
				t.Fatalf("Check(%d) with computed=%d refused: %v", tc.existing, tc.computed, err)
			}
			if err != nil && !strings.Contains(err.Error(), "2026") {
				t.Errorf("error %q does not name the year -- an operator cannot tell which season refused",
					err.Error())
			}
			if err != nil && !strings.Contains(err.Error(), "widgets") {
				t.Errorf("error %q does not name the entity", err.Error())
			}
		})
	}
}

// TestOrphanSweepGuardCheckCarriesTheHint proves a service can point the
// operator at its own upstream, which is what the two shipped guards do.
func TestOrphanSweepGuardCheckCarriesTheHint(t *testing.T) {
	t.Parallel()
	g := OrphanSweepGuard{
		Entity:   "staff_vehicle_info",
		Year:     2026,
		Computed: 0,
		Hint:     "check the staff table for that year, and the SVI field routing warnings above",
	}

	err := g.Check(12)
	if err == nil {
		t.Fatal("expected a refusal on an empty computed set")
	}
	if !strings.Contains(err.Error(), "routing") {
		t.Errorf("error %q dropped the service hint", err.Error())
	}
}

// ---------------------------------------------------------------------------
// kindred#2279 Gap 1 -- partial collapse, on every guarded shape
// ---------------------------------------------------------------------------

// TestBaseDeleteOrphansGuardedRefusesPartialCollapse is the kindred#2279 case
// on the shared base sweep: the computed set comes back with a handful of
// entries when hundreds were expected, and the unwidened guard -- which only
// asked "is it empty?" -- waved it through and deleted the rest.
func TestBaseDeleteOrphansGuardedRefusesPartialCollapse(t *testing.T) {
	t.Parallel()
	const (
		seeded   = 300
		computed = 5
	)

	app := newOrphanSweepTestApp(t, "widgets", "name")
	col, err := app.FindCollectionByNameOrId("widgets")
	if err != nil {
		t.Fatalf("find widgets: %v", err)
	}
	for i := 1; i <= seeded; i++ {
		rec := core.NewRecord(col)
		rec.Id = orphanTestID(i)
		rec.Set("name", fmt.Sprintf("widget-%03d", i))
		rec.Set("year", 2026)
		if saveErr := app.Save(rec); saveErr != nil {
			t.Fatalf("seed widget %d: %v", i, saveErr)
		}
	}

	b := BaseSyncService{App: app, ProcessedKeys: map[string]bool{}, SyncSuccessful: true}
	for i := 1; i <= computed; i++ {
		b.ProcessedKeys[fmt.Sprintf("%d|2026", i)] = true
	}

	err = b.DeleteOrphansGuarded(
		"widgets",
		func(record *core.Record) (string, bool) {
			var n int
			if _, scanErr := fmt.Sscanf(record.GetString("name"), "widget-%d", &n); scanErr != nil {
				return "", false
			}
			return fmt.Sprintf("%d|2026", n), true
		},
		"widget",
		"year = 2026",
		OrphanSweepGuard{Entity: "widgets", Year: 2026, Computed: computed},
	)

	if err == nil {
		t.Fatal("expected a refusal: 5 computed against 300 on disk is a collapsed mapping, " +
			"and sweeping it deletes 295 rows while reporting success")
	}
	if remaining := countRows(t, app, "widgets", "year = 2026"); remaining != seeded {
		t.Fatalf("%d rows survived, want %d -- nothing may be deleted on the refusal path", remaining, seeded)
	}
}

// TestBaseDeleteOrphansGuardedStillSweepsNormalChurn proves the widened guard
// did not turn ordinary attrition into a failed sync.
func TestBaseDeleteOrphansGuardedStillSweepsNormalChurn(t *testing.T) {
	t.Parallel()
	const (
		seeded   = 300
		computed = 290
	)

	app := newOrphanSweepTestApp(t, "widgets", "name")
	col, err := app.FindCollectionByNameOrId("widgets")
	if err != nil {
		t.Fatalf("find widgets: %v", err)
	}
	for i := 1; i <= seeded; i++ {
		rec := core.NewRecord(col)
		rec.Id = orphanTestID(i)
		rec.Set("name", fmt.Sprintf("widget-%03d", i))
		rec.Set("year", 2026)
		if saveErr := app.Save(rec); saveErr != nil {
			t.Fatalf("seed widget %d: %v", i, saveErr)
		}
	}

	b := BaseSyncService{App: app, ProcessedKeys: map[string]bool{}, SyncSuccessful: true}
	for i := 1; i <= computed; i++ {
		b.ProcessedKeys[fmt.Sprintf("%d|2026", i)] = true
	}

	err = b.DeleteOrphansGuarded(
		"widgets",
		func(record *core.Record) (string, bool) {
			var n int
			if _, scanErr := fmt.Sscanf(record.GetString("name"), "widget-%d", &n); scanErr != nil {
				return "", false
			}
			return fmt.Sprintf("%d|2026", n), true
		},
		"widget",
		"year = 2026",
		OrphanSweepGuard{Entity: "widgets", Year: 2026, Computed: computed},
	)
	if err != nil {
		t.Fatalf("guard refused a healthy sweep (%d of %d): %v", computed, seeded, err)
	}

	if remaining := countRows(t, app, "widgets", "year = 2026"); remaining != computed {
		t.Fatalf("%d rows survived, want %d -- the guard must not block a genuine sweep", remaining, computed)
	}
}

func TestPersonCustomFieldValuesDeleteOrphansRefusesPartialCollapse(t *testing.T) {
	t.Parallel()
	const seeded = 300

	app := newOrphanSweepTestApp(t, "person_custom_values", "person", "field_definition", "value")
	bulkInsertRows(t, app, "person_custom_values", "person", "pers_0000000001", 2026, seeded)

	s := &PersonCustomFieldValuesSync{BaseSyncService: BaseSyncService{
		App:            app,
		ProcessedKeys:  map[string]bool{},
		SyncSuccessful: true,
	}}
	// A staff/person lookup that died partway: five keys where 300 were expected.
	for i := 1; i <= 5; i++ {
		s.ProcessedKeys[fmt.Sprintf("pers_0000000001:fd%06d|2026", i)] = true
	}

	err := s.deleteOrphans(2026, map[string]bool{"pers_0000000001": true})
	if err == nil {
		t.Fatal("expected a refusal on a collapsed computed set")
	}
	if !strings.Contains(err.Error(), "2026") {
		t.Errorf("error %q does not name the year", err.Error())
	}
	if remaining := countRows(t, app, "person_custom_values", "year = 2026"); remaining != seeded {
		t.Fatalf("%d rows survived, want %d -- nothing may be deleted on the refusal path", remaining, seeded)
	}
}

// TestPersonCustomFieldValuesDeleteOrphansIgnoresPersonsThisRunDidNotFetch is
// the hazard that uncapping the read creates. This service takes a ?session=
// filter, which narrows the run to the persons enrolled in that session, while
// the sweep's own filter is the whole year. Reading the whole year and judging
// it against one session's keys would delete every other session's values.
func TestPersonCustomFieldValuesDeleteOrphansIgnoresPersonsThisRunDidNotFetch(t *testing.T) {
	t.Parallel()
	// Person 2 holds far fewer rows than person 1 on purpose: dropping the
	// scoping has to fail THIS test on the surviving-row count, not by tripping
	// the collapse guard, or the test would not be pinning the scoping at all.
	const (
		person1Rows = 40
		person2Rows = 10
	)

	app := newOrphanSweepTestApp(t, "person_custom_values", "person", "field_definition", "value")
	bulkInsertRows(t, app, "person_custom_values", "person", "pers_0000000001", 2026, person1Rows)
	bulkInsertRowsFrom(t, app, "person_custom_values", "person", "pers_0000000002", 2026,
		person1Rows+1, person1Rows+person2Rows)

	s := &PersonCustomFieldValuesSync{BaseSyncService: BaseSyncService{
		App:            app,
		ProcessedKeys:  map[string]bool{},
		SyncSuccessful: true,
	}}
	// Person 1 was fetched this run and every one of their values came back
	// except the last, which CampMinder really did delete.
	for i := 1; i < person1Rows; i++ {
		s.ProcessedKeys[fmt.Sprintf("pers_0000000001:fd%06d|2026", i)] = true
	}

	// Person 2 was never fetched -- a different session, or a failed fetch.
	if err := s.deleteOrphans(2026, map[string]bool{"pers_0000000001": true}); err != nil {
		t.Fatalf("deleteOrphans: %v", err)
	}

	survivors := countRows(t, app, "person_custom_values", "person = 'pers_0000000002'")
	if survivors != person2Rows {
		t.Fatalf("%d of person 2's rows survived, want %d -- a run that never fetched a person "+
			"must not delete that person's values as orphans", survivors, person2Rows)
	}

	swept := countRows(t, app, "person_custom_values", "person = 'pers_0000000001'")
	if swept != person1Rows-1 {
		t.Fatalf("%d of person 1's rows survived, want %d -- the genuine orphan must still go",
			swept, person1Rows-1)
	}
}

func TestHouseholdCustomFieldValuesDeleteOrphansRefusesPartialCollapse(t *testing.T) {
	t.Parallel()
	const seeded = 300

	app := newOrphanSweepTestApp(t, "household_custom_values", "household", "field_definition", "value")
	bulkInsertRows(t, app, "household_custom_values", "household", "hh_00000000001", 2026, seeded)

	s := &HouseholdCustomFieldValuesSync{BaseSyncService: BaseSyncService{
		App:            app,
		ProcessedKeys:  map[string]bool{},
		SyncSuccessful: true,
	}}
	for i := 1; i <= 5; i++ {
		s.ProcessedKeys[fmt.Sprintf("hh_00000000001:fd%06d|2026", i)] = true
	}

	err := s.deleteOrphans(2026, map[string]bool{"hh_00000000001": true})
	if err == nil {
		t.Fatal("expected a refusal on a collapsed computed set")
	}
	if remaining := countRows(t, app, "household_custom_values", "year = 2026"); remaining != seeded {
		t.Fatalf("%d rows survived, want %d -- nothing may be deleted on the refusal path", remaining, seeded)
	}
}

// TestHouseholdCustomFieldValuesDeleteOrphansIgnoresHouseholdsThisRunDidNotFetch
// mirrors the person case: getHouseholdIDsToSync takes the same ?session=
// filter.
func TestHouseholdCustomFieldValuesDeleteOrphansIgnoresHouseholdsThisRunDidNotFetch(t *testing.T) {
	t.Parallel()
	const (
		household1Rows = 40
		household2Rows = 10
	)

	app := newOrphanSweepTestApp(t, "household_custom_values", "household", "field_definition", "value")
	bulkInsertRows(t, app, "household_custom_values", "household", "hh_00000000001", 2026, household1Rows)
	bulkInsertRowsFrom(t, app, "household_custom_values", "household", "hh_00000000002", 2026,
		household1Rows+1, household1Rows+household2Rows)

	s := &HouseholdCustomFieldValuesSync{BaseSyncService: BaseSyncService{
		App:            app,
		ProcessedKeys:  map[string]bool{},
		SyncSuccessful: true,
	}}
	for i := 1; i < household1Rows; i++ {
		s.ProcessedKeys[fmt.Sprintf("hh_00000000001:fd%06d|2026", i)] = true
	}

	if err := s.deleteOrphans(2026, map[string]bool{"hh_00000000001": true}); err != nil {
		t.Fatalf("deleteOrphans: %v", err)
	}

	survivors := countRows(t, app, "household_custom_values", "household = 'hh_00000000002'")
	if survivors != household2Rows {
		t.Fatalf("%d of household 2's rows survived, want %d", survivors, household2Rows)
	}

	swept := countRows(t, app, "household_custom_values", "household = 'hh_00000000001'")
	if swept != household1Rows-1 {
		t.Fatalf("%d of household 1's rows survived, want %d -- the genuine orphan must still go",
			swept, household1Rows-1)
	}
}

// ---------------------------------------------------------------------------
// kindred#2295 -- rejections make the computed set known-incomplete
// ---------------------------------------------------------------------------

// TestOrphanSweepGuardSkipsWhenRecordsWereRejected pins the new arm. A rejected
// record's key never reaches TrackProcessedKey -- the counter bump and its
// `continue` both happen first -- so it is missing from the computed set for a
// reason that has nothing to do with CampMinder having deleted it. Sweeping
// against that set deletes the row the last good run stored.
func TestOrphanSweepGuardSkipsWhenRecordsWereRejected(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name     string
		rejected int
		wantSkip bool
	}{
		{"a clean run sweeps", 0, false},
		{"one rejected record stops the sweep", 1, true},
		{"a season of rejected records stops the sweep", 412, true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			g := OrphanSweepGuard{Entity: "widgets", Year: 2026, Computed: 5000, Rejected: tc.rejected}
			reason := g.SkipReason()

			if tc.wantSkip && reason == "" {
				t.Fatalf("SkipReason() with rejected=%d returned \"\", want a skip", tc.rejected)
			}
			if !tc.wantSkip && reason != "" {
				t.Fatalf("SkipReason() with rejected=%d skipped the sweep: %s", tc.rejected, reason)
			}
			if reason == "" {
				return
			}
			for _, want := range []string{"widgets", "2026", fmt.Sprint(tc.rejected)} {
				if !strings.Contains(reason, want) {
					t.Errorf("skip reason %q does not name %q -- an operator cannot tell "+
						"which sweep stopped or how big the hole is", reason, want)
				}
			}
		})
	}
}

// TestOrphanSweepGuardSkipReasonOmitsAnUnknownYear pins kindred#2299 row 1. The
// unguarded entry points -- DeleteOrphans and DeleteOrphansFromPreloaded -- have
// no year to pass, so Year is zero for the five per-year services that sweep
// through them (bunks, sessions, session_groups, staff, financial_transactions).
// Printing "for year 0" names a season that does not exist, which is worse than
// naming none: Year's own doc says it is there so an operator knows which sweep
// stopped, and a wrong one sends them looking at the wrong data.
func TestOrphanSweepGuardSkipReasonOmitsAnUnknownYear(t *testing.T) {
	t.Parallel()
	g := OrphanSweepGuard{Entity: "widgets", Rejected: 3} // Year deliberately unset

	reason := g.SkipReason()
	if reason == "" {
		t.Fatal("SkipReason() returned \"\" for a run with rejections")
	}
	if strings.Contains(reason, "year 0") {
		t.Errorf("skip reason %q prints a season that does not exist", reason)
	}
	if !strings.Contains(reason, "widgets") {
		t.Errorf("skip reason %q dropped the entity along with the year", reason)
	}
}

// TestOrphanSweepGuardRejectionsExplainShortfall pins the accounting that decides
// whether a collapse refusal is real (kindred#2299 row 2).
//
// The shortfall is the number of stored rows this run's computed set fails to
// cover. Rejections remove exactly one key each, so they can account for at most
// `Rejected` of it. No threshold is guessed anywhere -- either the arithmetic
// works out or it does not.
func TestOrphanSweepGuardRejectionsExplainShortfall(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name     string
		computed int
		rejected int
		existing int
		want     bool
	}{
		{"the rejections are exactly the shortfall", 49, 1, 50, true},
		{"more rejections than shortfall", 40, 50, 50, true},
		{"a computed set larger than disk has no shortfall", 60, 0, 50, true},
		{"one rejection cannot explain a 45-row hole", 5, 1, 50, false},
		{"no rejections explain nothing", 5, 0, 50, false},
		{"half a season rejected explains half a season missing", 200, 300, 500, true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			g := OrphanSweepGuard{Entity: "widgets", Year: 2026,
				Computed: tc.computed, Rejected: tc.rejected}
			if got := g.RejectionsExplainShortfall(tc.existing); got != tc.want {
				t.Errorf("RejectionsExplainShortfall(%d) = %v, want %v "+
					"(computed=%d rejected=%d)", tc.existing, got, tc.want, tc.computed, tc.rejected)
			}
		})
	}
}

// TestOrphanSweepGuardCheckIgnoresRejections keeps the two verdicts separate.
// A collapse is a failure and Check reports it as an error; a rejection is
// upstream data quality, warn-only for its first season (kindred#2284), and must
// never turn into a returned error. Folding the rejection arm into Check would
// fail the run on one malformed record -- and, worse, abort the rest of a
// multi-collection service before it had synced anything else.
func TestOrphanSweepGuardCheckIgnoresRejections(t *testing.T) {
	t.Parallel()
	g := OrphanSweepGuard{Entity: "widgets", Year: 2026, Computed: 5000, Rejected: 9}

	if err := g.Check(5000); err != nil {
		t.Fatalf("Check refused a healthy computed set because records were rejected: %v -- "+
			"Rejected is warn-only and must not fail a run", err)
	}
}

// TestOrphanSweepRejectionDoesNotMaskACollapse drives the precedence through
// BaseSyncService.deleteOrphans, which is the only place the two verdicts meet.
// The previous version of this test called neither Check nor the sweep, so it
// asserted a precedence it never exercised (kindred#2299 rows 2 and 10).
//
// The rule: Check still runs, and its refusal is fatal UNLESS the rejections can
// account for the whole shortfall. That satisfies both halves at once -- an
// unrelated collapse still fails the run, and a shortfall the rejections do
// explain stays warn-only, as kindred#2284 requires.
func TestOrphanSweepRejectionDoesNotMaskACollapse(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name      string
		computed  int
		rejected  int
		wantErr   bool
		wantAlive int
	}{
		{
			// Check passes; the rejection alone stops the deletes.
			name:     "a rejection on a healthy run skips the sweep",
			computed: seededWidgets - 2, rejected: 1,
			wantErr: false, wantAlive: seededWidgets,
		},
		{
			// The kindred#2279 collapse, with one unrelated rejection alongside it.
			// One rejection cannot account for 45 missing keys, so the refusal stands.
			name:     "one rejection does not excuse a collapse it cannot explain",
			computed: 5, rejected: 1,
			wantErr: true, wantAlive: seededWidgets,
		},
		{
			// The same shortfall, but now the rejections account for all of it.
			// Failing here would fail a run on warn-only rejections.
			name:     "rejections that explain the whole shortfall stay warn-only",
			computed: 5, rejected: seededWidgets,
			wantErr: false, wantAlive: seededWidgets,
		},
		{
			// Negative control: no rejections, healthy computed set, sweep proceeds.
			name:     "a clean run still collects its orphans",
			computed: seededWidgets - 2, rejected: 0,
			wantErr: false, wantAlive: seededWidgets - 2,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			app, b := rejectingSweepFixture(t, tc.rejected)

			err := b.DeleteOrphansGuarded("widgets", widgetIDFunc, "widget", "year = 2026",
				OrphanSweepGuard{Entity: "widgets", Year: 2026, Computed: tc.computed})

			if tc.wantErr && err == nil {
				t.Fatal("no error -- a collapse the rejections cannot explain was reported as a " +
					"benign skip, which is exactly the masking this guard must not do")
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("returned %v, want nil", err)
			}
			if alive := countRows(t, app, "widgets", "year = 2026"); alive != tc.wantAlive {
				t.Fatalf("%d rows survived, want %d", alive, tc.wantAlive)
			}
		})
	}
}
