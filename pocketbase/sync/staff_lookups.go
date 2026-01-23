package sync

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/pocketbase/pocketbase/core"

	"github.com/camp/kindred/pocketbase/campminder"
)

// Service name constant
const serviceNameStaffLookups = "staff_lookups"

// StaffLookupsSync handles syncing global staff lookup tables from CampMinder
// This includes: staff_program_areas, staff_org_categories, staff_positions
// These are global (not year-specific) and run in the weekly sync
type StaffLookupsSync struct {
	BaseSyncService
}

// NewStaffLookupsSync creates a new staff lookups sync service
func NewStaffLookupsSync(app core.App, client *campminder.Client) *StaffLookupsSync {
	return &StaffLookupsSync{
		BaseSyncService: NewBaseSyncService(app, client),
	}
}

// Name returns the name of this sync service
func (s *StaffLookupsSync) Name() string {
	return serviceNameStaffLookups
}

// Sync performs the staff lookups sync - syncs all 3 global lookup endpoints
func (s *StaffLookupsSync) Sync(ctx context.Context) error {
	s.LogSyncStart(serviceNameStaffLookups)
	s.Stats = Stats{}
	s.SyncSuccessful = false

	// Sync in dependency order:
	// 1. staff_program_areas (no dependencies)
	// 2. staff_org_categories (no dependencies)
	// 3. staff_positions (depends on program_areas for relation)

	if err := s.syncProgramAreas(ctx); err != nil {
		return fmt.Errorf("syncing staff_program_areas: %w", err)
	}

	if err := s.syncOrgCategories(ctx); err != nil {
		return fmt.Errorf("syncing staff_org_categories: %w", err)
	}

	if err := s.syncPositions(ctx); err != nil {
		return fmt.Errorf("syncing staff_positions: %w", err)
	}

	// Force WAL checkpoint
	if err := s.ForceWALCheckpoint(); err != nil {
		slog.Warn("WAL checkpoint failed", "error", err)
	}

	s.LogSyncComplete("Staff Lookups")
	return nil
}

// syncProgramAreas syncs staff_program_areas from CampMinder
//
//nolint:dupl // Similar pattern to syncPaymentMethods, intentional for lookup table sync
func (s *StaffLookupsSync) syncProgramAreas(ctx context.Context) error {
	slog.Info("Syncing staff program areas")

	// Pre-load existing records (global - no year filter)
	preloadFn := func(record *core.Record) (interface{}, bool) {
		if cmID, ok := record.Get("cm_id").(float64); ok && cmID > 0 {
			return int(cmID), true
		}
		return nil, false
	}
	existingRecords, err := s.PreloadRecordsGlobal("staff_program_areas", "", preloadFn)
	if err != nil {
		return err
	}

	s.ClearProcessedKeys()

	// Fetch from CampMinder
	programAreas, err := s.Client.GetStaffProgramAreas()
	if err != nil {
		return fmt.Errorf("fetching program areas: %w", err)
	}

	slog.Info("Fetched staff program areas", "count", len(programAreas))
	s.SyncSuccessful = true // Mark successful after fetch - enables orphan deletion

	for _, data := range programAreas {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		pbData, err := s.transformProgramAreaToPB(data)
		if err != nil {
			slog.Error("Error transforming program area", "error", err)
			s.Stats.Errors++
			continue
		}

		cmID, ok := pbData["cm_id"].(int)
		if !ok || cmID == 0 {
			slog.Error("Invalid program area cm_id")
			s.Stats.Errors++
			continue
		}

		s.TrackProcessedKey(cmID, 0) // Global table - no year

		compareFields := []string{"cm_id", "name"}
		err = s.ProcessSimpleRecordGlobal(
			"staff_program_areas", cmID, pbData, existingRecords, compareFields)
		if err != nil {
			slog.Error("Error processing program area", "cm_id", cmID, "error", err)
			s.Stats.Errors++
		}
	}

	// Delete orphans (global table)
	if err := s.DeleteOrphans(
		"staff_program_areas",
		func(record *core.Record) (string, bool) {
			cmIDValue := record.Get("cm_id")
			cmID, ok := cmIDValue.(float64)
			if ok && cmID > 0 {
				return CompositeKey(int(cmID), 0), true
			}
			return "", false
		},
		"staff program area",
		"", // No filter - all records
	); err != nil {
		slog.Error("Error deleting orphan program areas", "error", err)
	}

	return nil
}

// syncOrgCategories syncs staff_org_categories from CampMinder
//
//nolint:dupl // Similar pattern to syncPaymentMethods, intentional for lookup table sync
func (s *StaffLookupsSync) syncOrgCategories(ctx context.Context) error {
	slog.Info("Syncing staff org categories")

	// Pre-load existing records (global - no year filter)
	preloadFn := func(record *core.Record) (interface{}, bool) {
		if cmID, ok := record.Get("cm_id").(float64); ok && cmID > 0 {
			return int(cmID), true
		}
		return nil, false
	}
	existingRecords, err := s.PreloadRecordsGlobal("staff_org_categories", "", preloadFn)
	if err != nil {
		return err
	}

	s.ClearProcessedKeys()

	// Fetch from CampMinder
	orgCategories, err := s.Client.GetStaffOrgCategories()
	if err != nil {
		return fmt.Errorf("fetching org categories: %w", err)
	}

	slog.Info("Fetched staff org categories", "count", len(orgCategories))
	s.SyncSuccessful = true // Mark successful after fetch - enables orphan deletion

	for _, data := range orgCategories {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		pbData, err := s.transformOrgCategoryToPB(data)
		if err != nil {
			slog.Error("Error transforming org category", "error", err)
			s.Stats.Errors++
			continue
		}

		cmID, ok := pbData["cm_id"].(int)
		if !ok || cmID == 0 {
			slog.Error("Invalid org category cm_id")
			s.Stats.Errors++
			continue
		}

		s.TrackProcessedKey(cmID, 0) // Global table - no year

		compareFields := []string{"cm_id", "name"}
		err = s.ProcessSimpleRecordGlobal(
			"staff_org_categories", cmID, pbData, existingRecords, compareFields)
		if err != nil {
			slog.Error("Error processing org category", "cm_id", cmID, "error", err)
			s.Stats.Errors++
		}
	}

	// Delete orphans (global table)
	if err := s.DeleteOrphans(
		"staff_org_categories",
		func(record *core.Record) (string, bool) {
			cmIDValue := record.Get("cm_id")
			cmID, ok := cmIDValue.(float64)
			if ok && cmID > 0 {
				return CompositeKey(int(cmID), 0), true
			}
			return "", false
		},
		"staff org category",
		"", // No filter - all records
	); err != nil {
		slog.Error("Error deleting orphan org categories", "error", err)
	}

	return nil
}

// syncPositions syncs staff_positions from CampMinder
func (s *StaffLookupsSync) syncPositions(ctx context.Context) error {
	slog.Info("Syncing staff positions")

	// Pre-load existing records (global - no year filter)
	existingRecords, err := s.PreloadRecordsGlobal("staff_positions", "", func(record *core.Record) (interface{}, bool) {
		if cmID, ok := record.Get("cm_id").(float64); ok && cmID > 0 {
			return int(cmID), true
		}
		return nil, false
	})
	if err != nil {
		return err
	}

	// Build program area lookup map for relations
	programAreaMap := make(map[int]string) // cm_id -> PB ID
	programAreas, err := s.App.FindRecordsByFilter("staff_program_areas", "", "", 0, 0)
	if err != nil {
		slog.Warn("Error loading program areas for relation resolution", "error", err)
	} else {
		for _, record := range programAreas {
			if cmID, ok := record.Get("cm_id").(float64); ok && cmID > 0 {
				programAreaMap[int(cmID)] = record.Id
			}
		}
	}

	s.ClearProcessedKeys()

	// Fetch from CampMinder
	positions, err := s.Client.GetStaffPositions()
	if err != nil {
		return fmt.Errorf("fetching positions: %w", err)
	}

	slog.Info("Fetched staff positions", "count", len(positions))
	s.SyncSuccessful = true // Mark successful after fetch - enables orphan deletion

	for _, data := range positions {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		pbData, err := s.transformPositionToPB(data, programAreaMap)
		if err != nil {
			slog.Error("Error transforming position", "error", err)
			s.Stats.Errors++
			continue
		}

		cmID, ok := pbData["cm_id"].(int)
		if !ok || cmID == 0 {
			slog.Error("Invalid position cm_id")
			s.Stats.Errors++
			continue
		}

		s.TrackProcessedKey(cmID, 0) // Global table - no year

		compareFields := []string{"cm_id", "name", "program_area"}
		if err := s.ProcessSimpleRecordGlobal("staff_positions", cmID, pbData, existingRecords, compareFields); err != nil {
			slog.Error("Error processing position", "cm_id", cmID, "error", err)
			s.Stats.Errors++
		}
	}

	// Delete orphans (global table)
	if err := s.DeleteOrphans(
		"staff_positions",
		func(record *core.Record) (string, bool) {
			cmIDValue := record.Get("cm_id")
			cmID, ok := cmIDValue.(float64)
			if ok && cmID > 0 {
				return CompositeKey(int(cmID), 0), true
			}
			return "", false
		},
		"staff position",
		"", // No filter - all records
	); err != nil {
		slog.Error("Error deleting orphan positions", "error", err)
	}

	return nil
}

// Transform functions

func (s *StaffLookupsSync) transformProgramAreaToPB(data map[string]interface{}) (map[string]interface{}, error) {
	pbData := make(map[string]interface{})

	// ID (required)
	idFloat, ok := data["ID"].(float64)
	if !ok || idFloat == 0 {
		return nil, fmt.Errorf("invalid or missing program area ID")
	}
	pbData["cm_id"] = int(idFloat)

	// Name (required)
	name, ok := data["Name"].(string)
	if !ok || name == "" {
		return nil, fmt.Errorf("invalid or missing program area Name")
	}
	pbData["name"] = name

	return pbData, nil
}

func (s *StaffLookupsSync) transformOrgCategoryToPB(data map[string]interface{}) (map[string]interface{}, error) {
	pbData := make(map[string]interface{})

	// ID (required)
	idFloat, ok := data["ID"].(float64)
	if !ok || idFloat == 0 {
		return nil, fmt.Errorf("invalid or missing org category ID")
	}
	pbData["cm_id"] = int(idFloat)

	// Name (required)
	name, ok := data["Name"].(string)
	if !ok || name == "" {
		return nil, fmt.Errorf("invalid or missing org category Name")
	}
	pbData["name"] = name

	return pbData, nil
}

func (s *StaffLookupsSync) transformPositionToPB(
	data map[string]interface{},
	programAreaMap map[int]string,
) (map[string]interface{}, error) {
	pbData := make(map[string]interface{})

	// ID (required)
	idFloat, ok := data["ID"].(float64)
	if !ok || idFloat == 0 {
		return nil, fmt.Errorf("invalid or missing position ID")
	}
	pbData["cm_id"] = int(idFloat)

	// Name (required)
	name, ok := data["Name"].(string)
	if !ok || name == "" {
		return nil, fmt.Errorf("invalid or missing position Name")
	}
	pbData["name"] = name

	// ProgramAreaID (optional relation)
	if programAreaID, ok := data["ProgramAreaID"].(float64); ok && programAreaID > 0 {
		if pbID, found := programAreaMap[int(programAreaID)]; found {
			pbData["program_area"] = pbID
		}
	}

	return pbData, nil
}
