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

// ledgerTickRun runs one 2026 aid_postings sync over a classified ledger, after `runs` recorded
// financial_transactions' history, and returns the seasons it asked to tick.
func ledgerTickRun(t *testing.T, runs func(f *aidFixture)) (s *AidPostingsSync, ticked []int) {
	t.Helper()
	f := newAidFixture(t)
	seedAidSiblings(f, 2026)
	f.txn(9001, 2026, -750, aidCategoryFinancialAssistance, aidTestCampAid, 100, 1001, 0, false)
	runs(f)
	s = f.service()
	s.Year, s.ConfigPath = 2026, f.writeConfig(aidTestConfig)
	s.LedgerTickTrigger = func(_ context.Context, year int) error {
		ticked = append(ticked, year)
		return nil
	}
	if err := s.Sync(t.Context()); err != nil {
		t.Fatalf("Sync must not fail over stale input: %v", err)
	}
	return s, ticked
}

// nightlyThen records a successful nightly window run for 2026, then another ending `latest`.
func nightlyThen(latest string) func(f *aidFixture) {
	return func(f *aidFixture) {
		f.recordSeasonRun(serviceNameFinancialTransactions, statusSuccess, triggerDaily, 2026,
			"2026-09-25T10:00:00.000Z", "2026-09-25T10:02:00.000Z")
		f.recordSeasonRun(serviceNameFinancialTransactions, latest, triggerDaily, 2026,
			"2026-09-27T10:00:00.000Z", "2026-09-27T10:05:00.000Z")
	}
}

// skipLine is the log's skipped-tick warning, or "" when there is none.
func skipLine(logs *strings.Builder) string {
	for line := range strings.Lines(logs.String()) {
		if strings.Contains(line, "Skipping the campership ledger tick") {
			return line
		}
	}
	return ""
}

// Owner ruling B (2026-09-30): financial_transactions' latest run failed, so aid_postings rebuilt from
// yesterday's rows. Confirmation reads that night as no sync (Decision 12), so the tick is skipped too,
// with a warning naming the skip and the last good transactions sync, and the run is not failed.
func TestAidPostingsSyncSkipsTheLedgerTickOnStaleInput(t *testing.T) {
	logs := captureSweepLogs(t)
	s, ticked := ledgerTickRun(t, nightlyThen(statusFailed))
	if len(ticked) != 0 {
		t.Errorf("stale input ticked %v, want no tick", ticked)
	}
	// One warning for the stale input, one for the skipped tick.
	if got := s.GetStats().AidLedgerWarnings; got != 2 {
		t.Errorf("AidLedgerWarnings = %d, want 2 (stale input + skipped tick)", got)
	}
	skip := skipLine(logs)
	if skip == "" {
		t.Fatalf("log must name the skipped tick, got:\n%s", logs.String())
	}
	if !strings.Contains(skip, "level=WARN") || !strings.Contains(skip, "year=2026") ||
		!strings.Contains(skip, "last_successful_transactions_sync=\"2026-09-25 10:02:00") {
		t.Errorf("the skip must warn and name the season and the last good covering run, got: %s", skip)
	}
}

func TestAidPostingsSyncTicksWhenTheTransactionsRunSucceeded(t *testing.T) {
	t.Parallel()
	s, ticked := ledgerTickRun(t, nightlyThen(statusSuccess))
	if !slices.Equal(ticked, []int{2026}) {
		t.Errorf("ticked %v, want [2026]", ticked)
	}
	if got := s.GetStats().AidLedgerWarnings; got != 0 {
		t.Errorf("AidLedgerWarnings = %d, want 0", got)
	}
}

// Fix round 1: staleness is judged per season with confirmation's coverage rule (ledger_run_covers).
// The nightly run recorded as 2025 covers 2026 (its window is 2024..2026) and failed; the later
// successful manual run covers only 2027, so 2026's newest covering run still failed.
func TestAFailedNightlyThenASuccessfulManualRunForAnotherYearStillSkips2026(t *testing.T) {
	logs := captureSweepLogs(t)
	s, ticked := ledgerTickRun(t, func(f *aidFixture) {
		f.recordSeasonRun(serviceNameFinancialTransactions, statusSuccess, triggerDaily, 2026,
			"2026-09-25T10:00:00.000Z", "2026-09-25T10:02:00.000Z")
		f.recordSeasonRun(serviceNameFinancialTransactions, statusFailed, triggerDaily, 2025,
			"2026-09-27T10:00:00.000Z", "2026-09-27T10:05:00.000Z")
		f.recordSeasonRun(serviceNameFinancialTransactions, statusSuccess, triggerManual, 2027,
			"2026-09-28T10:00:00.000Z", "2026-09-28T10:02:00.000Z")
	})
	if len(ticked) != 0 {
		t.Errorf("ticked %v, want 2026 skipped", ticked)
	}
	// The global stale-input warning keys on the newest run (a success), so only the skip counts.
	if got := s.GetStats().AidLedgerWarnings; got != 1 {
		t.Errorf("AidLedgerWarnings = %d, want 1 (the skipped tick)", got)
	}
	if skip := skipLine(logs); !strings.Contains(skip, "year=2026") ||
		!strings.Contains(skip, "last_successful_transactions_sync=\"2026-09-25 10:02:00") {
		t.Errorf("the skip must name 2026 and its last good covering run, got: %q", skip)
	}
}

// A failed manual run for 2025 covers only 2025, so it does not skip the 2026 tick that the
// successful nightly run covers.
func TestAFailedManualRunForAnotherYearDoesNotSkipACoveredSeason(t *testing.T) {
	logs := captureSweepLogs(t)
	_, ticked := ledgerTickRun(t, func(f *aidFixture) {
		f.recordSeasonRun(serviceNameFinancialTransactions, statusSuccess, triggerDaily, 2026,
			"2026-09-27T10:00:00.000Z", "2026-09-27T10:02:00.000Z")
		f.recordSeasonRun(serviceNameFinancialTransactions, statusFailed, triggerManual, 2025,
			"2026-09-28T10:00:00.000Z", "2026-09-28T10:05:00.000Z")
	})
	if !slices.Equal(ticked, []int{2026}) {
		t.Errorf("ticked %v, want [2026]", ticked)
	}
	if skip := skipLine(logs); skip != "" {
		t.Errorf("no season was stale, but the log skipped one: %s", skip)
	}
}
