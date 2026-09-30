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
	"unicode/utf8"
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

// seasonErrFrom answers the ledger tick with one status and body and returns the error it gives.
func seasonErrFrom(t *testing.T, status int, body string) error {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return postFinancialAidLedgerTicks(context.Background(), srv.URL, 2027)
}

// A service refusal (422) carries a string detail, and the error quotes it.
func TestPostFinancialAidSeasonQuotesAStringDetail(t *testing.T) {
	t.Parallel()
	err := seasonErrFrom(t, http.StatusUnprocessableEntity,
		`{"detail":"the ledger tick for 2027 may not have been written"}`)
	want := "financial-aid ledger tick returned 422: the ledger tick for 2027 may not have been written"
	if err == nil || err.Error() != want {
		t.Fatalf("err = %v, want %q", err, want)
	}
}

// FastAPI's own validation 422 carries a list detail, which can echo the request: it is dropped.
func TestPostFinancialAidSeasonDropsAListDetail(t *testing.T) {
	t.Parallel()
	err := seasonErrFrom(t, http.StatusUnprocessableEntity,
		`{"detail":[{"loc":["body","year"],"msg":"field required","input":{"name":"Emma Johnson"}}]}`)
	if err == nil || err.Error() != "financial-aid ledger tick returned 422" {
		t.Fatalf("err = %v, want the bare status", err)
	}
}

// The quoted detail is capped at 200 runes, cut on a rune boundary, however long the refusal.
func TestPostFinancialAidSeasonCapsTheDetailAt200Runes(t *testing.T) {
	t.Parallel()
	long := "a" + strings.Repeat("é", 300) // odd, so a byte-wise cut lands inside a character
	err := seasonErrFrom(t, http.StatusUnprocessableEntity, `{"detail":"`+long+`"}`)
	if err == nil {
		t.Fatal("want an error")
	}
	quoted := strings.TrimPrefix(err.Error(), "financial-aid ledger tick returned 422: ")
	if want := "a" + strings.Repeat("é", 199) + "..."; quoted != want {
		t.Errorf("detail = %d runes (%q...), want 200 runes and an ellipsis", utf8.RuneCountInString(quoted), quoted[:8])
	}
	if !utf8.ValidString(err.Error()) {
		t.Error("the detail was cut inside a character")
	}
}

// A cancelled run asks for no tick: the next night's run re-derives every tick anyway.
func TestRunLedgerTickTriggerSkipsACancelledRun(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	called := false
	s := &AidPostingsSync{}
	s.LedgerTickTrigger = func(context.Context, int) error { called = true; return nil }
	s.runLedgerTickTrigger(ctx, []int{2027})
	if called || s.Stats.AidLedgerWarnings != 0 {
		t.Errorf("called = %v, warnings = %d; want no tick and no warning", called, s.Stats.AidLedgerWarnings)
	}
}

// A run cancelled (or out of time) partway through asks for no further season: each would fail on
// the dead context and count a warning of its own.
func TestRunLedgerTickTriggerStopsWhenTheRunIsCancelledMidway(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var asked []int
	s := &AidPostingsSync{}
	s.LedgerTickTrigger = func(ctx context.Context, year int) error {
		asked = append(asked, year)
		cancel()
		return ctx.Err()
	}
	s.runLedgerTickTrigger(ctx, []int{2026, 2027, 2028})
	if !slices.Equal(asked, []int{2026}) || s.Stats.AidLedgerWarnings != 1 {
		t.Errorf("asked = %v, warnings = %d; want [2026] and 1 warning", asked, s.Stats.AidLedgerWarnings)
	}
}
