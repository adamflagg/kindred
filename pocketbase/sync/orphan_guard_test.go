package sync

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	pbtests "github.com/pocketbase/pocketbase/tests"
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

// ---------------------------------------------------------------------------
// kindred#2283 row 2 -- classifying a sweep failure
// ---------------------------------------------------------------------------

// TestWrapOrphanSweepError pins the distinction kindred#2280 settled on
// staff_vehicle_info.go and staff_applications.go: a guard refusal and a
// cancelled context are different operational facts and must not share a
// message. "Refused" tells an operator the CampMinder feed is not to be
// trusted; "interrupted" tells them the run ran out of time. Reporting the
// second as the first sends them to look at data that is fine.
//
// The wording here is copied from those two files deliberately -- the value is
// that every guarded sweep in the package reads the same, so this helper is the
// one place the phrasing lives rather than a seventh hand-written copy.
func TestWrapOrphanSweepError(t *testing.T) {
	t.Parallel()

	guardErr := OrphanSweepGuard{Entity: "widgets", Year: 2026, Computed: 0}.Check(50)
	if guardErr == nil {
		t.Fatal("fixture is wrong: an empty computed set against 50 rows must refuse")
	}

	tests := []struct {
		name       string
		in         error
		wantPrefix string
	}{
		{"a guard refusal is a refusal", guardErr, "orphan sweep refused: "},
		{"a cancelled context is an interruption", context.Canceled, "orphan sweep interrupted: "},
		{"an expired deadline is an interruption", context.DeadlineExceeded, "orphan sweep interrupted: "},
		{
			"a wrapped cancellation is still an interruption",
			fmt.Errorf("deleting row 12: %w", context.Canceled),
			"orphan sweep interrupted: ",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := wrapOrphanSweepError(tc.in)
			if got == nil {
				t.Fatalf("wrapOrphanSweepError(%v) = nil, want an error", tc.in)
			}
			if !strings.HasPrefix(got.Error(), tc.wantPrefix) {
				t.Errorf("wrapOrphanSweepError(%v) = %q, want prefix %q", tc.in, got.Error(), tc.wantPrefix)
			}
			// The cause must survive wrapping, or callers upstream lose the
			// ability to tell cancellation from refusal themselves.
			if !errors.Is(got, tc.in) {
				t.Errorf("wrapOrphanSweepError(%v) does not unwrap to its cause", tc.in)
			}
		})
	}

	t.Run("nil in, nil out", func(t *testing.T) {
		t.Parallel()
		if got := wrapOrphanSweepError(nil); got != nil {
			t.Errorf("wrapOrphanSweepError(nil) = %v, want nil", got)
		}
	})
}

// ---------------------------------------------------------------------------
// kindred#2283 row 1 -- caller propagation for the person_custom_values syncs
// ---------------------------------------------------------------------------

// newCustomValuesSyncTestApp builds the collections the four
// person_custom_values-driven syncs read on their way to the orphan sweep.
// Shared because those four load the same shape: a field definition, the values
// pointing at it, the persons those values belong to, and an attendee row per
// person to hang the relation on.
func newCustomValuesSyncTestApp(t *testing.T, target string, targetFields ...string) core.App {
	t.Helper()
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)

	created := func(col *core.Collection) {
		col.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	}

	persons := core.NewBaseCollection("persons")
	persons.Fields.Add(&core.NumberField{Name: "cm_id"})
	persons.Fields.Add(&core.NumberField{Name: "year"})
	for _, f := range []string{"first_name", "last_name"} {
		persons.Fields.Add(&core.TextField{Name: f})
	}
	created(persons)
	if err := app.Save(persons); err != nil {
		t.Fatalf("create persons: %v", err)
	}

	// camper_transportation reads the session CM ID by EXPANDING this relation,
	// not from a session_id column, so the relation has to be real.
	campSessions := core.NewBaseCollection("camp_sessions")
	campSessions.Fields.Add(&core.NumberField{Name: "cm_id"})
	campSessions.Fields.Add(&core.TextField{Name: "name"})
	created(campSessions)
	if err := app.Save(campSessions); err != nil {
		t.Fatalf("create camp_sessions: %v", err)
	}

	attendees := core.NewBaseCollection("attendees")
	attendees.Fields.Add(&core.NumberField{Name: "person_id"})
	attendees.Fields.Add(&core.NumberField{Name: "session_id"})
	attendees.Fields.Add(&core.RelationField{Name: "session", CollectionId: campSessions.Id, MaxSelect: 1})
	attendees.Fields.Add(&core.NumberField{Name: "year"})
	created(attendees)
	if err := app.Save(attendees); err != nil {
		t.Fatalf("create attendees: %v", err)
	}

	defs := core.NewBaseCollection("custom_field_defs")
	defs.Fields.Add(&core.TextField{Name: "name"})
	defs.Fields.Add(&core.TextField{Name: "partition"})
	// staff_skills skips any definition whose cm_id is 0, so the fixture needs
	// a real one or its Sync() bails before it ever reaches the sweep.
	defs.Fields.Add(&core.NumberField{Name: "cm_id"})
	defs.Fields.Add(&core.NumberField{Name: "year"})
	created(defs)
	if err := app.Save(defs); err != nil {
		t.Fatalf("create custom_field_defs: %v", err)
	}

	values := core.NewBaseCollection("person_custom_values")
	values.Fields.Add(&core.TextField{Name: "person"})
	values.Fields.Add(&core.TextField{Name: "field_definition"})
	values.Fields.Add(&core.TextField{Name: "value"})
	values.Fields.Add(&core.NumberField{Name: "year"})
	created(values)
	if err := app.Save(values); err != nil {
		t.Fatalf("create person_custom_values: %v", err)
	}

	col := core.NewBaseCollection(target)
	col.Fields.Add(&core.NumberField{Name: "person_id"})
	col.Fields.Add(&core.NumberField{Name: "session_id"})
	col.Fields.Add(&core.NumberField{Name: "skill_cm_id"})
	// Required, per the year invariant every CampMinder-derived table carries.
	col.Fields.Add(&core.NumberField{Name: "year", Required: true})
	for _, f := range targetFields {
		col.Fields.Add(&core.TextField{Name: f})
	}
	col.Fields.Add(&core.TextField{Name: "person"})
	col.Fields.Add(&core.TextField{Name: "attendee"})
	created(col)
	if err := app.Save(col); err != nil {
		t.Fatalf("create %s: %v", target, err)
	}

	return app
}

// seedCustomValuesRun writes `computed` campers who each answered `fieldName`
// this year, plus `existing` rows already stored in `target` that this run does
// not account for. The ratio is what trips OrphanSweepGuard.
func seedCustomValuesRun(t *testing.T, app core.App, target, fieldName, partition string, computed, existing int) {
	t.Helper()

	defs, err := app.FindCollectionByNameOrId("custom_field_defs")
	if err != nil {
		t.Fatalf("find custom_field_defs: %v", err)
	}
	def := core.NewRecord(defs)
	def.Set("name", fieldName)
	def.Set("partition", partition)
	def.Set("cm_id", 77)
	def.Set("year", 2026)
	if saveErr := app.Save(def); saveErr != nil {
		t.Fatalf("save field def: %v", saveErr)
	}

	personsCol, _ := app.FindCollectionByNameOrId("persons")
	attendeesCol, _ := app.FindCollectionByNameOrId("attendees")
	valuesCol, _ := app.FindCollectionByNameOrId("person_custom_values")
	sessionsCol, _ := app.FindCollectionByNameOrId("camp_sessions")

	sess := core.NewRecord(sessionsCol)
	sess.Set("cm_id", 200)
	sess.Set("name", "Session A")
	if saveErr := app.Save(sess); saveErr != nil {
		t.Fatalf("save camp session: %v", saveErr)
	}
	for i := range computed {
		cmID := 101 + i
		p := core.NewRecord(personsCol)
		p.Set("cm_id", cmID)
		p.Set("year", 2026)
		if saveErr := app.Save(p); saveErr != nil {
			t.Fatalf("save person %d: %v", cmID, saveErr)
		}
		a := core.NewRecord(attendeesCol)
		a.Set("person_id", cmID)
		a.Set("session_id", 200)
		a.Set("session", sess.Id)
		a.Set("year", 2026)
		if saveErr := app.Save(a); saveErr != nil {
			t.Fatalf("save attendee %d: %v", cmID, saveErr)
		}
		v := core.NewRecord(valuesCol)
		v.Set("person", p.Id)
		v.Set("field_definition", def.Id)
		v.Set("value", "Yes")
		v.Set("year", 2026)
		if saveErr := app.Save(v); saveErr != nil {
			t.Fatalf("save custom value %d: %v", cmID, saveErr)
		}
	}

	targetCol, err := app.FindCollectionByNameOrId(target)
	if err != nil {
		t.Fatalf("find %s: %v", target, err)
	}
	for i := range existing {
		rec := core.NewRecord(targetCol)
		rec.Set("person_id", 900+i)
		rec.Set("session_id", 200)
		rec.Set("skill_cm_id", 300+i)
		rec.Set("year", 2026)
		if err := app.Save(rec); err != nil {
			t.Fatalf("save existing row %d: %v", i, err)
		}
	}
}

// assertSweepRefusalReachesCaller runs syncFn and requires the sweep refusal to
// come back out of it, with nothing deleted. This is the kindred#2294 gap: the
// guard tests prove deleteOrphans REFUSES, and prove nothing about whether the
// caller listens.
func assertSweepRefusalReachesCaller(t *testing.T, app core.App, target string, wantRows int, syncErr error) {
	t.Helper()

	if syncErr == nil {
		t.Fatal("Sync returned nil on a refused sweep -- the refusal never reached the caller")
	}
	if !strings.Contains(syncErr.Error(), "orphan sweep refused") {
		t.Errorf("Sync error = %q, want it to carry the sweep refusal", syncErr.Error())
	}
	remaining, err := app.FindRecordsByFilter(target, "year = 2026 && person_id >= 900", "", 0, 0)
	if err != nil {
		t.Fatalf("re-query %s: %v", target, err)
	}
	if len(remaining) != wantRows {
		t.Errorf("%d seeded rows survived, want %d -- a refused sweep must delete nothing",
			len(remaining), wantRows)
	}
}

func TestCamperDietarySyncPropagatesSweepRefusal(t *testing.T) {
	t.Parallel()
	app := newCustomValuesSyncTestApp(t, "camper_dietary", "allergy_info")
	seedCustomValuesRun(t, app, "camper_dietary", "Family Medical-Allergy Info", "", 3, OrphanSweepMinRows+5)

	s := NewCamperDietarySync(app)
	s.Year = 2026
	assertSweepRefusalReachesCaller(t, app, "camper_dietary", OrphanSweepMinRows+5, s.Sync(context.Background()))
}

func TestCamperTransportationSyncPropagatesSweepRefusal(t *testing.T) {
	t.Parallel()
	app := newCustomValuesSyncTestApp(t, "camper_transportation", "to_camp_method")
	seedCustomValuesRun(t, app, "camper_transportation", "BUS-To Camp", "", 3, OrphanSweepMinRows+5)

	s := NewCamperTransportationSync(app)
	s.Year = 2026
	assertSweepRefusalReachesCaller(t, app, "camper_transportation", OrphanSweepMinRows+5, s.Sync(context.Background()))
}

func TestQuestRegistrationsSyncPropagatesSweepRefusal(t *testing.T) {
	t.Parallel()
	app := newCustomValuesSyncTestApp(t, "quest_registrations", "quest_status")
	seedCustomValuesRun(t, app, "quest_registrations", "Quest-Status", "", 3, OrphanSweepMinRows+5)

	s := NewQuestRegistrationsSync(app)
	s.Year = 2026
	assertSweepRefusalReachesCaller(t, app, "quest_registrations", OrphanSweepMinRows+5, s.Sync(context.Background()))
}

func TestStaffSkillsSyncPropagatesSweepRefusal(t *testing.T) {
	t.Parallel()
	app := newCustomValuesSyncTestApp(t, "staff_skills", "skill_name", "raw_value")
	seedCustomValuesRun(t, app, "staff_skills", "Skills-Archery", partitionStaff, 3, OrphanSweepMinRows+5)

	s := NewStaffSkillsSync(app)
	s.Year = 2026
	assertSweepRefusalReachesCaller(t, app, "staff_skills", OrphanSweepMinRows+5, s.Sync(context.Background()))
}

// TestDeleteOrphansReturnsContextErrorOnCancellation closes the loop on the
// classification above. wrapOrphanSweepError only reports "interrupted" if what
// reaches it is genuinely a context error, so this pins the other half: a
// cancelled sweep returns ctx.Err() rather than a nil error and a short count.
// Together the two mean a cancelled run cannot be reported as a data refusal.
func TestDeleteOrphansReturnsContextErrorOnCancellation(t *testing.T) {
	t.Parallel()
	app := newCustomValuesSyncTestApp(t, "camper_dietary", "allergy_info")
	col, err := app.FindCollectionByNameOrId("camper_dietary")
	if err != nil {
		t.Fatalf("find camper_dietary: %v", err)
	}

	// Enough rows on disk, and a computed set large enough to clear the guard,
	// so the only thing that can stop the sweep is the cancellation.
	existing := make(map[string]string, OrphanSweepMinRows+5)
	computed := make(map[string]*camperDietaryRecord, OrphanSweepMinRows+5)
	for i := range OrphanSweepMinRows + 5 {
		rec := core.NewRecord(col)
		rec.Set("person_id", 900+i)
		rec.Set("year", 2026)
		if saveErr := app.Save(rec); saveErr != nil {
			t.Fatalf("save row %d: %v", i, saveErr)
		}
		existing[makeCamperDietaryKey(900+i, 2026)] = rec.Id
		computed[makeCamperDietaryKey(900+i, 2026)] = &camperDietaryRecord{personID: 900 + i}
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	s := NewCamperDietarySync(app)
	// Set explicitly because this drives deleteOrphans directly rather than
	// through Sync(), which is what normally sets it from the size of the
	// extraction (kindred#2283 rows 3+4). The three ProcessedKeys-based syncs
	// have always required this of their tests; these four now match.
	s.SyncSuccessful = true
	deleted, err := s.deleteOrphans(ctx, computed, existing, 2026)

	if !errors.Is(err, context.Canceled) {
		t.Fatalf("deleteOrphans on a cancelled context returned %v, want context.Canceled", err)
	}
	if deleted != 0 {
		t.Errorf("deleted = %d, want 0 -- a cancelled sweep should stop before deleting", deleted)
	}
	// And the caller's wrapping must call that an interruption, not a refusal.
	if got := wrapOrphanSweepError(err).Error(); !strings.HasPrefix(got, "orphan sweep interrupted: ") {
		t.Errorf("a cancelled sweep is reported as %q, want it classified as interrupted", got)
	}
}

// ---------------------------------------------------------------------------
// kindred#2283 rows 3+4 -- a genuinely empty upstream must not wedge the sweep
// ---------------------------------------------------------------------------

// assertEmptyUpstreamSkipsSweep pins the policy BaseSyncService.DeleteOrphans
// already implements (base_sync.go: "Only delete orphans if the sync was
// successful", with SyncSuccessful gated on rows actually arriving): a source
// that legitimately returns nothing is not a collapse, so the sweep is SKIPPED
// and the run succeeds, leaving what is on disk alone.
//
// Before this, these four refused instead -- and because a refused sweep never
// clears the rows, `existing` stayed high and the refusal repeated on every
// subsequent run. The table could not drain and the sync could not go green.
//
// Asserted against the database, not the return value: "reported success" and
// "deleted nothing" are separate claims and the interesting failure satisfies
// only the first.
func assertEmptyUpstreamSkipsSweep(t *testing.T, app core.App, target string, wantRows int, syncErr error) {
	t.Helper()

	if syncErr != nil {
		t.Fatalf("Sync on an empty upstream returned %v, want nil -- an empty source is not a collapse", syncErr)
	}
	remaining, err := app.FindRecordsByFilter(target, "year = 2026", "", 0, 0)
	if err != nil {
		t.Fatalf("re-query %s: %v", target, err)
	}
	if len(remaining) != wantRows {
		t.Errorf("%d rows survived, want %d -- an empty upstream must skip the sweep, not run it",
			len(remaining), wantRows)
	}
}

func TestCamperDietaryEmptyUpstreamSkipsSweep(t *testing.T) {
	t.Parallel()
	app := newCustomValuesSyncTestApp(t, "camper_dietary", "allergy_info")
	seedCustomValuesRun(t, app, "camper_dietary", "Family Medical-Allergy Info", "", 0, OrphanSweepMinRows+5)

	s := NewCamperDietarySync(app)
	s.Year = 2026
	assertEmptyUpstreamSkipsSweep(t, app, "camper_dietary", OrphanSweepMinRows+5, s.Sync(context.Background()))
}

func TestCamperTransportationEmptyUpstreamSkipsSweep(t *testing.T) {
	t.Parallel()
	app := newCustomValuesSyncTestApp(t, "camper_transportation", "to_camp_method")
	seedCustomValuesRun(t, app, "camper_transportation", "BUS-To Camp", "", 0, OrphanSweepMinRows+5)

	s := NewCamperTransportationSync(app)
	s.Year = 2026
	assertEmptyUpstreamSkipsSweep(t, app, "camper_transportation", OrphanSweepMinRows+5, s.Sync(context.Background()))
}

func TestQuestRegistrationsEmptyUpstreamSkipsSweep(t *testing.T) {
	t.Parallel()
	app := newCustomValuesSyncTestApp(t, "quest_registrations", "quest_status")
	seedCustomValuesRun(t, app, "quest_registrations", "Quest-Status", "", 0, OrphanSweepMinRows+5)

	s := NewQuestRegistrationsSync(app)
	s.Year = 2026
	assertEmptyUpstreamSkipsSweep(t, app, "quest_registrations", OrphanSweepMinRows+5, s.Sync(context.Background()))
}

// --- negative controls: the gate must not disable orphan deletion ------------

// assertNonEmptyUpstreamStillSweeps is the other half. A gate that skips the
// sweep whenever it is unsure would pass every test above and quietly stop
// deleting anything, which is the failure the guard exists to avoid in reverse.
func assertNonEmptyUpstreamStillSweeps(t *testing.T, app core.App, target string, syncErr error) {
	t.Helper()

	if syncErr != nil {
		t.Fatalf("Sync on a healthy run returned %v, want nil", syncErr)
	}
	orphans, err := app.FindRecordsByFilter(target, "year = 2026 && person_id = 999", "", 0, 0)
	if err != nil {
		t.Fatalf("re-query %s: %v", target, err)
	}
	if len(orphans) != 0 {
		t.Errorf("the genuine orphan survived -- a non-empty upstream must still sweep")
	}
}

// seedOrphanOnly writes a single row this run will not account for, small enough
// that the ratio arm does not apply and only the sweep itself is under test.
func seedOrphanOnly(t *testing.T, app core.App, target string) {
	t.Helper()
	col, err := app.FindCollectionByNameOrId(target)
	if err != nil {
		t.Fatalf("find %s: %v", target, err)
	}
	rec := core.NewRecord(col)
	rec.Set("person_id", 999)
	rec.Set("session_id", 200)
	rec.Set("skill_cm_id", 999)
	rec.Set("year", 2026)
	if saveErr := app.Save(rec); saveErr != nil {
		t.Fatalf("save orphan: %v", saveErr)
	}
}

func TestCamperDietaryNonEmptyUpstreamStillSweeps(t *testing.T) {
	t.Parallel()
	app := newCustomValuesSyncTestApp(t, "camper_dietary", "allergy_info")
	seedCustomValuesRun(t, app, "camper_dietary", "Family Medical-Allergy Info", "", 3, 0)
	seedOrphanOnly(t, app, "camper_dietary")

	s := NewCamperDietarySync(app)
	s.Year = 2026
	assertNonEmptyUpstreamStillSweeps(t, app, "camper_dietary", s.Sync(context.Background()))
}

func TestCamperTransportationNonEmptyUpstreamStillSweeps(t *testing.T) {
	t.Parallel()
	app := newCustomValuesSyncTestApp(t, "camper_transportation", "to_camp_method")
	seedCustomValuesRun(t, app, "camper_transportation", "BUS-To Camp", "", 3, 0)
	seedOrphanOnly(t, app, "camper_transportation")

	s := NewCamperTransportationSync(app)
	s.Year = 2026
	assertNonEmptyUpstreamStillSweeps(t, app, "camper_transportation", s.Sync(context.Background()))
}

func TestQuestRegistrationsNonEmptyUpstreamStillSweeps(t *testing.T) {
	t.Parallel()
	app := newCustomValuesSyncTestApp(t, "quest_registrations", "quest_status")
	seedCustomValuesRun(t, app, "quest_registrations", "Quest-Status", "", 3, 0)
	seedOrphanOnly(t, app, "quest_registrations")

	s := NewQuestRegistrationsSync(app)
	s.Year = 2026
	assertNonEmptyUpstreamStillSweeps(t, app, "quest_registrations", s.Sync(context.Background()))
}
