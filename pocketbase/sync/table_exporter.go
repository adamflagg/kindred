package sync

import (
	"context"
	"fmt"
	"sort"
	"strings"
)

// FieldType defines how a column value should be transformed
type FieldType int

const (
	FieldTypeText FieldType = iota
	FieldTypeNumber
	FieldTypeDate
	FieldTypeJSON
	FieldTypeRelation
	FieldTypeMultiRelation
)

// ColumnConfig defines a single column mapping for export
type ColumnConfig struct {
	Field        string    // PocketBase field name
	Header       string    // Sheet column header
	Type         FieldType // How to transform the value
	RelatedCol   string    // For relations: target collection
	RelatedField string    // For relations: display field (e.g., "name")
}

// ExportConfig defines how a table exports to Google Sheets
type ExportConfig struct {
	Collection string         // PocketBase collection name
	SheetName  string         // Sheet name (supports {year} placeholder)
	IsGlobal   bool           // If true, no year filter
	Filter     string         // Additional PB filter (optional)
	Columns    []ColumnConfig // Column definitions
}

// GetResolvedSheetName replaces {year} placeholder with actual year
func (c *ExportConfig) GetResolvedSheetName(year int) string {
	return strings.ReplaceAll(c.SheetName, "{year}", fmt.Sprintf("%d", year))
}

// FieldResolver handles relation lookups and value transformations
type FieldResolver struct {
	lookupCache map[string]map[string]string // collection → pbID → displayValue
}

// NewFieldResolver creates a new FieldResolver
func NewFieldResolver() *FieldResolver {
	return &FieldResolver{
		lookupCache: make(map[string]map[string]string),
	}
}

// SetLookupData sets the lookup data for a collection
func (r *FieldResolver) SetLookupData(collection string, data map[string]string) {
	r.lookupCache[collection] = data
}

// LookupValue looks up a display value for a relation
func (r *FieldResolver) LookupValue(collection, pbID string) string {
	if collData, ok := r.lookupCache[collection]; ok {
		if val, ok := collData[pbID]; ok {
			return val
		}
	}
	return ""
}

// ResolveValue transforms a raw value based on column configuration
func (r *FieldResolver) ResolveValue(value interface{}, col ColumnConfig) interface{} {
	if value == nil {
		return ""
	}

	switch col.Type {
	case FieldTypeText:
		return safeString(value)

	case FieldTypeNumber:
		if f, ok := value.(float64); ok {
			return int(f)
		}
		return value

	case FieldTypeDate:
		return safeString(value)

	case FieldTypeJSON:
		// For JSON fields, return as-is or stringify
		return safeString(value)

	case FieldTypeRelation:
		// Single relation - lookup the display value
		pbID := safeString(value)
		if pbID == "" {
			return ""
		}
		resolved := r.LookupValue(col.RelatedCol, pbID)
		if resolved != "" {
			return resolved
		}
		return pbID // Fallback to raw ID

	case FieldTypeMultiRelation:
		// Multi-relation - lookup all values and join with comma
		return r.resolveMultiRelation(value, col)

	default:
		return safeString(value)
	}
}

// resolveMultiRelation handles multi-select relation fields
func (r *FieldResolver) resolveMultiRelation(value interface{}, col ColumnConfig) string {
	// Handle nil
	if value == nil {
		return ""
	}

	// Convert to slice of IDs
	var ids []string
	switch v := value.(type) {
	case []interface{}:
		for _, item := range v {
			if s := safeString(item); s != "" {
				ids = append(ids, s)
			}
		}
	case []string:
		ids = v
	default:
		return ""
	}

	if len(ids) == 0 {
		return ""
	}

	// Resolve each ID to its display value
	var values []string
	for _, id := range ids {
		resolved := r.LookupValue(col.RelatedCol, id)
		if resolved != "" {
			values = append(values, resolved)
		}
	}

	// Sort for consistent output
	sort.Strings(values)
	return strings.Join(values, ", ")
}

// BuildDataMatrix converts records to a 2D array for Google Sheets
// First row contains headers, subsequent rows contain data
func BuildDataMatrix(records []map[string]interface{}, columns []ColumnConfig, resolver *FieldResolver) [][]interface{} {
	// Preallocate: 1 header row + data rows
	data := make([][]interface{}, 0, 1+len(records))

	// Build header row
	headers := make([]interface{}, len(columns))
	for i, col := range columns {
		headers[i] = col.Header
	}
	data = append(data, headers)

	// Build data rows
	for _, record := range records {
		row := make([]interface{}, len(columns))
		for i, col := range columns {
			rawValue := record[col.Field]
			row[i] = resolver.ResolveValue(rawValue, col)
		}
		data = append(data, row)
	}

	return data
}

// TableExporter exports PocketBase records to Google Sheets
type TableExporter struct {
	writer        SheetsWriter
	resolver      *FieldResolver
	spreadsheetID string
	year          int
}

// NewTableExporter creates a new TableExporter
func NewTableExporter(writer SheetsWriter, resolver *FieldResolver, spreadsheetID string, year int) *TableExporter {
	return &TableExporter{
		writer:        writer,
		resolver:      resolver,
		spreadsheetID: spreadsheetID,
		year:          year,
	}
}

// Export exports records to a Google Sheet tab
func (e *TableExporter) Export(ctx context.Context, config ExportConfig, records []map[string]interface{}) error {
	// Get the resolved sheet name
	sheetName := config.GetResolvedSheetName(e.year)

	// Ensure the sheet exists
	if err := e.writer.EnsureSheet(ctx, e.spreadsheetID, sheetName); err != nil {
		return fmt.Errorf("ensuring sheet %s: %w", sheetName, err)
	}

	// Build the data matrix
	data := BuildDataMatrix(records, config.Columns, e.resolver)

	// Clear existing data
	if err := e.writer.ClearSheet(ctx, e.spreadsheetID, sheetName); err != nil {
		// Log but continue - might be a new sheet
		_ = err
	}

	// Write the data
	if err := e.writer.WriteToSheet(ctx, e.spreadsheetID, sheetName, data); err != nil {
		return fmt.Errorf("writing to sheet %s: %w", sheetName, err)
	}

	return nil
}

// GetYearSpecificExports returns export configurations for year-scoped tables
func GetYearSpecificExports() []ExportConfig {
	return []ExportConfig{
		{
			Collection: "attendees",
			SheetName:  "{year}-attendees",
			IsGlobal:   false,
			Filter:     "is_active = 1 && status_id = 2",
			Columns: []ColumnConfig{
				{Field: "first_name", Header: "First Name", Type: FieldTypeText},
				{Field: "last_name", Header: "Last Name", Type: FieldTypeText},
				{Field: "grade", Header: "Grade", Type: FieldTypeNumber},
				{Field: "gender", Header: "Gender", Type: FieldTypeText},
				{Field: "session", Header: "Session", Type: FieldTypeRelation, RelatedCol: "camp_sessions", RelatedField: "name"},
				{Field: "enrollment_date", Header: "Enrollment Date", Type: FieldTypeDate},
				{Field: "status", Header: "Status", Type: FieldTypeText},
			},
		},
		{
			Collection: "persons",
			SheetName:  "{year}-persons",
			IsGlobal:   false,
			Columns: []ColumnConfig{
				{Field: "first_name", Header: "First Name", Type: FieldTypeText},
				{Field: "last_name", Header: "Last Name", Type: FieldTypeText},
				{Field: "grade", Header: "Grade", Type: FieldTypeNumber},
				{Field: "gender", Header: "Gender", Type: FieldTypeText},
				{Field: "school", Header: "School", Type: FieldTypeText},
				{Field: "tags", Header: "Tags", Type: FieldTypeMultiRelation, RelatedCol: "person_tag_defs", RelatedField: "name"},
			},
		},
		{
			Collection: "camp_sessions",
			SheetName:  "{year}-sessions",
			IsGlobal:   false,
			Filter:     "session_type = 'main' || session_type = 'embedded'",
			Columns: []ColumnConfig{
				{Field: "name", Header: "Name", Type: FieldTypeText},
				{Field: "session_type", Header: "Type", Type: FieldTypeText},
				{Field: "start_date", Header: "Start Date", Type: FieldTypeDate},
				{Field: "end_date", Header: "End Date", Type: FieldTypeDate},
			},
		},
		{
			Collection: "staff",
			SheetName:  "{year}-staff",
			IsGlobal:   false,
			Columns: []ColumnConfig{
				{Field: "first_name", Header: "First Name", Type: FieldTypeText},
				{Field: "last_name", Header: "Last Name", Type: FieldTypeText},
				{Field: "position", Header: "Position", Type: FieldTypeRelation, RelatedCol: "staff_positions", RelatedField: "name"},
				{Field: "bunks", Header: "Bunks", Type: FieldTypeMultiRelation, RelatedCol: "bunks", RelatedField: "name"},
			},
		},
		{
			Collection: "bunk_assignments",
			SheetName:  "{year}-bunk-assignments",
			IsGlobal:   false,
			Columns: []ColumnConfig{
				{Field: "person", Header: "Person", Type: FieldTypeRelation, RelatedCol: "persons", RelatedField: "display_name"},
				{Field: "bunk", Header: "Bunk", Type: FieldTypeRelation, RelatedCol: "bunks", RelatedField: "name"},
				{Field: "session", Header: "Session", Type: FieldTypeRelation, RelatedCol: "camp_sessions", RelatedField: "name"},
			},
		},
		{
			Collection: "financial_transactions",
			SheetName:  "{year}-financial-transactions",
			IsGlobal:   false,
			Columns: []ColumnConfig{
				{Field: "amount", Header: "Amount", Type: FieldTypeNumber},
				{Field: "date", Header: "Date", Type: FieldTypeDate},
				{Field: "category", Header: "Category", Type: FieldTypeRelation, RelatedCol: "financial_categories", RelatedField: "name"},
				{Field: "description", Header: "Description", Type: FieldTypeText},
			},
		},
	}
}

// GetGlobalExports returns export configurations for global (non-year-scoped) tables
func GetGlobalExports() []ExportConfig {
	return []ExportConfig{
		{
			Collection: "person_tag_defs",
			SheetName:  "globals-tag-definitions",
			IsGlobal:   true,
			Columns: []ColumnConfig{
				{Field: "name", Header: "Name", Type: FieldTypeText},
				{Field: "description", Header: "Description", Type: FieldTypeText},
			},
		},
		{
			Collection: "custom_field_defs",
			SheetName:  "globals-custom-field-definitions",
			IsGlobal:   true,
			Columns: []ColumnConfig{
				{Field: "name", Header: "Name", Type: FieldTypeText},
				{Field: "field_type", Header: "Type", Type: FieldTypeText},
				{Field: "entity_type", Header: "Entity Type", Type: FieldTypeText},
			},
		},
		{
			Collection: "financial_categories",
			SheetName:  "globals-financial-categories",
			IsGlobal:   true,
			Columns: []ColumnConfig{
				{Field: "name", Header: "Name", Type: FieldTypeText},
				{Field: "category_type", Header: "Type", Type: FieldTypeText},
			},
		},
		{
			Collection: "staff_positions",
			SheetName:  "globals-staff-positions",
			IsGlobal:   true,
			Columns: []ColumnConfig{
				{Field: "name", Header: "Name", Type: FieldTypeText},
			},
		},
	}
}
