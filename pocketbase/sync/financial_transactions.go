package sync

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/pocketbase/pocketbase/core"

	"github.com/camp/kindred/pocketbase/campminder"
)

// Service name constant
const serviceNameFinancialTransactions = "financial_transactions"

// FinancialTransactionsSync handles syncing financial transactions from CampMinder
// This is a year-scoped table that runs in the daily sync
type FinancialTransactionsSync struct {
	BaseSyncService

	// fetchSeason fetches one season's rows, reversals included. nil means the CampMinder
	// client; tests replace it.
	fetchSeason func(season int) ([]map[string]any, error)

	// crossSeason holds the transaction cm_ids the last SyncForYear flagged as posted
	// against another season's session. Logged, never re-keyed (design §6.1).
	crossSeason []int

	// RollingSeasons makes Sync cover seasons N-1, N and N+1 around the configured season
	// (design §6.1): N-1 still collects late postings and reversals, and N+1 already takes
	// deposits and early awards. Set only on the instance InitializeSyncServices registers.
	// A historical replay and the ?year= route construct a single-season instance.
	RollingSeasons bool
}

// TransactionLookupMaps holds all the lookup maps needed for relation resolution
type TransactionLookupMaps struct {
	FinancialCategories map[int]string       // cm_id -> PB ID
	PaymentMethods      map[int]string       // cm_id -> PB ID
	Sessions            map[int]string       // cm_id -> PB ID
	SessionGroups       map[int]string       // cm_id -> PB ID
	Divisions           map[int]string       // cm_id -> PB ID
	Persons             map[int]string       // cm_id -> PB ID
	Households          map[int]string       // cm_id -> PB ID
	SessionSeasons      map[int]map[int]bool // session cm_id -> every season it appears in
}

// NewFinancialTransactionsSync creates a new financial transactions sync service
func NewFinancialTransactionsSync(app core.App, client *campminder.Client) *FinancialTransactionsSync {
	return &FinancialTransactionsSync{
		BaseSyncService: NewBaseSyncService(app, client),
	}
}

// SetDryRun implements the orchestrator's DryRunnable interface (kindred#2351). Declared
// explicitly rather than inherited by embedding BaseSyncService -- see that field's doc
// comment for why a promoted setter is not safe here.
func (s *FinancialTransactionsSync) SetDryRun(dryRun bool) {
	s.DryRun = dryRun
}

// fetch returns one season's rows from the test hook, or from CampMinder when none is set.
func (s *FinancialTransactionsSync) fetch(season int) ([]map[string]any, error) {
	if s.fetchSeason != nil {
		return s.fetchSeason(season)
	}
	return s.Client.GetTransactionDetails(season, true)
}

// NewRollingFinancialTransactionsSync is the instance the daily cron runs: NewFinancialTransactionsSync
// with RollingSeasons set.
func NewRollingFinancialTransactionsSync(app core.App, client *campminder.Client) *FinancialTransactionsSync {
	s := NewFinancialTransactionsSync(app, client)
	s.RollingSeasons = true
	return s
}

// Sync syncs the configured season, or N-1..N+1 around it when RollingSeasons is set.
func (s *FinancialTransactionsSync) Sync(ctx context.Context) error {
	return s.syncSeasons(ctx, s.seasonsToSync(s.Client.GetSeasonID()))
}

func (s *FinancialTransactionsSync) seasonsToSync(configured int) []int {
	if s.RollingSeasons {
		return []int{configured - 1, configured, configured + 1}
	}
	return []int{configured}
}

// syncSeasons runs SyncForYear for each season in turn. A failed season is logged and the
// next one still runs; the returned error joins every failure. Stats hold the sum across
// seasons. They are deliberately not SubStats, which the admin toast would render as a new
// breakdown.
func (s *FinancialTransactionsSync) syncSeasons(ctx context.Context, seasons []int) error {
	var total Stats
	var errs []error
	for _, season := range seasons {
		if err := ctx.Err(); err != nil {
			errs = append(errs, err)
			break
		}
		err := s.SyncForYear(ctx, season)
		addTransactionStats(&total, &s.Stats)
		if err != nil {
			slog.Error("Financial transactions season failed; continuing with the next",
				"season", season, "error", err)
			errs = append(errs, fmt.Errorf("season %d: %w", season, err))
		}
	}
	s.Stats = total
	s.SyncSuccessful = len(errs) == 0
	return errors.Join(errs...)
}

// addTransactionStats folds one season's counters into the run's total. Only the counters
// SyncForYear touches are summed. Takes pointers to avoid golangci's hugeParam on Stats.
func addTransactionStats(total, season *Stats) {
	total.Created += season.Created
	total.Updated += season.Updated
	total.Deleted += season.Deleted
	total.Skipped += season.Skipped
	total.Errors += season.Errors
	total.Rejected += season.Rejected
}

// SyncForYear syncs financial transactions for a specific year
// This is exposed for historical data syncing
func (s *FinancialTransactionsSync) SyncForYear(ctx context.Context, year int) error {
	// Logged from the requested year, not the client's season: a rolling run syncs several
	// seasons through one client, and DB-backed tests have no client at all.
	slog.Info("Starting sync", "service", serviceNameFinancialTransactions, "season", year)
	s.Stats = Stats{}
	s.SyncSuccessful = false
	s.crossSeason = nil

	slog.Info("Syncing financial transactions", "year", year)

	// Pre-load existing records for this year
	// Key by cm_id + amount since CampMinder returns original+reversal with same transactionId
	filter := fmt.Sprintf("year = %d", year)
	preloadFn := func(record *core.Record) (any, bool) {
		cmID, ok1 := record.Get("cm_id").(float64)
		amount, ok2 := record.Get("amount").(float64)
		if ok1 && cmID > 0 && ok2 {
			return s.transactionKey(int(cmID), amount), true
		}
		return nil, false
	}
	existingRecords, err := s.PreloadRecords("financial_transactions", filter, preloadFn)
	if err != nil {
		return err
	}

	s.ClearProcessedKeys()

	// Build lookup maps for relation resolution
	lookupMaps, err := s.buildLookupMaps(year)
	if err != nil {
		return fmt.Errorf("building lookup maps: %w", err)
	}

	// Fetch transactions from CampMinder (include reversals for complete audit trail)
	transactions, err := s.fetch(year)
	if err != nil {
		return fmt.Errorf("fetching transactions: %w", err)
	}

	// Deduplicate by cm_id + amount + season (CampMinder bug returns some $0 transactions twice)
	transactions = s.deduplicateTransactions(transactions, year)

	slog.Info("Fetched financial transactions", "season", year, "count", len(transactions))
	s.SyncSuccessful = true // Fetch succeeded: the sweep may run (behind its guard)

	unresolved := unresolvedTransactionIDs{}
	for i, data := range transactions {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		// Log progress every 2000 records
		if i > 0 && i%2000 == 0 {
			slog.Info("Processing transactions", "current", i, "total", len(transactions),
				"created", s.Stats.Created, "updated", s.Stats.Updated, "skipped", s.Stats.Skipped)
		}

		s.syncTransaction(data, year, lookupMaps, existingRecords, unresolved)
	}

	sweepErr := s.sweepOrphanTransactions(existingRecords, year)

	// Checkpoint before any error return: the loop above has already written.
	if err := s.ForceWALCheckpoint(); err != nil {
		slog.Warn("WAL checkpoint failed", "error", err)
	}

	// Log summary of which fields caused updates (for idempotency debugging)
	s.LogFieldDiffSummary()
	unresolved.log(year)
	s.logCrossSeason(year)

	s.LogSyncComplete("Financial Transactions")
	return wrapOrphanSweepError(sweepErr)
}

// syncTransaction transforms and upserts one CampMinder row for season `year`.
func (s *FinancialTransactionsSync) syncTransaction(
	data map[string]any, year int, lookups TransactionLookupMaps,
	existing map[any]*core.Record, unresolved unresolvedTransactionIDs,
) {
	pbData, err := s.transformTransactionToPB(data, year, lookups)
	if err != nil {
		slog.Error("Error transforming transaction", "error", err)
		s.Stats.Rejected++
		return
	}

	cmID, ok := pbData["cm_id"].(int)
	if !ok || cmID == 0 {
		slog.Error("Invalid transaction cm_id")
		s.Stats.Rejected++
		return
	}

	// A season-scoped fetch should never return another season's row. If it does, leave it
	// for that season's own run instead of writing it under a preload and a sweep that are
	// both keyed to this one. Skipped before TrackProcessedKey, so the sweep cannot read it
	// as a processed row of this season.
	if rowYear, _ := pbData["year"].(int); rowYear != year {
		slog.Warn("Transaction filed under another season; skipped in this season's run",
			"cm_id", cmID, "row_season", rowYear, "requested_season", year)
		s.Stats.Skipped++
		return
	}

	unresolved.tally(pbData)
	if crossSeasonSession(pbData, lookups, year) {
		s.crossSeason = append(s.crossSeason, cmID)
	}

	amount, _ := pbData["amount"].(float64)
	txnKey := s.transactionKey(cmID, amount)
	s.TrackProcessedKey(txnKey, year)

	err = s.ProcessSimpleRecord("financial_transactions", txnKey, pbData, existing, transactionCompareFields)
	if err != nil {
		if errors.Is(err, errRejectedRecord) {
			slog.Warn("Rejected transaction", "cm_id", cmID, "amount", amount, "error", err)
			s.Stats.Rejected++
		} else {
			slog.Error("Error processing transaction", "cm_id", cmID, "amount", amount, "error", err)
			s.Stats.Errors++
		}
	}
}

// crossSeasonSession reports a row filed under season `year` whose session CampMinder
// holds only under other seasons (design §6.1). The row is flagged, never re-keyed.
//
// No flag at all while `year` has no camp_sessions synced (an N+1 season, a backfill
// year): CampMinder reuses session ids across seasons, so every session-bearing row would
// otherwise read as cross-season.
func crossSeasonSession(pbData map[string]any, lookups TransactionLookupMaps, year int) bool {
	sessionCMID, _ := pbData["session_cm_id"].(int)
	if sessionCMID == 0 || len(lookups.Sessions) == 0 {
		return false
	}
	seasons := lookups.SessionSeasons[sessionCMID]
	return len(seasons) > 0 && !seasons[year]
}

// sweepOrphanTransactions deletes this season's stored rows the fetch no longer returned,
// behind the collapse guard. DeleteOrphansFromPreloaded alone would read an empty or short
// response (a season CampMinder has no rows for yet, a truncated body) as "everything was
// deleted upstream". Transactions only accumulate upstream, so a large shortfall is never
// real.
func (s *FinancialTransactionsSync) sweepOrphanTransactions(existing map[any]*core.Record, year int) error {
	if !s.SyncSuccessful {
		return nil
	}
	guard := OrphanSweepGuard{
		Entity:   serviceNameFinancialTransactions,
		Year:     year,
		Computed: len(s.ProcessedKeys),
		Rejected: s.Stats.Rejected,
		Hint:     "check CampMinder's transactiondetails response for this season before re-running",
	}
	if err := guard.Check(len(existing)); err != nil && !guard.RejectionsExplainShortfall(len(existing)) {
		return err
	}
	return s.DeleteOrphansFromPreloaded(existing, "financial transaction")
}

// logCrossSeason reports the rows crossSeasonSession flagged this run, with a short sample.
func (s *FinancialTransactionsSync) logCrossSeason(year int) {
	if len(s.crossSeason) == 0 {
		return
	}
	sample := s.crossSeason[:min(len(s.crossSeason), 10)]
	slog.Warn("Transactions filed against a session CampMinder holds only under another season: flagged, not re-keyed",
		"year", year, "count", len(s.crossSeason), "sample_transaction_cm_ids", sample)
}

// buildLookupMaps builds all the lookup maps needed for relation resolution
func (s *FinancialTransactionsSync) buildLookupMaps(year int) (TransactionLookupMaps, error) {
	maps := TransactionLookupMaps{
		FinancialCategories: make(map[int]string),
		PaymentMethods:      make(map[int]string),
		Sessions:            make(map[int]string),
		SessionGroups:       make(map[int]string),
		Divisions:           make(map[int]string),
		Persons:             make(map[int]string),
		Households:          make(map[int]string),
		SessionSeasons:      make(map[int]map[int]bool),
	}

	// Financial categories (global table)
	categories, err := s.App.FindRecordsByFilter("financial_categories", "", "", 0, 0)
	if err != nil {
		slog.Warn("Error loading financial categories", "error", err)
	} else {
		for _, record := range categories {
			if cmID, ok := record.Get("cm_id").(float64); ok && cmID > 0 {
				maps.FinancialCategories[int(cmID)] = record.Id
			}
		}
	}

	// Payment methods (global table)
	methods, err := s.App.FindRecordsByFilter("payment_methods", "", "", 0, 0)
	if err != nil {
		slog.Warn("Error loading payment methods", "error", err)
	} else {
		for _, record := range methods {
			if cmID, ok := record.Get("cm_id").(float64); ok && cmID > 0 {
				maps.PaymentMethods[int(cmID)] = record.Id
			}
		}
	}

	// Sessions (year-scoped)
	yearFilter := fmt.Sprintf("year = %d", year)
	sessions, err := s.App.FindRecordsByFilter("camp_sessions", yearFilter, "", 0, 0)
	if err != nil {
		slog.Warn("Error loading sessions", "error", err)
	} else {
		for _, record := range sessions {
			if cmID, ok := record.Get("cm_id").(float64); ok && cmID > 0 {
				maps.Sessions[int(cmID)] = record.Id
			}
		}
	}

	// Every season each session id appears in, for the cross-season flag. CampMinder
	// reuses session ids across seasons, so this is a set per id.
	allSessions, err := s.App.FindRecordsByFilter("camp_sessions", "", "", 0, 0)
	if err != nil {
		slog.Warn("Error loading sessions across seasons", "error", err)
	} else {
		for _, record := range allSessions {
			cmID, season := record.GetInt("cm_id"), record.GetInt("year")
			if cmID <= 0 || season <= 0 {
				continue
			}
			if maps.SessionSeasons[cmID] == nil {
				maps.SessionSeasons[cmID] = map[int]bool{}
			}
			maps.SessionSeasons[cmID][season] = true
		}
	}

	// Session groups (global table)
	groups, err := s.App.FindRecordsByFilter("session_groups", "", "", 0, 0)
	if err != nil {
		slog.Warn("Error loading session groups", "error", err)
	} else {
		for _, record := range groups {
			if cmID, ok := record.Get("cm_id").(float64); ok && cmID > 0 {
				maps.SessionGroups[int(cmID)] = record.Id
			}
		}
	}

	// Divisions (global table)
	divisions, err := s.App.FindRecordsByFilter("divisions", "", "", 0, 0)
	if err != nil {
		slog.Warn("Error loading divisions", "error", err)
	} else {
		for _, record := range divisions {
			if cmID, ok := record.Get("cm_id").(float64); ok && cmID > 0 {
				maps.Divisions[int(cmID)] = record.Id
			}
		}
	}

	// Persons (year-scoped)
	persons, err := s.App.FindRecordsByFilter("persons", yearFilter, "", 0, 0)
	if err != nil {
		slog.Warn("Error loading persons", "error", err)
	} else {
		for _, record := range persons {
			if cmID, ok := record.Get("cm_id").(float64); ok && cmID > 0 {
				maps.Persons[int(cmID)] = record.Id
			}
		}
	}

	// Households (year-scoped)
	households, err := s.App.FindRecordsByFilter("households", yearFilter, "", 0, 0)
	if err != nil {
		slog.Warn("Error loading households", "error", err)
	} else {
		for _, record := range households {
			if cmID, ok := record.Get("cm_id").(float64); ok && cmID > 0 {
				maps.Households[int(cmID)] = record.Id
			}
		}
	}

	slog.Debug("Built lookup maps",
		"categories", len(maps.FinancialCategories),
		"payment_methods", len(maps.PaymentMethods),
		"sessions", len(maps.Sessions),
		"session_groups", len(maps.SessionGroups),
		"divisions", len(maps.Divisions),
		"persons", len(maps.Persons),
		"households", len(maps.Households),
	)

	return maps, nil
}

// transformTransactionToPB transforms CampMinder API data to PocketBase format
func (s *FinancialTransactionsSync) transformTransactionToPB(
	data map[string]any,
	year int,
	maps TransactionLookupMaps,
) (map[string]any, error) {
	pbData := make(map[string]any)

	// transactionId (required)
	txnID, ok := data["transactionId"].(float64)
	if !ok || txnID == 0 {
		return nil, fmt.Errorf("invalid or missing transactionId")
	}
	pbData["cm_id"] = int(txnID)

	// year is CampMinder's own per-row season (campership design §6.1); the requested
	// season is a fallback for a row that omits it. SyncForYear refuses a row whose season
	// disagrees with the one it asked for.
	pbData["year"] = year
	if season, ok := data["season"].(float64); ok && season > 0 {
		pbData["year"] = int(season)
	}

	// Optional int/float fields
	setIntFromFloat(pbData, data, "transactionNumber", "transaction_number")
	setIntFromFloat(pbData, data, "quantity", "quantity")
	setFloatFromFloat(pbData, data, "unitAmount", "unit_amount")
	setFloatFromFloat(pbData, data, "amount", "amount")

	// post_date and reversal_date are instants on a Mountain wall clock under a "Z" suffix
	// (design §6.2). The other three are calendar dates and must stay dates.
	pbData["post_date"] = ParseCampMinderInstant(data["postDate"])
	pbData["effective_date"] = ParseDateValue(data["effectiveDate"])
	pbData["service_start_date"] = ParseDateValue(data["serviceStartDate"])
	pbData["service_end_date"] = ParseDateValue(data["serviceEndDate"])
	pbData["reversal_date"] = ParseCampMinderInstant(data["reversalDate"])

	// Reversal tracking
	pbData["is_reversed"] = false
	if isReversed, ok := data["isReversed"].(bool); ok {
		pbData["is_reversed"] = isReversed
	}

	// String fields
	pbData["description"] = getStringOrEmpty(data, "description")
	pbData["transaction_note"] = getStringOrEmpty(data, "transactionNote")
	pbData["gl_account_note"] = getStringOrEmpty(data, "glAccountNote")
	pbData["recognition_gl_account_id"] = getStringOrEmpty(data, "recognitionGLAccountId")
	pbData["deferral_gl_account_id"] = getStringOrEmpty(data, "deferralGLAccountId")

	// Program (CM ID only - no program table)
	setIntFromFloat(pbData, data, "programId", "program_id")

	// Relations
	setRelation(pbData, data, "financialCategoryId", "financial_category", maps.FinancialCategories)
	setRelation(pbData, data, "paymentMethodId", "payment_method", maps.PaymentMethods)
	setRelation(pbData, data, "sessionId", "session", maps.Sessions)
	setRelation(pbData, data, "sessionGroupId", "session_group", maps.SessionGroups)
	setRelation(pbData, data, "divisionId", "division", maps.Divisions)
	setRelation(pbData, data, "personId", "person", maps.Persons)
	setRelation(pbData, data, "householdId", "household", maps.Households)

	// Raw CampMinder ids, stored whether or not they resolve above (design §6.1). 0 means
	// CampMinder sent none; always set, so a value that disappears upstream is cleared.
	pbData["person_cm_id"] = rawCMID(data, "personId")
	pbData["household_cm_id"] = rawCMID(data, "householdId")
	pbData["session_cm_id"] = rawCMID(data, "sessionId")
	pbData["financial_category_cm_id"] = rawCMID(data, "financialCategoryId")

	return pbData, nil
}

// transactionCompareFields are the fields ProcessSimpleRecord compares to decide whether an
// existing row needs an update. A field missing here is never written to an existing row.
var transactionCompareFields = []string{
	"cm_id", "transaction_number", "year",
	"post_date", "effective_date", "service_start_date", "service_end_date",
	"is_reversed", "reversal_date",
	"financial_category",
	"description", "transaction_note", "gl_account_note",
	"quantity", "unit_amount", "amount",
	"recognition_gl_account_id", "deferral_gl_account_id",
	"payment_method",
	"session",
	"program_id",
	"session_group",
	"division",
	"person",
	"household",
	"person_cm_id", "household_cm_id", "session_cm_id", "financial_category_cm_id",
}

// rawCMID returns a CampMinder id from the API row, or 0 when it is absent, null or zero.
func rawCMID(data map[string]any, key string) int {
	if id, ok := data[key].(float64); ok && id > 0 {
		return int(id)
	}
	return 0
}

// unresolvedTransactionIDs counts, per relation, rows whose CampMinder id had no matching
// PocketBase record. The raw id is stored regardless; this is the line that says how many
// relation columns are empty for that reason instead of silently.
type unresolvedTransactionIDs map[string]int

// rawIDRelations pairs each raw-id column with the relation column it resolves into.
var rawIDRelations = [][2]string{
	{"person_cm_id", "person"},
	{"household_cm_id", "household"},
	{"session_cm_id", "session"},
	{"financial_category_cm_id", "financial_category"},
}

func (u unresolvedTransactionIDs) tally(pbData map[string]any) {
	for _, pair := range rawIDRelations {
		id, _ := pbData[pair[0]].(int)
		if id == 0 {
			continue
		}
		if rel, _ := pbData[pair[1]].(string); rel == "" {
			u[pair[1]]++
		}
	}
}

func (u unresolvedTransactionIDs) log(year int) {
	if len(u) == 0 {
		return
	}
	slog.Warn("Transaction ids with no matching PocketBase record: raw CampMinder id stored, relation left empty",
		"year", year, "person", u["person"], "household", u["household"],
		"session", u["session"], "financial_category", u["financial_category"])
}

// getStringOrEmpty safely extracts a string from the data map
func getStringOrEmpty(data map[string]any, key string) string {
	if val, ok := data[key]; ok {
		if str, ok := val.(string); ok {
			return strings.TrimSpace(str)
		}
	}
	return ""
}

// setRelation maps a CampMinder ID field to a PocketBase relation.
// It extracts the float64 ID from data[srcKey], looks it up in lookupMap,
// and sets pbData[dstKey] if found.
func setRelation(pbData, data map[string]any, srcKey, dstKey string, lookupMap map[int]string) {
	if id, ok := data[srcKey].(float64); ok && id > 0 {
		if pbID, found := lookupMap[int(id)]; found {
			pbData[dstKey] = pbID
		}
	}
}

// setIntFromFloat extracts a float64 from data and sets it as int in pbData.
func setIntFromFloat(pbData, data map[string]any, srcKey, dstKey string) {
	if val, ok := data[srcKey].(float64); ok {
		pbData[dstKey] = int(val)
	}
}

// setFloatFromFloat extracts a float64 from data and sets it in pbData.
func setFloatFromFloat(pbData, data map[string]any, srcKey, dstKey string) {
	if val, ok := data[srcKey].(float64); ok {
		pbData[dstKey] = val
	}
}

// transactionKey creates a composite key from cm_id and amount
// CampMinder returns both original and reversal transactions with the same transactionId
// but opposite amounts, so we need both fields for uniqueness
func (s *FinancialTransactionsSync) transactionKey(cmID int, amount float64) string {
	return fmt.Sprintf("%d|%.2f", cmID, amount)
}

// deduplicateTransactions removes exact duplicate transactions from CampMinder
// This handles a CampMinder bug where some $0 transactions are returned twice.
//
// The key carries the row's season, matching the (cm_id, amount, year) unique index: without
// it a foreign-season row listed first would shadow this season's row with the same
// (cm_id, amount), and the stored row would read as an orphan. A row with no season takes
// `year`, the same fallback transformTransactionToPB applies.
func (s *FinancialTransactionsSync) deduplicateTransactions(
	transactions []map[string]any, year int,
) []map[string]any {
	seen := make(map[string]bool)
	result := make([]map[string]any, 0, len(transactions))
	duplicates := 0

	for _, txn := range transactions {
		txnID, ok1 := txn["transactionId"].(float64)
		amount, ok2 := txn["amount"].(float64)
		if !ok1 || !ok2 {
			result = append(result, txn)
			continue
		}

		season := year
		if rowSeason, ok := txn["season"].(float64); ok && rowSeason > 0 {
			season = int(rowSeason)
		}
		key := fmt.Sprintf("%d|%.2f|%d", int(txnID), amount, season)
		if seen[key] {
			duplicates++
			continue
		}
		seen[key] = true
		result = append(result, txn)
	}

	if duplicates > 0 {
		slog.Info("Deduplicated transactions (CampMinder API bug)", "removed", duplicates)
	}
	return result
}
