package sync

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/camp/kindred/pocketbase/campminder"
)

// Service name constant
const serviceNameFinancialTransactions = "financial_transactions"

// FinancialTransactionsSync handles syncing financial transactions from CampMinder
// This is a year-scoped table that runs in the daily sync
type FinancialTransactionsSync struct {
	BaseSyncService
}

// TransactionLookupMaps holds all the lookup maps needed for relation resolution
type TransactionLookupMaps struct {
	FinancialCategories map[int]string // cm_id -> PB ID
	PaymentMethods      map[int]string // cm_id -> PB ID
	Sessions            map[int]string // cm_id -> PB ID
	SessionGroups       map[int]string // cm_id -> PB ID
	Divisions           map[int]string // cm_id -> PB ID
	Persons             map[int]string // cm_id -> PB ID
	Households          map[int]string // cm_id -> PB ID
}

// NewFinancialTransactionsSync creates a new financial transactions sync service
func NewFinancialTransactionsSync(app core.App, client *campminder.Client) *FinancialTransactionsSync {
	return &FinancialTransactionsSync{
		BaseSyncService: NewBaseSyncService(app, client),
	}
}

// Name returns the name of this sync service
func (s *FinancialTransactionsSync) Name() string {
	return serviceNameFinancialTransactions
}

// Sync performs the year-scoped financial transactions sync
func (s *FinancialTransactionsSync) Sync(ctx context.Context) error {
	return s.SyncForYear(ctx, s.Client.GetSeasonID())
}

// SyncForYear syncs financial transactions for a specific year
// This is exposed for historical data syncing
func (s *FinancialTransactionsSync) SyncForYear(ctx context.Context, year int) error {
	s.LogSyncStart(serviceNameFinancialTransactions)
	s.Stats = Stats{}
	s.SyncSuccessful = false

	slog.Info("Syncing financial transactions", "year", year)

	// Pre-load existing records for this year
	// Key by cm_id + amount since CampMinder returns original+reversal with same transactionId
	filter := fmt.Sprintf("year = %d", year)
	preloadFn := func(record *core.Record) (interface{}, bool) {
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
	transactions, err := s.Client.GetTransactionDetails(year, true)
	if err != nil {
		return fmt.Errorf("fetching transactions: %w", err)
	}

	// Deduplicate by cm_id + amount (CampMinder bug returns some $0 transactions twice)
	transactions = s.deduplicateTransactions(transactions)

	slog.Info("Fetched financial transactions", "count", len(transactions))
	s.SyncSuccessful = true // Mark successful after fetch - enables orphan deletion

	totalTxns := len(transactions)
	for i, data := range transactions {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		// Log progress every 2000 records
		if i > 0 && i%2000 == 0 {
			slog.Info("Processing transactions", "progress", fmt.Sprintf("%d/%d", i, totalTxns),
				"created", s.Stats.Created, "updated", s.Stats.Updated, "skipped", s.Stats.Skipped)
		}

		pbData, err := s.transformTransactionToPB(data, year, lookupMaps)
		if err != nil {
			slog.Error("Error transforming transaction", "error", err)
			s.Stats.Errors++
			continue
		}

		cmID, ok := pbData["cm_id"].(int)
		if !ok || cmID == 0 {
			slog.Error("Invalid transaction cm_id")
			s.Stats.Errors++
			continue
		}

		amount, _ := pbData["amount"].(float64)
		txnKey := s.transactionKey(cmID, amount)

		s.TrackProcessedKey(txnKey, year)

		compareFields := []string{
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
		}
		err = s.ProcessSimpleRecord(
			"financial_transactions", txnKey, pbData, existingRecords, compareFields)
		if err != nil {
			slog.Error("Error processing transaction", "cm_id", cmID, "amount", amount, "error", err)
			s.Stats.Errors++
		}
	}

	// Delete orphans using preloaded data (avoids re-querying 22K+ records)
	if err := s.DeleteOrphansFromPreloaded(existingRecords, "financial transaction"); err != nil {
		slog.Error("Error deleting orphan transactions", "error", err)
	}

	// Force WAL checkpoint
	if err := s.ForceWALCheckpoint(); err != nil {
		slog.Warn("WAL checkpoint failed", "error", err)
	}

	// Log summary of which fields caused updates (for idempotency debugging)
	s.LogFieldDiffSummary()

	s.LogSyncComplete("Financial Transactions")
	return nil
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
	data map[string]interface{},
	year int,
	maps TransactionLookupMaps,
) (map[string]interface{}, error) {
	pbData := make(map[string]interface{})

	// transactionId (required)
	txnID, ok := data["transactionId"].(float64)
	if !ok || txnID == 0 {
		return nil, fmt.Errorf("invalid or missing transactionId")
	}
	pbData["cm_id"] = int(txnID)
	pbData["year"] = year

	// Optional int/float fields
	setIntFromFloat(pbData, data, "transactionNumber", "transaction_number")
	setIntFromFloat(pbData, data, "quantity", "quantity")
	setFloatFromFloat(pbData, data, "unitAmount", "unit_amount")
	setFloatFromFloat(pbData, data, "amount", "amount")

	// Dates
	pbData["post_date"] = s.parseDate(data["postDate"])
	pbData["effective_date"] = s.parseDate(data["effectiveDate"])
	pbData["service_start_date"] = s.parseDate(data["serviceStartDate"])
	pbData["service_end_date"] = s.parseDate(data["serviceEndDate"])
	pbData["reversal_date"] = s.parseDate(data["reversalDate"])

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

	return pbData, nil
}

// parseDate parses various date formats from CampMinder
func (s *FinancialTransactionsSync) parseDate(value interface{}) string {
	if value == nil {
		return ""
	}

	dateStr, ok := value.(string)
	if !ok || dateStr == "" {
		return ""
	}

	// Try common date formats
	formats := []string{
		time.RFC3339,
		time.RFC3339Nano,
		"2006-01-02T15:04:05Z",
		"2006-01-02T15:04:05.000Z",
		"2006-01-02T15:04:05",
		"2006-01-02",
	}

	for _, format := range formats {
		if t, err := time.Parse(format, dateStr); err == nil {
			return t.UTC().Format("2006-01-02 15:04:05Z")
		}
	}

	// Return original if we can't parse
	return ""
}

// getStringOrEmpty safely extracts a string from the data map
func getStringOrEmpty(data map[string]interface{}, key string) string {
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
func setRelation(pbData, data map[string]interface{}, srcKey, dstKey string, lookupMap map[int]string) {
	if id, ok := data[srcKey].(float64); ok && id > 0 {
		if pbID, found := lookupMap[int(id)]; found {
			pbData[dstKey] = pbID
		}
	}
}

// setIntFromFloat extracts a float64 from data and sets it as int in pbData.
func setIntFromFloat(pbData, data map[string]interface{}, srcKey, dstKey string) {
	if val, ok := data[srcKey].(float64); ok {
		pbData[dstKey] = int(val)
	}
}

// setFloatFromFloat extracts a float64 from data and sets it in pbData.
func setFloatFromFloat(pbData, data map[string]interface{}, srcKey, dstKey string) {
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
// This handles a CampMinder bug where some $0 transactions are returned twice
func (s *FinancialTransactionsSync) deduplicateTransactions(
	transactions []map[string]interface{},
) []map[string]interface{} {
	seen := make(map[string]bool)
	result := make([]map[string]interface{}, 0, len(transactions))
	duplicates := 0

	for _, txn := range transactions {
		txnID, ok1 := txn["transactionId"].(float64)
		amount, ok2 := txn["amount"].(float64)
		if !ok1 || !ok2 {
			result = append(result, txn)
			continue
		}

		key := fmt.Sprintf("%d|%.2f", int(txnID), amount)
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
