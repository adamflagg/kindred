package sync

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPostFinancialAidIntakeSendsTheYear(t *testing.T) {
	t.Parallel()
	var gotPath string
	var gotBody map[string]int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"year":2027}`))
	}))
	t.Cleanup(srv.Close)

	if _, err := postFinancialAidIntake(context.Background(), srv.URL, 2027); err != nil {
		t.Fatalf("postFinancialAidIntake: %v", err)
	}
	if gotPath != "/api/internal/financial-aid/intake" {
		t.Errorf("path = %q", gotPath)
	}
	if gotBody["year"] != 2027 {
		t.Errorf("body year = %d, want 2027", gotBody["year"])
	}
}

func TestPostFinancialAidIntakeReportsANon200(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "boom", http.StatusInternalServerError)
	}))
	t.Cleanup(srv.Close)

	_, err := postFinancialAidIntake(context.Background(), srv.URL, 2027)
	if err == nil || !strings.Contains(err.Error(), "500") {
		t.Fatalf("err = %v, want a 500 error", err)
	}
}

// Intake counts the form rows that made no request, and those with no household, and used to throw both away:
// the Go caller checked only the status. It now reads the counts (numbers only, never a name) to log them.
func TestPostFinancialAidIntakeReadsTheRowsThatMadeNoRequest(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"year":2027,"households":12,"requests_created":2,"requests_updated":3,` +
			`"rows_without_request":4,"rows_without_household":1,"operation_id":"op0000000000001","warnings":[]}`))
	}))
	t.Cleanup(srv.Close)

	report, err := postFinancialAidIntake(context.Background(), srv.URL, 2027)
	if err != nil {
		t.Fatalf("postFinancialAidIntake: %v", err)
	}
	want := intakeReportCounts{
		Households: 12, RequestsCreated: 2, RequestsUpdated: 3, RowsWithoutRequest: 4, RowsWithoutHousehold: 1,
	}
	if report != want {
		t.Errorf("report = %+v, want %+v", report, want)
	}
}

func TestPostFinancialAidIntakeToleratesAReportItCannotRead(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`not json`))
	}))
	t.Cleanup(srv.Close)

	// Intake ran (200): an unreadable report is only a missing log line, never a failed rebuild.
	report, err := postFinancialAidIntake(context.Background(), srv.URL, 2027)
	if err != nil {
		t.Fatalf("postFinancialAidIntake: %v", err)
	}
	if report != (intakeReportCounts{}) {
		t.Errorf("report = %+v, want zero", report)
	}
}

func TestRunIntakeTriggerCountsAFailureAsAnError(t *testing.T) {
	t.Parallel()
	s := &FinancialAidApplicationsSync{IntakeTrigger: func(context.Context, int) error { return errors.New("down") }}
	s.runIntakeTrigger(context.Background(), 2027)
	if s.Stats.Errors != 1 {
		t.Errorf("Stats.Errors = %d, want 1", s.Stats.Errors)
	}
}

func TestRunIntakeTriggerPassesTheYearAndToleratesNoTrigger(t *testing.T) {
	t.Parallel()
	var got int
	s := &FinancialAidApplicationsSync{IntakeTrigger: func(_ context.Context, year int) error { got = year; return nil }}
	s.runIntakeTrigger(context.Background(), 2027)
	if got != 2027 || s.Stats.Errors != 0 {
		t.Errorf("year = %d errors = %d, want 2027 and 0", got, s.Stats.Errors)
	}
	(&FinancialAidApplicationsSync{}).runIntakeTrigger(context.Background(), 2027) // nil trigger: no panic
}

// #2844 replays the FA transform for season N+1 while N is still live. The trigger
// must rebuild the season the run was FOR (s.Year), never the configured one. The
// test sets no CAMPMINDER_SEASON_ID at all, so a trigger that re-read the
// environment would get 0 or an error, not faTestYear+1.
func TestFASync_TriggersIntakeForTheYearItRan(t *testing.T) {
	t.Parallel()
	app := newFAApplicationsTestApp(t)
	var got []int
	s := NewFinancialAidApplicationsSync(app)
	s.Year = faTestYear + 1
	s.IntakeTrigger = func(_ context.Context, year int) error { got = append(got, year); return nil }
	if err := s.Sync(context.Background()); err != nil {
		t.Fatalf("Sync: %v", err)
	}
	if len(got) != 1 || got[0] != faTestYear+1 {
		t.Errorf("intake triggered for %v, want exactly [%d]", got, faTestYear+1)
	}
}

func TestFASync_DryRunNeverTriggersIntake(t *testing.T) {
	t.Parallel()
	app := newFAApplicationsTestApp(t)
	called := false
	s := NewFinancialAidApplicationsSync(app)
	s.Year = faTestYear
	s.DryRun = true
	s.IntakeTrigger = func(context.Context, int) error { called = true; return nil }
	if err := s.Sync(context.Background()); err != nil {
		t.Fatalf("Sync: %v", err)
	}
	if called {
		t.Error("a dry run triggered intake")
	}
}
