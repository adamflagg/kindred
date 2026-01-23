package sync

import (
	"context"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
)

// GoogleSheetsExportOptions configures export behavior
type GoogleSheetsExportOptions struct {
	IncludeGlobals  bool  // Export global tables (globals-*)
	IncludeYearData bool  // Export year-specific tables ({year}-*)
	Years           []int // Specific years to export (empty = current year)
}

// NewGoogleSheetsExportOptions creates default export options
func NewGoogleSheetsExportOptions() *GoogleSheetsExportOptions {
	return &GoogleSheetsExportOptions{
		IncludeGlobals:  true,
		IncludeYearData: true,
		Years:           []int{},
	}
}

// SyncGlobalsOnly exports only global (non-year-scoped) tables
// This is designed for weekly scheduled exports
func (g *GoogleSheetsExport) SyncGlobalsOnly(ctx context.Context) error {
	slog.Info("Starting Google Sheets globals-only export",
		"spreadsheet_id", g.spreadsheetID,
	)

	// Get global export configs
	configs := GetGlobalExports()
	if len(configs) == 0 {
		slog.Info("No global exports configured")
		return nil
	}

	// Create resolver (no lookups needed for most global tables)
	resolver := NewFieldResolver()

	// Export each global table
	exporter := NewTableExporter(g.sheetsWriter, resolver, g.spreadsheetID, g.year)

	for _, config := range configs {
		slog.Info("Exporting global table", "collection", config.Collection)

		// Query records from PocketBase
		records, err := g.queryCollection(config.Collection, config.Filter, 0)
		if err != nil {
			slog.Error("Failed to query collection",
				"collection", config.Collection,
				"error", err,
			)
			continue
		}

		// Export to sheet
		if err := exporter.Export(ctx, config, records); err != nil {
			slog.Error("Failed to export collection",
				"collection", config.Collection,
				"error", err,
			)
			continue
		}

		g.Stats.Created += len(records)
	}

	slog.Info("Google Sheets globals-only export complete",
		"tables_exported", len(configs),
	)

	return nil
}

// SyncDailyOnly exports only year-specific tables for the current year
// This is designed for daily scheduled exports
func (g *GoogleSheetsExport) SyncDailyOnly(ctx context.Context) error {
	return g.syncYearData(ctx, g.year)
}

// SyncForYears exports year-specific tables for the specified years
// This is for historical/backfill exports
func (g *GoogleSheetsExport) SyncForYears(ctx context.Context, years []int) error {
	slog.Info("Starting Google Sheets historical export",
		"spreadsheet_id", g.spreadsheetID,
		"years", years,
	)

	for _, year := range years {
		if err := g.syncYearData(ctx, year); err != nil {
			slog.Error("Failed to export year data",
				"year", year,
				"error", err,
			)
			// Continue with other years
		}
	}

	return nil
}

// syncYearData exports year-specific tables for a given year
func (g *GoogleSheetsExport) syncYearData(ctx context.Context, year int) error {
	slog.Info("Exporting year-specific data",
		"spreadsheet_id", g.spreadsheetID,
		"year", year,
	)

	// Get year-specific export configs
	configs := GetYearSpecificExports()
	if len(configs) == 0 {
		slog.Info("No year-specific exports configured")
		return nil
	}

	// Create resolver with preloaded lookup data
	resolver := NewFieldResolver()
	if err := g.preloadLookups(resolver, year); err != nil {
		slog.Warn("Failed to preload some lookups", "error", err)
		// Continue anyway
	}

	// Export each table
	exporter := NewTableExporter(g.sheetsWriter, resolver, g.spreadsheetID, year)

	for _, config := range configs {
		slog.Info("Exporting table", "collection", config.Collection, "year", year)

		// Build year filter
		filter := fmt.Sprintf("year = %d", year)
		if config.Filter != "" {
			filter = fmt.Sprintf("%s && %s", filter, config.Filter)
		}

		// Query records
		records, err := g.queryCollection(config.Collection, filter, 0)
		if err != nil {
			slog.Error("Failed to query collection",
				"collection", config.Collection,
				"year", year,
				"error", err,
			)
			continue
		}

		// Export to sheet
		if err := exporter.Export(ctx, config, records); err != nil {
			slog.Error("Failed to export collection",
				"collection", config.Collection,
				"year", year,
				"error", err,
			)
			continue
		}

		g.Stats.Created += len(records)
	}

	slog.Info("Year-specific export complete",
		"year", year,
	)

	return nil
}

// queryCollection queries records from a PocketBase collection
func (g *GoogleSheetsExport) queryCollection(collection, filter string, limit int) ([]map[string]interface{}, error) {
	records, err := g.App.FindRecordsByFilter(
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
		// Get all field values as a map
		data := make(map[string]interface{})
		// Copy common fields
		data["id"] = r.Id
		// Get actual field values using schema iteration
		for _, field := range r.Collection().Fields {
			data[field.GetName()] = r.Get(field.GetName())
		}
		result[i] = data
	}

	return result, nil
}

// preloadLookups preloads lookup data for relations
func (g *GoogleSheetsExport) preloadLookups(resolver *FieldResolver, year int) error {
	// Load sessions
	sessions, err := g.loadSessions()
	if err == nil {
		sessionLookup := make(map[string]string)
		for id, s := range sessions {
			sessionLookup[id] = s.Name
		}
		resolver.SetLookupData("camp_sessions", sessionLookup)
	}

	// Load persons
	persons, err := g.loadPersons()
	if err == nil {
		personLookup := make(map[string]string)
		for id, p := range persons {
			personLookup[id] = fmt.Sprintf("%s %s", p.FirstName, p.LastName)
		}
		resolver.SetLookupData("persons", personLookup)
	}

	// Load person tag definitions (global)
	tagLookup, err := g.loadSimpleLookup("person_tag_defs", "name", "")
	if err == nil {
		resolver.SetLookupData("person_tag_defs", tagLookup)
	}

	// Load bunks
	bunkLookup, err := g.loadSimpleLookup("bunks", "name", "")
	if err == nil {
		resolver.SetLookupData("bunks", bunkLookup)
	}

	// Load staff positions
	positionLookup, err := g.loadSimpleLookup("staff_positions", "name", "")
	if err == nil {
		resolver.SetLookupData("staff_positions", positionLookup)
	}

	// Load financial categories
	categoryLookup, err := g.loadSimpleLookup("financial_categories", "name", "")
	if err == nil {
		resolver.SetLookupData("financial_categories", categoryLookup)
	}

	return nil
}

// loadSimpleLookup loads a simple name lookup from a collection
func (g *GoogleSheetsExport) loadSimpleLookup(collection, field, filter string) (map[string]string, error) {
	records, err := g.App.FindRecordsByFilter(collection, filter, "", 0, 0)
	if err != nil {
		return nil, err
	}

	lookup := make(map[string]string)
	for _, r := range records {
		lookup[r.Id] = safeString(r.Get(field))
	}
	return lookup, nil
}

// GetSheetsExportServiceNames returns the service names for sheet exports
// Used for scheduler registration
func GetSheetsExportServiceNames() []string {
	return []string{
		"google_sheets_export",         // Full export (globals + current year)
		"google_sheets_export_globals", // Globals only (weekly)
		"google_sheets_export_daily",   // Daily year data only
	}
}

// ParseExportYearsParam parses a comma-separated years parameter
func ParseExportYearsParam(param string) ([]int, error) {
	if param == "" {
		return []int{}, nil
	}

	parts := strings.Split(param, ",")
	years := make([]int, 0, len(parts))

	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}

		year, err := strconv.Atoi(p)
		if err != nil {
			return nil, fmt.Errorf("invalid year: %s", p)
		}
		years = append(years, year)
	}

	return years, nil
}

// ValidateExportYears validates the years list for export
func ValidateExportYears(years []int, maxYear int) error {
	const minYear = 2017
	const maxYearsPerRequest = 5

	if len(years) > maxYearsPerRequest {
		return fmt.Errorf("too many years: max %d per request", maxYearsPerRequest)
	}

	for _, year := range years {
		if year < minYear {
			return fmt.Errorf("year %d is too old (minimum: %d)", year, minYear)
		}
		if year > maxYear {
			return fmt.Errorf("year %d is in the future (maximum: %d)", year, maxYear)
		}
	}

	return nil
}
