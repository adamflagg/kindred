package sync

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

const (
	// serviceNameMultiWorkbook is the name of the multi-workbook export service
	serviceNameMultiWorkbook = "multi_workbook_export"
)

// WorkbookManagerInterface defines the interface for workbook management.
// This allows mocking in tests while the real WorkbookManager handles
// database storage and Google Sheets API calls.
type WorkbookManagerInterface interface {
	GetOrCreateGlobalsWorkbook(ctx context.Context) (string, error)
	GetOrCreateYearWorkbook(ctx context.Context, year int) (string, error)
	UpdateMasterIndex(ctx context.Context) error
}

// MultiWorkbookExport handles exporting data to multiple Google Sheets workbooks.
// Unlike GoogleSheetsExport which uses a single spreadsheet, this exports:
// - Global tables to a dedicated globals workbook
// - Year-specific tables to per-year workbooks
// - Updates a master index sheet in the globals workbook
type MultiWorkbookExport struct {
	BaseSyncService
	sheetsWriter    SheetsWriter
	workbookManager WorkbookManagerInterface
	year            int
}

// NewMultiWorkbookExport creates a new multi-workbook export service.
// The workbookManager handles workbook lifecycle (create, share, track).
func NewMultiWorkbookExport(
	app core.App,
	sheetsWriter SheetsWriter,
	workbookManager WorkbookManagerInterface,
	year int,
) *MultiWorkbookExport {
	// Get year from environment if not specified
	if year == 0 {
		if yearStr := os.Getenv("CAMPMINDER_SEASON_ID"); yearStr != "" {
			if parsed, err := strconv.Atoi(yearStr); err == nil {
				year = parsed
			}
		}
		if year == 0 {
			year = 2025 // Default
		}
	}

	return &MultiWorkbookExport{
		BaseSyncService: BaseSyncService{
			App:           app,
			Stats:         Stats{},
			ProcessedKeys: make(map[string]bool),
		},
		sheetsWriter:    sheetsWriter,
		workbookManager: workbookManager,
		year:            year,
	}
}

// Name returns the name of this sync service.
func (m *MultiWorkbookExport) Name() string {
	return serviceNameMultiWorkbook
}

// Sync implements the Service interface - exports data to multiple workbooks.
// This is the main entry point for full exports.
func (m *MultiWorkbookExport) Sync(ctx context.Context) error {
	startTime := time.Now()
	slog.Info("Starting multi-workbook export",
		"year", m.year,
	)

	m.Stats = Stats{}
	m.SyncSuccessful = false

	// 1. Export global tables to globals workbook
	if err := m.SyncGlobalsOnly(ctx); err != nil {
		slog.Error("Failed to export global tables", "error", err)
		// Continue with year-specific data even if globals fail
	}

	// 2. Export year-specific tables to year workbook
	if err := m.SyncYearData(ctx, m.year); err != nil {
		return fmt.Errorf("exporting year-specific data: %w", err)
	}

	// 3. Update master index in globals workbook
	if err := m.workbookManager.UpdateMasterIndex(ctx); err != nil {
		slog.Warn("Failed to update master index", "error", err)
		// Don't fail the sync if index update fails
	}

	m.SyncSuccessful = true
	m.Stats.Duration = int(time.Since(startTime).Seconds())

	slog.Info("Multi-workbook export complete",
		"duration_seconds", m.Stats.Duration,
		"records_exported", m.Stats.Created,
	)

	return nil
}

// SyncGlobalsOnly exports only global tables to the globals workbook.
func (m *MultiWorkbookExport) SyncGlobalsOnly(ctx context.Context) error {
	slog.Info("Starting globals-only export to globals workbook")

	// Get/create globals workbook
	globalsID, err := m.workbookManager.GetOrCreateGlobalsWorkbook(ctx)
	if err != nil {
		return fmt.Errorf("getting globals workbook: %w", err)
	}

	slog.Info("Using globals workbook", "spreadsheet_id", globalsID)

	// Get readable global export configs (no g- prefix)
	configs := GetReadableGlobalExports()
	if len(configs) == 0 {
		slog.Info("No global exports configured")
		return nil
	}

	// Create resolver with global lookups
	resolver := NewFieldResolver()
	if err := m.preloadGlobalLookups(resolver); err != nil {
		slog.Warn("Failed to preload global lookups", "error", err)
	}

	// Export each global table
	exporter := NewTableExporter(m.sheetsWriter, resolver, globalsID, 0)

	for _, config := range configs {
		slog.Info("Exporting global table", "collection", config.Collection, "sheet", config.SheetName)

		// Query records from PocketBase
		records, err := m.queryCollection(config.Collection, config.Filter, 0)
		if err != nil {
			slog.Error("Failed to query collection",
				"collection", config.Collection,
				"error", err,
			)
			continue
		}

		// Export to sheet
		if err := exporter.Export(ctx, &config, records); err != nil {
			slog.Error("Failed to export collection",
				"collection", config.Collection,
				"error", err,
			)
			continue
		}

		m.Stats.Created += len(records)
	}

	// Delete default "Sheet1" that Google creates when spreadsheet is made
	if err := m.sheetsWriter.DeleteSheet(ctx, globalsID, "Sheet1"); err != nil {
		slog.Warn("Failed to delete Sheet1 from globals workbook", "error", err)
	}

	// Reorder tabs alphabetically with colors (Index first)
	if err := ReorderGlobalsWorkbookTabs(ctx, m.sheetsWriter, globalsID); err != nil {
		slog.Warn("Failed to reorder globals workbook tabs", "error", err)
	}

	slog.Info("Globals-only export complete",
		"tables_exported", len(configs),
	)

	return nil
}

// SyncYearData exports year-specific tables to the year workbook.
func (m *MultiWorkbookExport) SyncYearData(ctx context.Context, year int) error {
	slog.Info("Starting year data export", "year", year)

	// Get/create year workbook
	yearID, err := m.workbookManager.GetOrCreateYearWorkbook(ctx, year)
	if err != nil {
		return fmt.Errorf("getting year %d workbook: %w", year, err)
	}

	slog.Info("Using year workbook", "year", year, "spreadsheet_id", yearID)

	// Get readable year export configs (no year prefix)
	configs := GetReadableYearExports()
	if len(configs) == 0 {
		slog.Info("No year-specific exports configured")
		return nil
	}

	// Create resolver with preloaded lookup data
	resolver := NewFieldResolver()
	if err := m.preloadLookups(resolver, year); err != nil {
		slog.Warn("Failed to preload some lookups", "error", err)
	}

	// Export each table
	exporter := NewTableExporter(m.sheetsWriter, resolver, yearID, year)

	for _, config := range configs {
		slog.Info("Exporting table", "collection", config.Collection, "sheet", config.SheetName, "year", year)

		// Build year filter
		filter := fmt.Sprintf("year = %d", year)
		if config.Filter != "" {
			filter = fmt.Sprintf("%s && %s", filter, config.Filter)
		}

		// Query records
		records, err := m.queryCollection(config.Collection, filter, 0)
		if err != nil {
			slog.Error("Failed to query collection",
				"collection", config.Collection,
				"year", year,
				"error", err,
			)
			continue
		}

		// Export to sheet
		if err := exporter.Export(ctx, &config, records); err != nil {
			slog.Error("Failed to export collection",
				"collection", config.Collection,
				"year", year,
				"error", err,
			)
			continue
		}

		m.Stats.Created += len(records)
	}

	// Delete default "Sheet1" that Google creates when spreadsheet is made
	if err := m.sheetsWriter.DeleteSheet(ctx, yearID, "Sheet1"); err != nil {
		slog.Warn("Failed to delete Sheet1 from year workbook", "error", err, "year", year)
	}

	// Reorder tabs alphabetically with colors
	if err := ReorderYearWorkbookTabs(ctx, m.sheetsWriter, yearID); err != nil {
		slog.Warn("Failed to reorder year workbook tabs", "error", err, "year", year)
	}

	slog.Info("Year data export complete", "year", year)

	return nil
}

// SyncForYears exports year-specific tables for the specified years.
// Each year goes to its own workbook.
func (m *MultiWorkbookExport) SyncForYears(ctx context.Context, years []int, includeGlobals bool) error {
	slog.Info("Starting historical export",
		"years", years,
		"includeGlobals", includeGlobals,
	)

	// Export globals first if requested
	if includeGlobals {
		if err := m.SyncGlobalsOnly(ctx); err != nil {
			slog.Error("Failed to export globals", "error", err)
			// Continue with year data anyway
		}
	}

	// Export each year to its own workbook
	for _, year := range years {
		if err := m.SyncYearData(ctx, year); err != nil {
			slog.Error("Failed to export year data",
				"year", year,
				"error", err,
			)
			// Continue with other years
		}
	}

	// Update master index after all exports
	if err := m.workbookManager.UpdateMasterIndex(ctx); err != nil {
		slog.Warn("Failed to update master index", "error", err)
	}

	return nil
}

// queryCollection queries records from a PocketBase collection.
func (m *MultiWorkbookExport) queryCollection(collection, filter string, limit int) ([]map[string]interface{}, error) {
	records, err := m.App.FindRecordsByFilter(
		collection,
		filter,
		"", // no sort
		limit,
		0, // no offset
	)
	if err != nil {
		return nil, fmt.Errorf("querying %s: %w", collection, err)
	}

	// Convert to map format for generic processing
	result := make([]map[string]interface{}, len(records))
	for i, r := range records {
		data := make(map[string]interface{})
		data["id"] = r.Id
		for _, field := range r.Collection().Fields {
			data[field.GetName()] = r.Get(field.GetName())
		}
		result[i] = data
	}

	return result, nil
}

// preloadLookups preloads lookup data for relations (year-scoped).
func (m *MultiWorkbookExport) preloadLookups(resolver *FieldResolver, year int) error {
	// Load sessions (names and CM IDs)
	sessions, err := m.loadSessions(year)
	if err == nil {
		sessionLookup := make(map[string]string)
		sessionCMIDs := make(map[string]int)
		sessionByCMID := make(map[int]string)
		for id, s := range sessions {
			sessionLookup[id] = s.Name
			if cmID := m.getCMIDFromRecord("camp_sessions", id); cmID > 0 {
				sessionCMIDs[id] = cmID
				sessionByCMID[cmID] = s.Name
			}
		}
		resolver.SetLookupData("camp_sessions", sessionLookup)
		resolver.SetCMIDLookupData("camp_sessions", sessionCMIDs)
		resolver.SetCMIDIndexedLookup("camp_sessions", sessionByCMID)
	}

	// Load persons (names, CM IDs, and nested fields)
	persons, err := m.loadPersons(year)
	if err == nil {
		personLookup := make(map[string]string)
		personCMIDs := make(map[string]int)
		personFirstNames := make(map[string]string)
		personLastNames := make(map[string]string)
		for id, p := range persons {
			personLookup[id] = fmt.Sprintf("%s %s", p.FirstName, p.LastName)
			personFirstNames[id] = p.FirstName
			personLastNames[id] = p.LastName
			if cmID := m.getCMIDFromRecord("persons", id); cmID > 0 {
				personCMIDs[id] = cmID
			}
		}
		resolver.SetLookupData("persons", personLookup)
		resolver.SetCMIDLookupData("persons", personCMIDs)
		resolver.SetNestedFieldLookupData("persons", "first_name", personFirstNames)
		resolver.SetNestedFieldLookupData("persons", "last_name", personLastNames)
	}

	// Load person tag definitions (global)
	tagLookup, err := m.loadSimpleLookup("person_tag_defs", "name", "")
	if err == nil {
		resolver.SetLookupData("person_tag_defs", tagLookup)
	}

	// Load bunks (names and CM IDs)
	bunkLookup, bunkCMIDs, err := m.loadLookupWithCMID("bunks", "name", "")
	if err == nil {
		resolver.SetLookupData("bunks", bunkLookup)
		resolver.SetCMIDLookupData("bunks", bunkCMIDs)
	}

	// Load divisions (names and CM IDs)
	divisionLookup, divisionCMIDs, err := m.loadLookupWithCMID("divisions", "name", "")
	if err == nil {
		resolver.SetLookupData("divisions", divisionLookup)
		resolver.SetCMIDLookupData("divisions", divisionCMIDs)
	}

	// Load staff positions (with program_area link for double FK)
	positionLookup, err := m.loadSimpleLookup("staff_positions", "name", "")
	if err == nil {
		resolver.SetLookupData("staff_positions", positionLookup)
	}
	positionToProgramArea, err := m.loadRelationMapping("staff_positions", "program_area")
	if err == nil {
		resolver.SetDoubleFKLookupData("staff_positions", "program_area", positionToProgramArea)
	}

	// Load staff program areas
	programAreaLookup, err := m.loadSimpleLookup("staff_program_areas", "name", "")
	if err == nil {
		resolver.SetLookupData("staff_program_areas", programAreaLookup)
	}

	// Load staff org categories
	orgCategoryLookup, err := m.loadSimpleLookup("staff_org_categories", "name", "")
	if err == nil {
		resolver.SetLookupData("staff_org_categories", orgCategoryLookup)
	}

	// Load session groups (year-scoped)
	sessionGroupFilter := fmt.Sprintf("year = %d", year)
	sessionGroupLookup, sessionGroupCMIDs, err := m.loadLookupWithCMID("session_groups", "name", sessionGroupFilter)
	if err == nil {
		resolver.SetLookupData("session_groups", sessionGroupLookup)
		resolver.SetCMIDLookupData("session_groups", sessionGroupCMIDs)
	}

	// Load financial categories (names and CM IDs)
	categoryLookup, categoryCMIDs, err := m.loadLookupWithCMID("financial_categories", "name", "")
	if err == nil {
		resolver.SetLookupData("financial_categories", categoryLookup)
		resolver.SetCMIDLookupData("financial_categories", categoryCMIDs)
	}

	// Load payment methods (names and CM IDs)
	paymentMethodLookup, paymentMethodCMIDs, err := m.loadLookupWithCMID("payment_methods", "name", "")
	if err == nil {
		resolver.SetLookupData("payment_methods", paymentMethodLookup)
		resolver.SetCMIDLookupData("payment_methods", paymentMethodCMIDs)
	}

	// Load households (mailing_title and CM IDs, year-scoped)
	householdFilter := fmt.Sprintf("year = %d", year)
	householdLookup, householdCMIDs, err := m.loadLookupWithCMID("households", "mailing_title", householdFilter)
	if err == nil {
		resolver.SetLookupData("households", householdLookup)
		resolver.SetCMIDLookupData("households", householdCMIDs)
	}

	// Load custom field definitions (names and CM IDs, global)
	customFieldLookup, customFieldCMIDs, err := m.loadLookupWithCMID("custom_field_defs", "name", "")
	if err == nil {
		resolver.SetLookupData("custom_field_defs", customFieldLookup)
		resolver.SetCMIDLookupData("custom_field_defs", customFieldCMIDs)
	}

	return nil
}

// preloadGlobalLookups preloads lookup data needed for global exports.
func (m *MultiWorkbookExport) preloadGlobalLookups(resolver *FieldResolver) error {
	// Load divisions (for parent_division resolution)
	divisionLookup, divisionCMIDs, err := m.loadLookupWithCMID("divisions", "name", "")
	if err == nil {
		resolver.SetLookupData("divisions", divisionLookup)
		resolver.SetCMIDLookupData("divisions", divisionCMIDs)
	}

	// Load staff program areas (for staff_positions.program_area resolution)
	programAreaLookup, err := m.loadSimpleLookup("staff_program_areas", "name", "")
	if err == nil {
		resolver.SetLookupData("staff_program_areas", programAreaLookup)
	}

	return nil
}

// loadSessions loads all sessions for a year into a map keyed by PB ID.
func (m *MultiWorkbookExport) loadSessions(year int) (map[string]SessionRecord, error) {
	filter := fmt.Sprintf("year = %d", year)
	records, err := m.App.FindRecordsByFilter("camp_sessions", filter, "", 0, 0)
	if err != nil {
		return nil, err
	}

	sessionMap := make(map[string]SessionRecord)
	for _, r := range records {
		y := 0
		if yearVal := r.Get("year"); yearVal != nil {
			if yearFloat, ok := yearVal.(float64); ok {
				y = int(yearFloat)
			}
		}
		sessionMap[r.Id] = SessionRecord{
			Name:      safeString(r.Get("name")),
			Type:      safeString(r.Get("session_type")),
			StartDate: safeString(r.Get("start_date")),
			EndDate:   safeString(r.Get("end_date")),
			Year:      y,
		}
	}
	return sessionMap, nil
}

// loadPersons loads all persons for a year into a map keyed by PB ID.
func (m *MultiWorkbookExport) loadPersons(year int) (map[string]PersonInfo, error) {
	filter := fmt.Sprintf("year = %d", year)
	records, err := m.App.FindRecordsByFilter("persons", filter, "", 0, 0)
	if err != nil {
		return nil, err
	}

	personMap := make(map[string]PersonInfo)
	for _, r := range records {
		grade := 0
		if gradeVal := r.Get("grade"); gradeVal != nil {
			if gradeFloat, ok := gradeVal.(float64); ok {
				grade = int(gradeFloat)
			}
		}
		personMap[r.Id] = PersonInfo{
			FirstName: safeString(r.Get("first_name")),
			LastName:  safeString(r.Get("last_name")),
			Gender:    safeString(r.Get("gender")),
			Grade:     grade,
		}
	}
	return personMap, nil
}

// loadLookupWithCMID loads a lookup with both display name and CM ID.
func (m *MultiWorkbookExport) loadLookupWithCMID(
	collection, field, filter string,
) (lookup map[string]string, cmids map[string]int, err error) {
	records, err := m.App.FindRecordsByFilter(collection, filter, "", 0, 0)
	if err != nil {
		return nil, nil, err
	}

	lookup = make(map[string]string)
	cmids = make(map[string]int)
	for _, r := range records {
		lookup[r.Id] = safeString(r.Get(field))
		if cmID := r.Get("cm_id"); cmID != nil {
			if cmIDFloat, ok := cmID.(float64); ok {
				cmids[r.Id] = int(cmIDFloat)
			}
		}
	}
	return lookup, cmids, nil
}

// loadRelationMapping loads a mapping from a collection's relation field.
func (m *MultiWorkbookExport) loadRelationMapping(collection, relationField string) (map[string]string, error) {
	records, err := m.App.FindRecordsByFilter(collection, "", "", 0, 0)
	if err != nil {
		return nil, err
	}

	mapping := make(map[string]string)
	for _, r := range records {
		relatedID := safeString(r.Get(relationField))
		mapping[r.Id] = relatedID
	}
	return mapping, nil
}

// getCMIDFromRecord gets the CM ID for a record in a collection.
func (m *MultiWorkbookExport) getCMIDFromRecord(collection, pbID string) int {
	record, err := m.App.FindRecordById(collection, pbID)
	if err != nil {
		return 0
	}
	if cmID := record.Get("cm_id"); cmID != nil {
		if cmIDFloat, ok := cmID.(float64); ok {
			return int(cmIDFloat)
		}
	}
	return 0
}

// loadSimpleLookup loads a simple name lookup from a collection.
func (m *MultiWorkbookExport) loadSimpleLookup(collection, field, filter string) (map[string]string, error) {
	records, err := m.App.FindRecordsByFilter(collection, filter, "", 0, 0)
	if err != nil {
		return nil, err
	}

	lookup := make(map[string]string)
	for _, r := range records {
		lookup[r.Id] = safeString(r.Get(field))
	}
	return lookup, nil
}
