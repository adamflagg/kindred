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

func TestPostFinancialAidLedgerTicksSendsTheYear(t *testing.T) {
	t.Parallel()
	var gotPath string
	var gotBody map[string]int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"year":2027,"ticked":0,"operation_id":""}`))
	}))
	t.Cleanup(srv.Close)

	if err := postFinancialAidLedgerTicks(context.Background(), srv.URL, 2027); err != nil {
		t.Fatalf("postFinancialAidLedgerTicks: %v", err)
	}
	if gotPath != "/api/internal/financial-aid/ledger-ticks" {
		t.Errorf("path = %q", gotPath)
	}
	if gotBody["year"] != 2027 {
		t.Errorf("body year = %d, want 2027", gotBody["year"])
	}
}

func TestPostFinancialAidLedgerTicksReportsANon200(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "boom", http.StatusInternalServerError)
	}))
	t.Cleanup(srv.Close)
	err := postFinancialAidLedgerTicks(context.Background(), srv.URL, 2027)
	if err == nil || !strings.Contains(err.Error(), "500") || !strings.Contains(err.Error(), "ledger tick") {
		t.Fatalf("err = %v, want a 500 ledger tick error", err)
	}
}

// The daily run covers N-1..N+1 (Season 2026 here), and the tick runs once for each season the
// ledger wrote, after it wrote: the tick reads the fresh aid_postings.
func TestAidPostingsSyncTriggersTheLedgerTickForEachSeasonItWrote(t *testing.T) {
	t.Parallel()
	f := newAidFixture(t)
	for _, y := range []int{2025, 2026, 2027} {
		f.household(100+y, y)
		f.txn(9000+y, y, -100, aidCategoryFinancialAssistance, aidTestCampAid, 100+y, 0, 0, false)
	}
	var got []int
	s := f.service()
	s.LedgerTickTrigger = func(_ context.Context, year int) error {
		if len(f.rows(colAidPostings, year)) != 1 {
			t.Errorf("season %d: the tick ran before the ledger wrote", year)
		}
		got = append(got, year)
		return nil
	}
	if err := s.Sync(t.Context()); err != nil {
		t.Fatalf("Sync: %v", err)
	}
	if !slices.Equal(got, []int{2025, 2026, 2027}) {
		t.Errorf("ticked %v, want [2025 2026 2027]", got)
	}
}

func TestAidPostingsSyncDryRunNeverTriggersTheLedgerTick(t *testing.T) {
	t.Parallel()
	f := newAidFixture(t)
	seedAidSiblings(f, 2026)
	f.txn(9001, 2026, -750, aidCategoryFinancialAssistance, aidTestCampAid, 100, 1001, 0, false)
	called := false
	s := f.service()
	s.Year, s.DryRun = 2026, true
	s.LedgerTickTrigger = func(context.Context, int) error { called = true; return nil }
	if err := s.Sync(t.Context()); err != nil {
		t.Fatal(err)
	}
	if called {
		t.Error("a dry run triggered the ledger tick")
	}
}

func TestAidPostingsSyncCountsALedgerTickFailureWithoutFailingTheLedger(t *testing.T) {
	t.Parallel()
	f := newAidFixture(t)
	seedAidSiblings(f, 2026)
	f.txn(9001, 2026, -750, aidCategoryFinancialAssistance, aidTestCampAid, 100, 1001, 0, false)
	// The fixture's own run already raises warnings (no classification file), so measure the delta
	// against the same run with a tick that succeeds.
	ok := f.service()
	ok.Year = 2026
	ok.LedgerTickTrigger = func(context.Context, int) error { return nil }
	if err := ok.Sync(t.Context()); err != nil {
		t.Fatal(err)
	}
	base := ok.GetStats().AidLedgerWarnings
	s := f.service()
	s.Year = 2026
	s.LedgerTickTrigger = func(context.Context, int) error { return errors.New("down") }
	if err := s.Sync(t.Context()); err != nil {
		t.Fatalf("Sync must not fail on the tick: %v", err)
	}
	stats := s.GetStats()
	if stats.AidLedgerWarnings != base+1 || stats.Errors != 0 || len(f.rows(colAidPostings, 2026)) != 1 {
		t.Errorf("warnings = %d (want %d), errors = %d (want 0), postings = %d (want 1)",
			stats.AidLedgerWarnings, base+1, stats.Errors, len(f.rows(colAidPostings, 2026)))
	}
}

// Every production AidPostingsSync ticks the ledger. The test builds it without the trigger, so a
// construction site that forgot it would pass every other test and silently never tick in prod.
func TestEveryProductionAidPostingsSyncTicksTheLedger(t *testing.T) {
	t.Parallel()
	for _, file := range []string{"orchestrator.go", "api.go"} {
		src, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		built := strings.Count(string(src), "NewAidPostingsSync(")
		wired := strings.Count(string(src), ".LedgerTickTrigger = TriggerFinancialAidLedgerTicks")
		if built == 0 || built != wired {
			t.Errorf("%s builds %d AidPostingsSync and wires the ledger tick on %d", file, built, wired)
		}
	}
}
