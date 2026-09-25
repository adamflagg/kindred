package sync

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	pbtests "github.com/pocketbase/pocketbase/tests"
)

// newTransactionsTestApp builds camp_sessions and a financial_transactions collection
// shaped like production after migration 1500000183, including its (cm_id, amount, year)
// unique index. Dates and relations are text: the sync compares them as strings.
func newTransactionsTestApp(t *testing.T) core.App {
	t.Helper()
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)

	sessions := core.NewBaseCollection("camp_sessions")
	sessions.Fields.Add(&core.NumberField{Name: "cm_id"})
	sessions.Fields.Add(&core.NumberField{Name: "year"})
	if err := app.Save(sessions); err != nil {
		t.Fatalf("save camp_sessions: %v", err)
	}

	col := core.NewBaseCollection("financial_transactions")
	for _, name := range []string{
		"cm_id", "transaction_number", "year", "quantity", "unit_amount", "amount", "program_id",
		"person_cm_id", "household_cm_id", "session_cm_id", "financial_category_cm_id",
	} {
		col.Fields.Add(&core.NumberField{Name: name})
	}
	for _, name := range []string{
		"post_date", "effective_date", "service_start_date", "service_end_date", "reversal_date",
		"description", "transaction_note", "gl_account_note", "recognition_gl_account_id",
		"deferral_gl_account_id", "financial_category", "payment_method", "session",
		"session_group", "division", "person", "household",
	} {
		col.Fields.Add(&core.TextField{Name: name})
	}
	col.Fields.Add(&core.BoolField{Name: "is_reversed"})
	col.Indexes = []string{"CREATE UNIQUE INDEX `idx_financial_transactions_cm_id_amount_year` " +
		"ON `financial_transactions` (`cm_id`, `amount`, `year`)"}
	if err := app.Save(col); err != nil {
		t.Fatalf("save financial_transactions: %v", err)
	}
	return app
}

func txnRow(id, season int, amount float64, extra map[string]any) map[string]any {
	row := map[string]any{
		"transactionId": float64(id), "season": float64(season), "amount": amount,
		"postDate": "2026-01-15T12:00:00Z", "isReversed": false,
	}
	for k, v := range extra {
		row[k] = v
	}
	return row
}

func fetchFrom(rows map[int][]map[string]any) func(int) ([]map[string]any, error) {
	return func(season int) ([]map[string]any, error) { return rows[season], nil }
}

func newTestTransactionsSync(app core.App, rows map[int][]map[string]any) *FinancialTransactionsSync {
	s := NewFinancialTransactionsSync(app, nil)
	s.fetchSeason = fetchFrom(rows)
	return s
}

func countTransactions(t *testing.T, app core.App, year int) int {
	t.Helper()
	recs, err := app.FindRecordsByFilter("financial_transactions", fmt.Sprintf("year = %d", year), "", 0, 0)
	if err != nil {
		t.Fatalf("query financial_transactions: %v", err)
	}
	return len(recs)
}

func TestFinancialTransactionsSync_StoresSeasonRawIDsAndUTC(t *testing.T) {
	t.Parallel()
	app := newTransactionsTestApp(t)
	s := newTestTransactionsSync(app, map[int][]map[string]any{2026: {
		txnRow(5001, 2026, 250, map[string]any{
			"personId": float64(9100001), "householdId": float64(9110001),
			"sessionId": float64(9120001), "financialCategoryId": float64(22650),
		}),
	}})
	if err := s.SyncForYear(context.Background(), 2026); err != nil {
		t.Fatalf("SyncForYear: %v", err)
	}
	rec, err := app.FindFirstRecordByFilter("financial_transactions", "cm_id = 5001")
	if err != nil {
		t.Fatalf("find row: %v", err)
	}
	if rec.GetInt("year") != 2026 || rec.GetInt("person_cm_id") != 9100001 ||
		rec.GetInt("household_cm_id") != 9110001 || rec.GetInt("session_cm_id") != 9120001 ||
		rec.GetInt("financial_category_cm_id") != 22650 {
		t.Errorf("stored year/raw ids wrong: %v", rec.FieldsData())
	}
	if got := rec.GetString("post_date"); got != "2026-01-15 19:00:00Z" {
		t.Errorf("post_date = %q, want the Mountain wall clock converted to UTC", got)
	}
}

// The (cm_id, amount, year) key: one transaction id may appear under two seasons.
func TestFinancialTransactionsSync_SameTransactionIDInTwoSeasons(t *testing.T) {
	t.Parallel()
	app := newTransactionsTestApp(t)
	s := newTestTransactionsSync(app, map[int][]map[string]any{
		2025: {txnRow(5001, 2025, 100, nil)},
		2026: {txnRow(5001, 2026, 100, nil)},
	})
	for _, season := range []int{2025, 2026} {
		if err := s.SyncForYear(context.Background(), season); err != nil {
			t.Fatalf("SyncForYear(%d): %v", season, err)
		}
	}
	if countTransactions(t, app, 2025) != 1 || countTransactions(t, app, 2026) != 1 {
		t.Error("want one row per season for the same (cm_id, amount)")
	}
}

// Review Focus 1: an empty response against a stored season must delete nothing.
func TestFinancialTransactionsSync_RefusesToSweepAnEmptySeason(t *testing.T) {
	t.Parallel()
	app := newTransactionsTestApp(t)
	rows := map[int][]map[string]any{2027: {
		txnRow(5001, 2027, 100, nil), txnRow(5002, 2027, 200, nil), txnRow(5003, 2027, 300, nil),
	}}
	s := newTestTransactionsSync(app, rows)
	if err := s.SyncForYear(context.Background(), 2027); err != nil {
		t.Fatalf("first SyncForYear: %v", err)
	}

	rows[2027] = nil
	err := s.SyncForYear(context.Background(), 2027)
	if err == nil || !strings.Contains(err.Error(), "refus") {
		t.Errorf("SyncForYear on an empty season = %v, want a refused-sweep error", err)
	}
	if got := countTransactions(t, app, 2027); got != 3 {
		t.Errorf("rows after an empty response = %d, want 3 (nothing deleted)", got)
	}
}

// Positive control for the guard: a genuinely vanished row is still swept.
func TestFinancialTransactionsSync_SweepsARowCampMinderNoLongerReturns(t *testing.T) {
	t.Parallel()
	app := newTransactionsTestApp(t)
	rows := map[int][]map[string]any{2026: {
		txnRow(5001, 2026, 100, nil), txnRow(5002, 2026, 200, nil), txnRow(5003, 2026, 300, nil),
	}}
	s := newTestTransactionsSync(app, rows)
	if err := s.SyncForYear(context.Background(), 2026); err != nil {
		t.Fatalf("first SyncForYear: %v", err)
	}
	rows[2026] = rows[2026][:2]
	if err := s.SyncForYear(context.Background(), 2026); err != nil {
		t.Fatalf("second SyncForYear: %v", err)
	}
	if got := countTransactions(t, app, 2026); got != 2 {
		t.Errorf("rows = %d, want 2", got)
	}
}

func TestFinancialTransactionsSync_LeavesAnotherSeasonsRowForItsOwnRun(t *testing.T) {
	t.Parallel()
	app := newTransactionsTestApp(t)
	s := newTestTransactionsSync(app, map[int][]map[string]any{2026: {
		txnRow(5001, 2026, 100, nil),
		txnRow(5002, 2025, 100, nil), // a 2025 row in a 2026 response
	}})
	if err := s.SyncForYear(context.Background(), 2026); err != nil {
		t.Fatalf("SyncForYear: %v", err)
	}
	if countTransactions(t, app, 2026) != 1 || countTransactions(t, app, 2025) != 0 {
		t.Error("a row whose season differs from the fetched season must not be written")
	}
	if s.Stats.Skipped < 1 {
		t.Errorf("Stats.Skipped = %d, want the mismatched row counted", s.Stats.Skipped)
	}
}

// Cross-season: session 9120001 exists only under 2025; a 2026 posting against it is
// flagged and kept under 2026 (not re-keyed). 9120002 exists in both seasons: not flagged.
func TestFinancialTransactionsSync_FlagsCrossSeasonSessionWithoutRekeying(t *testing.T) {
	t.Parallel()
	app := newTransactionsTestApp(t)
	saveRecord(t, app, "camp_sessions", map[string]any{"cm_id": 9120001, "year": 2025})
	saveRecord(t, app, "camp_sessions", map[string]any{"cm_id": 9120002, "year": 2025})
	saveRecord(t, app, "camp_sessions", map[string]any{"cm_id": 9120002, "year": 2026})
	s := newTestTransactionsSync(app, map[int][]map[string]any{2026: {
		txnRow(5001, 2026, 100, map[string]any{"sessionId": float64(9120001)}),
		txnRow(5002, 2026, 100, map[string]any{"sessionId": float64(9120002)}),
	}})
	if err := s.SyncForYear(context.Background(), 2026); err != nil {
		t.Fatalf("SyncForYear: %v", err)
	}
	if !slices.Equal(s.crossSeason, []int{5001}) {
		t.Errorf("crossSeason = %v, want [5001]", s.crossSeason)
	}
	rec, err := app.FindFirstRecordByFilter("financial_transactions", "cm_id = 5001")
	if err != nil {
		t.Fatalf("find: %v", err)
	}
	if rec.GetInt("year") != 2026 || rec.GetInt("session_cm_id") != 9120001 {
		t.Errorf("flagged row re-keyed: year %d session_cm_id %d", rec.GetInt("year"), rec.GetInt("session_cm_id"))
	}
}

func TestFinancialTransactionsSync_BackfillsRawIDsOntoAnExistingRow(t *testing.T) {
	t.Parallel()
	app := newTransactionsTestApp(t)
	saveRecord(t, app, "financial_transactions", map[string]any{
		"cm_id": 5001, "amount": 100.0, "year": 2026, "post_date": "2026-01-15 19:00:00Z",
	})
	s := newTestTransactionsSync(app, map[int][]map[string]any{2026: {
		txnRow(5001, 2026, 100, map[string]any{"personId": float64(9100001)}),
	}})
	if err := s.SyncForYear(context.Background(), 2026); err != nil {
		t.Fatalf("SyncForYear: %v", err)
	}
	rec, err := app.FindFirstRecordByFilter("financial_transactions", "cm_id = 5001")
	if err != nil {
		t.Fatalf("find: %v", err)
	}
	if rec.GetInt("person_cm_id") != 9100001 {
		t.Errorf("person_cm_id = %d, want 9100001 written onto the existing row", rec.GetInt("person_cm_id"))
	}
}

func TestFinancialTransactionsSync_SecondIdenticalRunUpdatesNothing(t *testing.T) {
	t.Parallel()
	app := newTransactionsTestApp(t)
	s := newTestTransactionsSync(app, map[int][]map[string]any{2026: {
		txnRow(5001, 2026, 100, map[string]any{"personId": float64(9100001), "reversalDate": "2026-02-01T09:00:00Z"}),
	}})
	for run := 1; run <= 2; run++ {
		if err := s.SyncForYear(context.Background(), 2026); err != nil {
			t.Fatalf("run %d: %v", run, err)
		}
	}
	if s.Stats.Updated != 0 || s.Stats.Created != 0 {
		t.Errorf("second run stats = %+v, want 0 created and 0 updated", s.Stats)
	}
}

// A failed fetch never sweeps (SyncSuccessful stays false) and surfaces the error.
func TestFinancialTransactionsSync_FailedFetchDeletesNothing(t *testing.T) {
	t.Parallel()
	app := newTransactionsTestApp(t)
	saveRecord(t, app, "financial_transactions", map[string]any{"cm_id": 5001, "amount": 100.0, "year": 2026})
	s := NewFinancialTransactionsSync(app, nil)
	s.fetchSeason = func(int) ([]map[string]any, error) { return nil, errors.New("upstream timeout") }
	if err := s.SyncForYear(context.Background(), 2026); err == nil {
		t.Fatal("SyncForYear returned nil on a failed fetch")
	}
	if countTransactions(t, app, 2026) != 1 {
		t.Error("a failed fetch deleted rows")
	}
}

// crossSeasonSession: flag only a session the requested season does not hold while
// another season does, and only once that season's camp_sessions have been synced.
func TestCrossSeasonSession(t *testing.T) {
	t.Parallel()
	seasons := map[int]map[int]bool{
		9120001: {2025: true},
		9120002: {2025: true, 2026: true},
	}
	synced2026 := map[int]string{9120002: "sess2026"}
	cases := []struct {
		name     string
		session  int
		sessions map[int]string // the requested season's synced camp_sessions
		want     bool
	}{
		{"no session on the row", 0, synced2026, false},
		{"session held by the requested season", 9120002, synced2026, false},
		{"session held only by another season", 9120001, synced2026, true},
		{"session unknown in every season", 9129999, synced2026, false},
		// Ruling P6: an N+1 or backfill season with no camp_sessions synced yet. CampMinder
		// reuses session ids across seasons, so flagging here would fire on nearly every row.
		{"requested season has no synced sessions", 9120001, map[int]string{}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			lookups := TransactionLookupMaps{Sessions: tc.sessions, SessionSeasons: seasons}
			pbData := map[string]any{"session_cm_id": tc.session}
			if got := crossSeasonSession(pbData, lookups, 2026); got != tc.want {
				t.Errorf("crossSeasonSession = %v, want %v", got, tc.want)
			}
		})
	}
}

// A season-N request answered with season N-1 rows must not wipe season N. The mismatch
// skip runs before TrackProcessedKey, so the computed set stays empty and the guard refuses.
// Swapped, the foreign rows would count as processed season-N keys, the guard would pass,
// and the sweep would delete every stored season-N row.
func TestFinancialTransactionsSync_MisScopedResponseCannotWipeTheStoredSeason(t *testing.T) {
	t.Parallel()
	app := newTransactionsTestApp(t)
	for _, id := range []int{5001, 5002, 5003} {
		saveRecord(t, app, "financial_transactions", map[string]any{"cm_id": id, "amount": 100.0, "year": 2026})
	}
	s := newTestTransactionsSync(app, map[int][]map[string]any{2026: {
		txnRow(6001, 2025, 100, nil), txnRow(6002, 2025, 100, nil), txnRow(6003, 2025, 100, nil),
	}})
	err := s.SyncForYear(context.Background(), 2026)
	if err == nil || !strings.Contains(err.Error(), "refus") {
		t.Errorf("SyncForYear on a mis-scoped response = %v, want a refused-sweep error", err)
	}
	if got := countTransactions(t, app, 2026); got != 3 {
		t.Errorf("stored 2026 rows after a 2025-only response = %d, want 3 (nothing deleted)", got)
	}
}

// Dedup must key on the season too: a 2025 row listed first must not shadow the 2026 row
// with the same (cm_id, amount), or the stored 2026 row reads as an orphan.
func TestFinancialTransactionsSync_DedupDoesNotShadowAcrossSeasons(t *testing.T) {
	t.Parallel()
	app := newTransactionsTestApp(t)
	s := newTestTransactionsSync(app, map[int][]map[string]any{2026: {
		txnRow(5001, 2025, 100, nil),
		txnRow(5001, 2026, 100, nil),
	}})
	if err := s.SyncForYear(context.Background(), 2026); err != nil {
		t.Fatalf("SyncForYear: %v", err)
	}
	if got := countTransactions(t, app, 2026); got != 1 {
		t.Errorf("2026 rows = %d, want the 2026 row written despite the 2025 twin listed first", got)
	}
}

func TestFinancialTransactionsSync_SeasonsToSync(t *testing.T) {
	t.Parallel()
	rolling := NewRollingFinancialTransactionsSync(nil, nil)
	if got := rolling.seasonsToSync(2026); !slices.Equal(got, []int{2025, 2026, 2027}) {
		t.Errorf("rolling seasonsToSync(2026) = %v, want [2025 2026 2027]", got)
	}
	single := NewFinancialTransactionsSync(nil, nil)
	if got := single.seasonsToSync(2026); !slices.Equal(got, []int{2026}) {
		t.Errorf("single seasonsToSync(2026) = %v, want [2026]", got)
	}
}

// One season failing must not stop the others, and the run's stats are the sum.
func TestFinancialTransactionsSync_RollingRunContinuesPastAFailedSeason(t *testing.T) {
	t.Parallel()
	app := newTransactionsTestApp(t)
	s := NewRollingFinancialTransactionsSync(app, nil)
	s.fetchSeason = func(season int) ([]map[string]any, error) {
		if season == 2025 {
			return nil, errors.New("upstream timeout")
		}
		return []map[string]any{txnRow(5000+season, season, 100, nil)}, nil
	}
	err := s.syncSeasons(context.Background(), []int{2025, 2026, 2027})
	if err == nil || !strings.Contains(err.Error(), "season 2025") {
		t.Errorf("syncSeasons error = %v, want one naming season 2025", err)
	}
	if countTransactions(t, app, 2026) != 1 || countTransactions(t, app, 2027) != 1 {
		t.Error("seasons after the failed one were not synced")
	}
	if s.Stats.Created != 2 {
		t.Errorf("Stats.Created = %d, want 2 summed across seasons", s.Stats.Created)
	}
	if s.SyncSuccessful {
		t.Error("SyncSuccessful must be false when any season failed")
	}
}

func TestTransactionBackfillYear(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 9, 25, 12, 0, 0, 0, time.UTC)
	for _, tt := range []struct {
		param   string
		want    int
		wantErr bool
	}{
		{"", 0, false},
		{"2017", 2017, false},
		{"2026", 2026, false},
		{"2027", 2027, false}, // N+1 is live in CampMinder and in the daily run
		{"2028", 0, true},
		{"2016", 0, true},
		{"abc", 0, true},
	} {
		got, err := transactionBackfillYear(tt.param, now)
		if (err != nil) != tt.wantErr || got != tt.want {
			t.Errorf("transactionBackfillYear(%q) = %d, %v; want %d, err=%v", tt.param, got, err, tt.want, tt.wantErr)
		}
	}
}
