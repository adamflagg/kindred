package sync

import (
	"slices"
	"testing"
)

// The adult aid Google Form pull's registry row (adult-aid form design §4):
// hourly (and so nightly too: every hourly job is, TestCadenceBitsetOverlap),
// in the Process phase after persons and attendees, an individual
// route and nothing else (a historical replay must never re-pull a live form),
// synced seasons only, gated on Google and a configured form.
func TestAidGoogleFormRegistryRow(t *testing.T) {
	t.Parallel()
	idx := slices.IndexFunc(syncJobMeta, func(m JobMeta) bool { return m.ID == serviceNameAidGoogleFormResponses })
	if idx < 0 {
		t.Fatal("aid_google_form_responses has no syncJobMeta row")
	}
	m := syncJobMeta[idx]
	if m.Phase != PhaseProcess || m.Cadences != CadenceHourly|CadenceDaily || m.Triggers != TriggerIndividualRoute ||
		!m.SyncedSeasonsOnly || m.PrimaryOnly || m.Gate == nil {
		t.Errorf("row = %+v", m)
	}
	for _, dep := range []string{"sessions", "attendees", "persons"} {
		if d := slices.IndexFunc(syncJobMeta, func(m JobMeta) bool { return m.ID == dep }); d > idx {
			t.Errorf("%s is declared after the pull that reads it", dep)
		}
	}
	if slices.Contains(GetDefaultUnifiedSyncJobs(true, true), serviceNameAidGoogleFormResponses) {
		t.Error("a full run includes the live-form pull")
	}
}

// Registered in serialGroups: the gate reads the environment (t.Setenv).
func TestAidGoogleFormGateNeedsGoogleAndAFormID(t *testing.T) {
	cases := []struct {
		enabled, ids string
		want         bool
	}{
		{"", "", false},
		{"true", "", false},
		{"", "2027:abc", false},
		{"false", "2027:abc", false},
		{"true", "2027:abc", true},
	}
	for _, tc := range cases {
		t.Setenv("GOOGLE_SHEETS_ENABLED", tc.enabled)
		t.Setenv(envAidGoogleFormIDs, tc.ids)
		if got := aidGoogleFormConfigured(); got != tc.want {
			t.Errorf("enabled=%q ids=%q: gate = %v, want %v", tc.enabled, tc.ids, got, tc.want)
		}
	}
	t.Setenv("GOOGLE_SHEETS_ENABLED", "true")
	t.Setenv(envAidGoogleFormIDs, "2027:abc")
	if !slices.Contains(cadenceQueue(CadenceHourly), serviceNameAidGoogleFormResponses) {
		t.Error("an open gate leaves the pull off the hourly queue")
	}
	if q := cadenceQueue(CadenceHourly); q[len(q)-1] != serviceNameAidGoogleFormResponses {
		t.Errorf("hourly queue = %v, want the pull after every CampMinder job", q)
	}
}

// Each season's pass builds its own instance for its own year, wired to intake.
func TestServicesForYearBuildsTheAidGoogleFormPull(t *testing.T) {
	t.Parallel()
	o := newTestOrchestrator(t)
	registerTestExport(t, o)
	svc, ok := o.servicesForYear(2026, false)[serviceNameAidGoogleFormResponses].(*AidGoogleFormResponsesSync)
	if !ok {
		t.Fatal("servicesForYear has no aid_google_form_responses instance")
	}
	if svc.Year != 2026 || svc.IntakeTrigger == nil {
		t.Errorf("instance year %d, intake wired %v", svc.Year, svc.IntakeTrigger != nil)
	}
}
