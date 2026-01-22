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
	existingRecords, err := s.PreloadRecords("financial_transactions", filter, func(record *core.Record) (interface{}, bool) {
		cmID, ok1 := record.Get("cm_id").(float64)
		amount, ok2 := record.Get("amount").(float64)
		if ok1 && cmID > 0 && ok2 {
			return s.transactionKey(int(cmID), amount), true
		}
		return nil, false
	})
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
		if err := s.ProcessSimpleRecord("financial_transactions", txnKey, pbData, existingRecords, compareFields); err != nil {
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
func (s *FinancialTransactionsSync) transformTransactionToPB(data map[string]interface{}, year int, maps TransactionLookupMaps) (map[string]interface{}, error) {
	pbData := make(map[string]interface{})

	// transactionId (required)
	txnID, ok := data["transactionId"].(float64)
	if !ok || txnID == 0 {
		return nil, fmt.Errorf("invalid or missing transactionId")
	}
	pbData["cm_id"] = int(txnID)

	// transactionNumber (optional)
	if txnNum, ok := data["transactionNumber"].(float64); ok {
		pbData["transaction_number"] = int(txnNum)
	}

	// year
	pbData["year"] = year

	// Dates
	pbData["post_date"] = s.parseDate(data["postDate"])
	pbData["effective_date"] = s.parseDate(data["effectiveDate"])
	pbData["service_start_date"] = s.parseDate(data["serviceStartDate"])
	pbData["service_end_date"] = s.parseDate(data["serviceEndDate"])

	// Reversal tracking
	if isReversed, ok := data["isReversed"].(bool); ok {
		pbData["is_reversed"] = isReversed
	} else {
		pbData["is_reversed"] = false
	}
	pbData["reversal_date"] = s.parseDate(data["reversalDate"])

	// Financial category (relation only)
	if catID, ok := data["financialCategoryId"].(float64); ok && catID > 0 {
		if pbID, found := maps.FinancialCategories[int(catID)]; found {
			pbData["financial_category"] = pbID
		}
	}

	// Description and notes
	pbData["description"] = getStringOrEmpty(data, "description")
	pbData["transaction_note"] = getStringOrEmpty(data, "transactionNote")
	pbData["gl_account_note"] = getStringOrEmpty(data, "glAccountNote")

	// Amounts
	if qty, ok := data["quantity"].(float64); ok {
		pbData["quantity"] = int(qty)
	}
	if unitAmt, ok := data["unitAmount"].(float64); ok {
		pbData["unit_amount"] = unitAmt
	}
	if amt, ok := data["amount"].(float64); ok {
		pbData["amount"] = amt
	}

	// GL accounts (string IDs)
	pbData["recognition_gl_account_id"] = getStringOrEmpty(data, "recognitionGLAccountId")
	pbData["deferral_gl_account_id"] = getStringOrEmpty(data, "deferralGLAccountId")

	// Payment method (relation only)
	if pmID, ok := data["paymentMethodId"].(float64); ok && pmID > 0 {
		if pbID, found := maps.PaymentMethods[int(pmID)]; found {
			pbData["payment_method"] = pbID
		}
	}

	// Session (relation only)
	if sessID, ok := data["sessionId"].(float64); ok && sessID > 0 {
		if pbID, found := maps.Sessions[int(sessID)]; found {
			pbData["session"] = pbID
		}
	}

	// Program (CM ID only - no program table)
	if progID, ok := data["programId"].(float64); ok && progID > 0 {
		pbData["program_id"] = int(progID)
	}

	// Session group (relation only)
	if groupID, ok := data["sessionGroupId"].(float64); ok && groupID > 0 {
		if pbID, found := maps.SessionGroups[int(groupID)]; found {
			pbData["session_group"] = pbID
		}
	}

	// Division (relation only)
	if divID, ok := data["divisionId"].(float64); ok && divID > 0 {
		if pbID, found := maps.Divisions[int(divID)]; found {
			pbData["division"] = pbID
		}
	}

	// Person (relation only)
	if personID, ok := data["personId"].(float64); ok && personID > 0 {
		if pbID, found := maps.Persons[int(personID)]; found {
			pbData["person"] = pbID
		}
	}

	// Household (relation only)
	if hhID, ok := data["householdId"].(float64); ok && hhID > 0 {
		if pbID, found := maps.Households[int(hhID)]; found {
			pbData["household"] = pbID
		}
	}

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

// transactionKey creates a composite key from cm_id and amount
// CampMinder returns both original and reversal transactions with the same transactionId
// but opposite amounts, so we need both fields for uniqueness
func (s *FinancialTransactionsSync) transactionKey(cmID int, amount float64) string {
	return fmt.Sprintf("%d|%.2f", cmID, amount)
}

// deduplicateTransactions removes exact duplicate transactions from CampMinder
// This handles a CampMinder bug where some $0 transactions are returned twice
func (s *FinancialTransactionsSync) deduplicateTransactions(transactions []map[string]interface{}) []map[string]interface{} {
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
