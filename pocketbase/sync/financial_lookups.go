package sync

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/pocketbase/pocketbase/core"

	"github.com/camp/kindred/pocketbase/campminder"
)

// Service name constant
const serviceNameFinancialLookups = "financial_lookups"

// FinancialLookupsSync handles syncing global financial lookup tables from CampMinder
// This includes: financial_categories, payment_methods
// These are global (not year-specific) and run in the weekly sync
type FinancialLookupsSync struct {
	BaseSyncService
}

// NewFinancialLookupsSync creates a new financial lookups sync service
func NewFinancialLookupsSync(app core.App, client *campminder.Client) *FinancialLookupsSync {
	return &FinancialLookupsSync{
		BaseSyncService: NewBaseSyncService(app, client),
	}
}

// Name returns the name of this sync service
func (s *FinancialLookupsSync) Name() string {
	return serviceNameFinancialLookups
}

// Sync performs the financial lookups sync - syncs all global lookup endpoints
func (s *FinancialLookupsSync) Sync(ctx context.Context) error {
	s.LogSyncStart(serviceNameFinancialLookups)
	s.Stats = Stats{}
	s.SyncSuccessful = false

	// Sync in dependency order:
	// 1. financial_categories (no dependencies)
	// 2. payment_methods (no dependencies)

	if err := s.syncFinancialCategories(ctx); err != nil {
		return fmt.Errorf("syncing financial_categories: %w", err)
	}

	if err := s.syncPaymentMethods(ctx); err != nil {
		return fmt.Errorf("syncing payment_methods: %w", err)
	}

	// Force WAL checkpoint
	if err := s.ForceWALCheckpoint(); err != nil {
		slog.Warn("WAL checkpoint failed", "error", err)
	}

	s.LogSyncComplete("Financial Lookups")
	return nil
}

// syncFinancialCategories syncs financial_categories from CampMinder
func (s *FinancialLookupsSync) syncFinancialCategories(ctx context.Context) error {
	slog.Info("Syncing financial categories")

	// Pre-load existing records (global - no year filter)
	existingRecords, err := s.PreloadRecordsGlobal("financial_categories", "", func(record *core.Record) (interface{}, bool) {
		if cmID, ok := record.Get("cm_id").(float64); ok && cmID > 0 {
			return int(cmID), true
		}
		return nil, false
	})
	if err != nil {
		return err
	}

	s.ClearProcessedKeys()

	// Fetch from CampMinder (include archived for complete data)
	categories, err := s.Client.GetFinancialCategories(true)
	if err != nil {
		return fmt.Errorf("fetching financial categories: %w", err)
	}

	slog.Info("Fetched financial categories", "count", len(categories))
	s.SyncSuccessful = true // Mark successful after fetch - enables orphan deletion

	for _, data := range categories {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		pbData, err := s.transformFinancialCategoryToPB(data)
		if err != nil {
			slog.Error("Error transforming financial category", "error", err)
			s.Stats.Errors++
			continue
		}

		cmID, ok := pbData["cm_id"].(int)
		if !ok || cmID == 0 {
			slog.Error("Invalid financial category cm_id")
			s.Stats.Errors++
			continue
		}

		s.TrackProcessedKey(cmID, 0) // Global table - no year

		compareFields := []string{"cm_id", "name", "is_archived"}
		if err := s.ProcessSimpleRecordGlobal("financial_categories", cmID, pbData, existingRecords, compareFields); err != nil {
			slog.Error("Error processing financial category", "cm_id", cmID, "error", err)
			s.Stats.Errors++
		}
	}

	// Delete orphans (global table)
	if err := s.DeleteOrphans(
		"financial_categories",
		func(record *core.Record) (string, bool) {
			cmIDValue := record.Get("cm_id")
			cmID, ok := cmIDValue.(float64)
			if ok && cmID > 0 {
				return CompositeKey(int(cmID), 0), true
			}
			return "", false
		},
		"financial category",
		"", // No filter - all records
	); err != nil {
		slog.Error("Error deleting orphan financial categories", "error", err)
	}

	return nil
}

// syncPaymentMethods syncs payment_methods from CampMinder
func (s *FinancialLookupsSync) syncPaymentMethods(ctx context.Context) error {
	slog.Info("Syncing payment methods")

	// Pre-load existing records (global - no year filter)
	existingRecords, err := s.PreloadRecordsGlobal("payment_methods", "", func(record *core.Record) (interface{}, bool) {
		if cmID, ok := record.Get("cm_id").(float64); ok && cmID > 0 {
			return int(cmID), true
		}
		return nil, false
	})
	if err != nil {
		return err
	}

	s.ClearProcessedKeys()

	// Fetch from CampMinder
	methods, err := s.Client.GetPaymentMethods()
	if err != nil {
		return fmt.Errorf("fetching payment methods: %w", err)
	}

	slog.Info("Fetched payment methods", "count", len(methods))
	s.SyncSuccessful = true // Mark successful after fetch - enables orphan deletion

	for _, data := range methods {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		pbData, err := s.transformPaymentMethodToPB(data)
		if err != nil {
			slog.Error("Error transforming payment method", "error", err)
			s.Stats.Errors++
			continue
		}

		cmID, ok := pbData["cm_id"].(int)
		if !ok || cmID == 0 {
			slog.Error("Invalid payment method cm_id")
			s.Stats.Errors++
			continue
		}

		s.TrackProcessedKey(cmID, 0) // Global table - no year

		compareFields := []string{"cm_id", "name"}
		if err := s.ProcessSimpleRecordGlobal("payment_methods", cmID, pbData, existingRecords, compareFields); err != nil {
			slog.Error("Error processing payment method", "cm_id", cmID, "error", err)
			s.Stats.Errors++
		}
	}

	// Delete orphans (global table)
	if err := s.DeleteOrphans(
		"payment_methods",
		func(record *core.Record) (string, bool) {
			cmIDValue := record.Get("cm_id")
			cmID, ok := cmIDValue.(float64)
			if ok && cmID > 0 {
				return CompositeKey(int(cmID), 0), true
			}
			return "", false
		},
		"payment method",
		"", // No filter - all records
	); err != nil {
		slog.Error("Error deleting orphan payment methods", "error", err)
	}

	return nil
}

// Transform functions

func (s *FinancialLookupsSync) transformFinancialCategoryToPB(data map[string]interface{}) (map[string]interface{}, error) {
	pbData := make(map[string]interface{})

	// id (required) - API uses lowercase field names
	idFloat, ok := data["id"].(float64)
	if !ok || idFloat == 0 {
		return nil, fmt.Errorf("invalid or missing financial category id")
	}
	pbData["cm_id"] = int(idFloat)

	// name (nullable in API)
	if name, ok := data["name"].(string); ok {
		pbData["name"] = name
	} else {
		pbData["name"] = ""
	}

	// isArchived (required in API, defaults to false)
	if isArchived, ok := data["isArchived"].(bool); ok {
		pbData["is_archived"] = isArchived
	} else {
		pbData["is_archived"] = false
	}

	return pbData, nil
}

func (s *FinancialLookupsSync) transformPaymentMethodToPB(data map[string]interface{}) (map[string]interface{}, error) {
	pbData := make(map[string]interface{})

	// id (required) - API uses lowercase field names
	idFloat, ok := data["id"].(float64)
	if !ok || idFloat == 0 {
		return nil, fmt.Errorf("invalid or missing payment method id")
	}
	pbData["cm_id"] = int(idFloat)

	// name (nullable in API)
	if name, ok := data["name"].(string); ok {
		pbData["name"] = name
	} else {
		pbData["name"] = ""
	}

	return pbData, nil
}
