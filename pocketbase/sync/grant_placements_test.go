package sync

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"slices"
	"strings"
	"testing"
)

// The step POSTs its season to FastAPI's record route and reads back the counts.
func TestPostGrantPlacementsSendsTheYearAndReadsTheCounts(t *testing.T) {
	t.Parallel()
	var gotPath string
	var gotBody map[string]int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"year":2027,"placed":3,"removed":1}`))
	}))
	t.Cleanup(srv.Close)

	counts, err := postGrantPlacements(context.Background(), srv.URL, 2027)
	if err != nil {
		t.Fatalf("postGrantPlacements: %v", err)
	}
	if gotPath != "/api/internal/financial-aid/grant-placements" {
		t.Errorf("path = %q", gotPath)
	}
	if gotBody["year"] != 2027 {
		t.Errorf("body year = %d, want 2027", gotBody["year"])
	}
	if counts != (GrantPlacementCounts{Placed: 3, Removed: 1}) {
		t.Errorf("counts = %+v, want placed 3, removed 1", counts)
	}
}

func TestPostGrantPlacementsReportsANon200(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "boom", http.StatusInternalServerError)
	}))
	t.Cleanup(srv.Close)
	_, err := postGrantPlacements(context.Background(), srv.URL, 2027)
	if err == nil || !strings.Contains(err.Error(), "500") || !strings.Contains(err.Error(), "grant placements") {
		t.Fatalf("err = %v, want a 500 grant placements error", err)
	}
}

// recordingStep is a GrantPlacementsSync whose recorder notes each season it is asked for.
func recordingStep(year int, fail error) (step *GrantPlacementsSync, asked *[]int) {
	asked = &[]int{}
	step = NewGrantPlacementsSync()
	step.Year = year
	step.Record = func(_ context.Context, y int) (GrantPlacementCounts, error) {
		*asked = append(*asked, y)
		return GrantPlacementCounts{Placed: 2, Removed: 1}, fail
	}
	return step, asked
}

// One call for the step's own season, and its counts reach the card.
func TestGrantPlacementsSyncRecordsItsSeason(t *testing.T) {
	t.Parallel()
	s, asked := recordingStep(2027, nil)
	if err := s.Sync(t.Context()); err != nil {
		t.Fatalf("Sync: %v", err)
	}
	if !slices.Equal(*asked, []int{2027}) {
		t.Errorf("recorded %v, want [2027]", *asked)
	}
	if stats := s.GetStats(); stats.Created != 3 || stats.Errors != 0 {
		t.Errorf("stats = %+v, want 3 rows written and no errors", stats)
	}
}

// A dry run never writes, so it never asks FastAPI to record.
func TestGrantPlacementsSyncDryRunNeverRecords(t *testing.T) {
	t.Parallel()
	s, asked := recordingStep(2027, nil)
	s.SetDryRun(true)
	if err := s.Sync(t.Context()); err != nil {
		t.Fatalf("Sync: %v", err)
	}
	if len(*asked) != 0 {
		t.Errorf("a dry run recorded %v", *asked)
	}
}

// 2017-2025 have no aid requests: a historical replay of them records nothing, and is not a failure.
func TestGrantPlacementsSyncSkipsASeasonBeforeTheLog(t *testing.T) {
	t.Parallel()
	for _, year := range []int{2017, 2025} {
		s, asked := recordingStep(year, nil)
		if err := s.Sync(t.Context()); err != nil {
			t.Fatalf("Sync %d: %v", year, err)
		}
		if len(*asked) != 0 || s.GetStats().Errors != 0 {
			t.Errorf("season %d: recorded %v, errors %d; want nothing", year, *asked, s.GetStats().Errors)
		}
	}
	s, asked := recordingStep(firstPlacementSeason, nil)
	if err := s.Sync(t.Context()); err != nil || !slices.Equal(*asked, []int{2026}) {
		t.Errorf("2026: err %v, recorded %v; want [2026]", err, *asked)
	}
}

// A failed record is an error the step's own card shows as FAILED, never a silent green.
func TestGrantPlacementsSyncFailureFailsTheRun(t *testing.T) {
	t.Parallel()
	s, _ := recordingStep(2027, errors.New("financial-aid grant placements returned 500"))
	err := s.Sync(t.Context())
	if err == nil || !strings.Contains(err.Error(), "500") {
		t.Fatalf("Sync err = %v, want the record's error", err)
	}
	stats := s.GetStats()
	if stats.Errors != 1 {
		t.Errorf("errors = %d, want 1", stats.Errors)
	}
	var status Status
	applyCompletionStatus(&status, &stats, err)
	if status.Status != statusFailed {
		t.Errorf("status = %q, want failed", status.Status)
	}
	// Stats describe this run only: the next good run is green again.
	s.Record = func(context.Context, int) (GrantPlacementCounts, error) { return GrantPlacementCounts{}, nil }
	if err := s.Sync(t.Context()); err != nil || s.GetStats().Errors != 0 {
		t.Errorf("next run: err %v, errors %d; want a clean run", err, s.GetStats().Errors)
	}
}

// The step runs after aid_postings on the primary pass, on the N-1 pass too (aid_postings is primary-only, but the
// placements are per season), in a current-season full run, and never in a historical replay.
func TestGrantPlacementsRunsAfterTheAidLedgerForEverySyncedSeason(t *testing.T) {
	t.Parallel()
	const id = "grant_placements"
	if GetPhaseForJob(id) != PhaseTransform {
		t.Fatalf("phase = %q, want transform", GetPhaseForJob(id))
	}
	after := func(queue []string, what string) {
		t.Helper()
		at, ledger := slices.Index(queue, id), slices.Index(queue, "aid_postings")
		if at < 0 || ledger < 0 || at < ledger {
			t.Errorf("%s: grant_placements at %d, aid_postings at %d; want it after", what, at, ledger)
		}
	}
	after(cadenceQueue(CadenceDaily), "daily queue")
	after(GetDefaultUnifiedSyncJobs(false, true), "current-season full run")
	if !slices.Contains(secondarySeasonQueue(CadenceDaily), id) {
		t.Error("the N-1 pass skips grant_placements")
	}
	if slices.Contains(GetDefaultUnifiedSyncJobs(false, false), id) {
		t.Error("a historical replay runs grant_placements")
	}
	for _, m := range syncJobMeta {
		if m.ID == id && (!m.SyncedSeasonsOnly || m.PrimaryOnly) {
			t.Errorf("meta = %+v, want SyncedSeasonsOnly and not PrimaryOnly", m)
		}
	}
}

// Every production GrantPlacementsSync records through FastAPI. The tests build it with their own recorder, so a
// construction site that forgot the wiring would pass every other test and never record in prod.
func TestEveryProductionGrantPlacementsSyncRecords(t *testing.T) {
	t.Parallel()
	src, err := os.ReadFile("orchestrator.go")
	if err != nil {
		t.Fatal(err)
	}
	built := strings.Count(string(src), "NewGrantPlacementsSync(")
	wired := strings.Count(string(src), ".Record = TriggerGrantPlacements")
	if built == 0 || built != wired {
		t.Errorf("orchestrator.go builds %d GrantPlacementsSync and wires the recorder on %d", built, wired)
	}
}
