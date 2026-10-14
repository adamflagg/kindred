package sync

import (
	"testing"
	"time"

	"github.com/camp/kindred/pocketbase/campminder"
)

// registerTestExport registers a *MultiWorkbookExport the way InitializeSyncServices does when
// Google Sheets is configured. servicesForYear builds a season's export from the registered
// one's writer and workbook manager, so without it there is no export to scope.
func registerTestExport(t *testing.T, o *Orchestrator) *MultiWorkbookExport {
	t.Helper()
	exp, err := NewMultiWorkbookExport(nil, nil, nil, 2027)
	if err != nil {
		t.Fatalf("NewMultiWorkbookExport: %v", err)
	}
	o.RegisterService("multi_workbook_export", exp)
	return exp
}

// TestServicesForYearCoversEveryDailyAndWeeklyJob pins that the N-1 pass has its own instance
// for every job it runs. A job missing from the map would make the pass fall back to the
// primary's registered instance, or skip the job.
//
// Every daily job that is neither PrimaryOnly nor global is checked, regardless of the environment gates
// (Jotform key, Docker, Google): the gates decide whether a queue runs a job, not whether the
// factory can build it. Every job the historical replay used to re-register is checked too,
// because RunSyncWithOptions now takes its instances from this one factory.
func TestServicesForYearCoversEveryDailyAndWeeklyJob(t *testing.T) {
	t.Parallel()
	o := newTestOrchestrator(t)
	registerTestExport(t, o)
	svcs := o.servicesForYear(2026, false)

	want := []string{"multi_workbook_export", "bunk_assignments"}
	for _, m := range syncJobMeta {
		if m.Cadences&CadenceDaily != 0 && !m.PrimaryOnly && m.Phase != PhaseGlobal {
			want = append(want, m.ID)
		}
	}
	// What the replay registered before this factory existed (it must still find them all).
	want = append(want,
		"session_groups", "sessions", "attendees", "persons", "bunks", "bunk_plans",
		"reconcile_request_lifecycle", "bunk_requests", "process_requests", "staff",
		"financial_transactions", "family_camp_derived", "lodging_assignments", "staff_skills",
		"financial_aid_applications", "aid_postings", "household_demographics", "camper_dietary",
		"camper_transportation", "quest_registrations", "staff_applications",
		"staff_vehicle_info", "normalize_geographic", "enrollment_snapshots",
		"stranded_assignment_cleanup", "person_custom_values", "household_custom_values",
		"jotform_submissions",
	)
	want = append(want, ScopedJobs(ScopeFamilyCamp)...)

	for _, id := range want {
		if _, ok := svcs[id]; !ok {
			t.Errorf("servicesForYear has no instance for %s; the N-1 pass would fall back to the primary", id)
		}
	}

	// Globals are not per-season: a season pass must never re-run them under a season's year.
	globals := []string{"person_tag_defs", "custom_field_defs", "divisions", "staff_lookups", "financial_lookups"}
	for _, id := range globals {
		if _, ok := svcs[id]; ok {
			t.Errorf("servicesForYear built %s, a global job; a season pass must not run it", id)
		}
	}
}

// TestServicesForYearSetsTheYear pins that the jobs which read their season from a field get
// it set. jotform_submissions and process_requests are the two the replay used to miss: they
// ran against the primary whatever year the replay was for.
func TestServicesForYearSetsTheYear(t *testing.T) {
	t.Parallel()
	o := newTestOrchestrator(t)
	registered := registerTestExport(t, o)
	svcs := o.servicesForYear(2026, false)

	j, ok := svcs["jotform_submissions"].(*JotformSubmissionsSync)
	if !ok || j.Year != 2026 {
		t.Fatalf("jotform_submissions must be scoped to 2026, got %+v", svcs["jotform_submissions"])
	}
	p, ok := svcs["process_requests"].(*RequestProcessor)
	if !ok || p.Year != 2026 {
		t.Fatalf("process_requests must be scoped to 2026, got %+v", svcs["process_requests"])
	}
	exp, ok := svcs["multi_workbook_export"].(*MultiWorkbookExport)
	if !ok || exp.year != 2026 {
		t.Fatalf("multi_workbook_export must be scoped to 2026, got %+v", svcs["multi_workbook_export"])
	}
	if exp == registered {
		t.Fatal("multi_workbook_export must be a fresh instance, not the registered singleton")
	}
	l, ok := svcs["lodging_assignments"].(*LodgingAssignmentsSync)
	if !ok || l.Year != 2026 {
		t.Fatalf("lodging_assignments must be scoped to 2026, got %+v", svcs["lodging_assignments"])
	}
}

// TestServicesForYearClonesTheClientForTheSeason pins the client-backed half: each one reads
// CampMinder through a client cloned to the season, never through the boot client.
func TestServicesForYearClonesTheClientForTheSeason(t *testing.T) {
	t.Setenv("CAMPMINDER_PRIMARY_KEY", "test-key")
	o := newTestOrchestrator(t)
	boot, err := campminder.NewClient(&campminder.Config{APIKey: "k", ClientID: "c", SeasonID: 2027})
	if err != nil {
		t.Fatalf("campminder.NewClient: %v", err)
	}
	o.baseClient = boot
	svcs := o.servicesForYear(2026, false)

	a, ok := svcs["attendees"].(*AttendeesSync)
	if !ok || a.Client == nil || a.Client.GetSeasonID() != 2026 {
		t.Fatalf("attendees must read CampMinder for 2026, got %+v", svcs["attendees"])
	}
	if a.Client == boot {
		t.Fatal("attendees must get a clone, not the boot client")
	}
	if boot.GetSeasonID() != 2027 {
		t.Fatalf("building a season's services moved the boot client to %d", boot.GetSeasonID())
	}
}

// withNow pins the season rule's clock for one (serial) test.
func withNow(t *testing.T, now time.Time) {
	t.Helper()
	orig := nowFn
	t.Cleanup(func() { nowFn = orig })
	nowFn = func() time.Time { return now }
}

// TestSecondarySeasonQueueSkipsGlobals pins spec §5's "global tables are not per-season and run
// once": financial_lookups carries CadenceDaily, but it has no season, so the N-1 pass must not
// run it a second time.
func TestSecondarySeasonQueueSkipsGlobals(t *testing.T) {
	t.Parallel()
	for _, id := range secondarySeasonQueue(CadenceDaily) {
		if GetPhaseForJob(id) == PhaseGlobal {
			t.Errorf("%s is a global job; the N-1 pass must not run it", id)
		}
	}
}
