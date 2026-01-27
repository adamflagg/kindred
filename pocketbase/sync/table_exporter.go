package sync

import (
	"context"
	"fmt"
	"sort"
	"strings"
)

// FieldType defines how a column value should be transformed
type FieldType int

// Field type constants for column configuration
const (
	FieldTypeText FieldType = iota
	FieldTypeNumber
	FieldTypeDate
	FieldTypeJSON
	FieldTypeRelation
	FieldTypeMultiRelation
	FieldTypeMultiSelect // For multi-select fields (not relations) - joins values with comma
	FieldTypeBool        // Boolean field (exports as true/false)
	// New types for FK resolution
	FieldTypeForeignKeyID    // Resolve relation to cm_id (not display name)
	FieldTypeNestedField     // Resolve relation to specific nested property (e.g., person → first_name)
	FieldTypeWriteInOverride // Check write_in field first, fallback to standard field
	FieldTypeDoubleFKResolve // Resolve through two relations (position → program_area → name)
	FieldTypeCMIDLookup      // Lookup by CM ID rather than PB ID (for self-references like parent_id)
)

// Boolean string constants for export
const (
	boolTrueStr  = "true"
	boolFalseStr = "false"
)

// ColumnConfig defines a single column mapping for export
type ColumnConfig struct {
	Field        string    // PocketBase field name
	Header       string    // Sheet column header
	Type         FieldType // How to transform the value
	RelatedCol   string    // For relations: target collection
	RelatedField string    // For relations: display field (e.g., "name")

	// Extended fields for advanced resolution
	NestedField      string // For FieldTypeNestedField: specific field to extract (e.g., "first_name")
	WriteInField     string // For FieldTypeWriteInOverride: override field name
	IntermediateCol  string // For FieldTypeDoubleFKResolve: second lookup collection
	IntermediateLink string // For FieldTypeDoubleFKResolve: field linking to intermediate collection
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
	lookupCache      map[string]map[string]string // collection → pbID → displayValue
	cmidLookupCache  map[string]map[string]int    // collection → pbID → cmID
	nestedFieldCache map[string]map[string]string // "collection.field" → pbID → fieldValue
	doubleFKCache    map[string]map[string]string // "collection.link" → pbID → intermediateID
	cmidIndexedCache map[string]map[int]string    // collection → cmID → displayValue
}

// NewFieldResolver creates a new FieldResolver
func NewFieldResolver() *FieldResolver {
	return &FieldResolver{
		lookupCache:      make(map[string]map[string]string),
		cmidLookupCache:  make(map[string]map[string]int),
		nestedFieldCache: make(map[string]map[string]string),
		doubleFKCache:    make(map[string]map[string]string),
		cmidIndexedCache: make(map[string]map[int]string),
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

// SetCMIDLookupData sets CM ID lookup data (pbID → cmID)
func (r *FieldResolver) SetCMIDLookupData(collection string, data map[string]int) {
	r.cmidLookupCache[collection] = data
}

// SetNestedFieldLookupData sets nested field lookup data
func (r *FieldResolver) SetNestedFieldLookupData(collection, field string, data map[string]string) {
	key := collection + "." + field
	r.nestedFieldCache[key] = data
}

// SetDoubleFKLookupData sets double FK lookup data (first hop: pbID → intermediate pbID)
func (r *FieldResolver) SetDoubleFKLookupData(collection, linkField string, data map[string]string) {
	key := collection + "." + linkField
	r.doubleFKCache[key] = data
}

// SetCMIDIndexedLookup sets lookup data indexed by CM ID (for self-references)
func (r *FieldResolver) SetCMIDIndexedLookup(collection string, data map[int]string) {
	r.cmidIndexedCache[collection] = data
}

// ResolveWriteInOverride resolves write-in override fields
// Returns write_in value if non-empty, otherwise standard field value
func (r *FieldResolver) ResolveWriteInOverride(record map[string]interface{}, col *ColumnConfig) string {
	// Check write-in field first
	writeIn := safeString(record[col.WriteInField])
	if writeIn != "" {
		return writeIn
	}
	// Fall back to standard field
	return safeString(record[col.Field])
}

// LookupCMID looks up a CM ID for a PB ID
func (r *FieldResolver) LookupCMID(collection, pbID string) (int, bool) {
	if collData, ok := r.cmidLookupCache[collection]; ok {
		if val, ok := collData[pbID]; ok {
			return val, true
		}
	}
	return 0, false
}

// LookupNestedField looks up a nested field value
func (r *FieldResolver) LookupNestedField(collection, field, pbID string) string {
	key := collection + "." + field
	if collData, ok := r.nestedFieldCache[key]; ok {
		if val, ok := collData[pbID]; ok {
			return val
		}
	}
	return ""
}

// LookupDoubleFKIntermediate looks up the intermediate ID for double FK resolution
func (r *FieldResolver) LookupDoubleFKIntermediate(collection, linkField, pbID string) string {
	key := collection + "." + linkField
	if collData, ok := r.doubleFKCache[key]; ok {
		if val, ok := collData[pbID]; ok {
			return val
		}
	}
	return ""
}

// LookupByCMID looks up display value by CM ID
func (r *FieldResolver) LookupByCMID(collection string, cmID int) string {
	if collData, ok := r.cmidIndexedCache[collection]; ok {
		if val, ok := collData[cmID]; ok {
			return val
		}
	}
	return ""
}

// ResolveValue transforms a raw value based on column configuration
func (r *FieldResolver) ResolveValue(value interface{}, col *ColumnConfig) interface{} {
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

	case FieldTypeMultiSelect:
		// Multi-select (not a relation) - join string values with comma
		return r.resolveMultiSelect(value)

	case FieldTypeBool:
		// Boolean field - export as true/false
		if b, ok := value.(bool); ok {
			if b {
				return boolTrueStr
			}
			return boolFalseStr
		}
		return ""

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
		return r.resolveMultiRelation(value, col) // col is already *ColumnConfig

	case FieldTypeForeignKeyID:
		// Resolve relation to CM ID (not display name)
		pbID := safeString(value)
		if pbID == "" {
			return ""
		}
		if cmID, ok := r.LookupCMID(col.RelatedCol, pbID); ok {
			return cmID
		}
		return "" // Unknown ID returns empty

	case FieldTypeNestedField:
		// Resolve relation to specific nested property
		pbID := safeString(value)
		if pbID == "" {
			return ""
		}
		return r.LookupNestedField(col.RelatedCol, col.NestedField, pbID)

	case FieldTypeDoubleFKResolve:
		// Resolve through two relations (e.g., position → program_area → name)
		pbID := safeString(value)
		if pbID == "" {
			return ""
		}
		// First hop: get intermediate ID
		intermediateID := r.LookupDoubleFKIntermediate(col.RelatedCol, col.IntermediateLink, pbID)
		if intermediateID == "" {
			return ""
		}
		// Second hop: get display value from intermediate collection
		return r.LookupValue(col.IntermediateCol, intermediateID)

	case FieldTypeCMIDLookup:
		// Lookup by CM ID rather than PB ID (for self-references like parent_id)
		var cmID int
		switch v := value.(type) {
		case float64:
			cmID = int(v)
		case int:
			cmID = v
		case int64:
			cmID = int(v)
		default:
			return ""
		}
		if cmID == 0 {
			return ""
		}
		return r.LookupByCMID(col.RelatedCol, cmID)

	default:
		return safeString(value)
	}
}

// resolveMultiRelation handles multi-select relation fields
func (r *FieldResolver) resolveMultiRelation(value interface{}, col *ColumnConfig) string {
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

// resolveMultiSelect handles multi-select fields (non-relation) by joining values
func (r *FieldResolver) resolveMultiSelect(value interface{}) string {
	if value == nil {
		return ""
	}

	var values []string
	switch v := value.(type) {
	case []interface{}:
		for _, item := range v {
			if s := safeString(item); s != "" {
				values = append(values, s)
			}
		}
	case []string:
		values = v
	default:
		return ""
	}

	if len(values) == 0 {
		return ""
	}

	sort.Strings(values)
	return strings.Join(values, ", ")
}

// BuildDataMatrix converts records to a 2D array for Google Sheets
// First row contains headers, subsequent rows contain data
func BuildDataMatrix(
	records []map[string]interface{},
	columns []ColumnConfig,
	resolver *FieldResolver,
) [][]interface{} {
	// Preallocate: 1 header row + data rows
	data := make([][]interface{}, 0, 1+len(records))

	// Build header row (use index to avoid copying 136-byte struct)
	headers := make([]interface{}, len(columns))
	for i := range columns {
		headers[i] = columns[i].Header
	}
	data = append(data, headers)

	// Build data rows (use index to avoid copying 136-byte struct)
	for _, record := range records {
		row := make([]interface{}, len(columns))
		for i := range columns {
			col := &columns[i]
			// WriteInOverride needs access to full record
			if col.Type == FieldTypeWriteInOverride {
				row[i] = resolver.ResolveWriteInOverride(record, col)
			} else {
				rawValue := record[col.Field]
				row[i] = resolver.ResolveValue(rawValue, col)
			}
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
func (e *TableExporter) Export(ctx context.Context, config *ExportConfig, records []map[string]interface{}) error {
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
		// Attendees - links persons to sessions with enrollment status
		{
			Collection: "attendees",
			SheetName:  "{year}-attendee",
			IsGlobal:   false,
			Columns: []ColumnConfig{
				{Field: "person_id", Header: "Person ID", Type: FieldTypeNumber},
				{
					Field: "person", Header: "First Name", Type: FieldTypeNestedField,
					RelatedCol: "persons", NestedField: "first_name",
				},
				{
					Field: "person", Header: "Last Name", Type: FieldTypeNestedField,
					RelatedCol: "persons", NestedField: "last_name",
				},
				{
					Field: "session", Header: "Session ID", Type: FieldTypeForeignKeyID,
					RelatedCol: "camp_sessions",
				},
				{
					Field: "session", Header: "Session", Type: FieldTypeRelation,
					RelatedCol: "camp_sessions", RelatedField: "name",
				},
				{Field: "enrollment_date", Header: "Enrollment Date", Type: FieldTypeDate},
				{Field: "status", Header: "Status", Type: FieldTypeText},
			},
		},
		// Persons - demographic info, contact details, tags
		{
			Collection: "persons",
			SheetName:  "{year}-person",
			IsGlobal:   false,
			Columns: []ColumnConfig{
				{Field: "cm_id", Header: "Person ID", Type: FieldTypeNumber},
				{Field: "first_name", Header: "First Name", Type: FieldTypeText},
				{Field: "last_name", Header: "Last Name", Type: FieldTypeText},
				{Field: "preferred_name", Header: "Preferred Name", Type: FieldTypeText},
				{Field: "birthdate", Header: "Birthdate", Type: FieldTypeText},
				{Field: "age", Header: "Age", Type: FieldTypeNumber},
				{Field: "grade", Header: "Grade", Type: FieldTypeNumber},
				{Field: "gender", Header: "Gender", Type: FieldTypeText},
				{
					Field: "gender_identity_name", Header: "Gender Identity",
					Type: FieldTypeWriteInOverride, WriteInField: "gender_identity_write_in",
				},
				{
					Field: "gender_pronoun_name", Header: "Gender Pronoun",
					Type: FieldTypeWriteInOverride, WriteInField: "gender_pronoun_write_in",
				},
				{Field: "school", Header: "School", Type: FieldTypeText},
				{Field: "years_at_camp", Header: "Years at Camp", Type: FieldTypeNumber},
				{Field: "last_year_attended", Header: "Last Year Attended", Type: FieldTypeNumber},
				{Field: "division", Header: "Division ID", Type: FieldTypeForeignKeyID, RelatedCol: "divisions"},
				{Field: "division", Header: "Division", Type: FieldTypeRelation, RelatedCol: "divisions", RelatedField: "name"},
				{Field: "household_id", Header: "Household ID", Type: FieldTypeNumber},
				{Field: "lead_date", Header: "Lead Date", Type: FieldTypeText},
				{Field: "is_camper", Header: "Is Camper", Type: FieldTypeBool},
				{Field: "tshirt_size", Header: "T-Shirt Size", Type: FieldTypeText},
				{Field: "tags", Header: "Tags", Type: FieldTypeMultiRelation, RelatedCol: "person_tag_defs", RelatedField: "name"},
			},
		},
		// Sessions - session definitions
		{
			Collection: "camp_sessions",
			SheetName:  "{year}-session",
			IsGlobal:   false,
			Columns: []ColumnConfig{
				{Field: "cm_id", Header: "Session ID", Type: FieldTypeNumber},
				{Field: "name", Header: "Name", Type: FieldTypeText},
				{Field: "description", Header: "Description", Type: FieldTypeText},
				{Field: "session_type", Header: "Type", Type: FieldTypeText},
				{Field: "start_date", Header: "Start Date", Type: FieldTypeDate},
				{Field: "end_date", Header: "End Date", Type: FieldTypeDate},
				{Field: "is_active", Header: "Is Active", Type: FieldTypeBool},
				{Field: "parent_id", Header: "Parent ID", Type: FieldTypeNumber},
				{Field: "parent_id", Header: "Parent Session", Type: FieldTypeCMIDLookup, RelatedCol: "camp_sessions"},
				{Field: "is_day", Header: "Is Day", Type: FieldTypeBool},
				{Field: "is_residential", Header: "Is Residential", Type: FieldTypeBool},
				{Field: "is_for_children", Header: "Is For Children", Type: FieldTypeBool},
				{Field: "is_for_adults", Header: "Is For Adults", Type: FieldTypeBool},
				{Field: "start_grade_id", Header: "Start Grade", Type: FieldTypeNumber},
				{Field: "end_grade_id", Header: "End Grade", Type: FieldTypeNumber},
				{
					Field: "session_group", Header: "Session Group ID",
					Type: FieldTypeForeignKeyID, RelatedCol: "session_groups",
				},
				{
					Field: "session_group", Header: "Session Group", Type: FieldTypeRelation,
					RelatedCol: "session_groups", RelatedField: "name",
				},
			},
		},
		// Staff - staff records with positions, assignments, dates
		{
			Collection: "staff",
			SheetName:  "{year}-staff",
			IsGlobal:   false,
			Columns: []ColumnConfig{
				{
					Field: "person", Header: "Person ID",
					Type: FieldTypeForeignKeyID, RelatedCol: "persons",
				},
				{
					Field: "person", Header: "First Name", Type: FieldTypeNestedField,
					RelatedCol: "persons", NestedField: "first_name",
				},
				{
					Field: "person", Header: "Last Name", Type: FieldTypeNestedField,
					RelatedCol: "persons", NestedField: "last_name",
				},
				{Field: "status", Header: "Status", Type: FieldTypeText},
				{
					Field: "position1", Header: "Position 1", Type: FieldTypeRelation,
					RelatedCol: "staff_positions", RelatedField: "name",
				},
				{
					Field: "position1", Header: "Position 1 Program Area",
					Type: FieldTypeDoubleFKResolve, RelatedCol: "staff_positions",
					IntermediateCol: "staff_program_areas", IntermediateLink: "program_area",
				},
				{
					Field: "position2", Header: "Position 2", Type: FieldTypeRelation,
					RelatedCol: "staff_positions", RelatedField: "name",
				},
				{
					Field: "position2", Header: "Position 2 Program Area",
					Type: FieldTypeDoubleFKResolve, RelatedCol: "staff_positions",
					IntermediateCol: "staff_program_areas", IntermediateLink: "program_area",
				},
				{
					Field: "organizational_category", Header: "Org Category",
					Type: FieldTypeRelation, RelatedCol: "staff_org_categories", RelatedField: "name",
				},
				{Field: "division", Header: "Division ID", Type: FieldTypeForeignKeyID, RelatedCol: "divisions"},
				{Field: "division", Header: "Division", Type: FieldTypeRelation, RelatedCol: "divisions", RelatedField: "name"},
				{Field: "bunks", Header: "Bunks", Type: FieldTypeMultiRelation, RelatedCol: "bunks", RelatedField: "name"},
				{Field: "bunk_staff", Header: "Bunk Staff", Type: FieldTypeBool},
				{Field: "years", Header: "Years", Type: FieldTypeNumber},
				{Field: "international", Header: "International", Type: FieldTypeText},
				{Field: "salary", Header: "Salary", Type: FieldTypeNumber},
				{Field: "hire_date", Header: "Hire Date", Type: FieldTypeDate},
				{Field: "employment_start_date", Header: "Employment Start", Type: FieldTypeDate},
				{Field: "employment_end_date", Header: "Employment End", Type: FieldTypeDate},
				{Field: "contract_in_date", Header: "Contract In", Type: FieldTypeDate},
				{Field: "contract_out_date", Header: "Contract Out", Type: FieldTypeDate},
				{Field: "contract_due_date", Header: "Contract Due", Type: FieldTypeDate},
			},
		},
		// Bunk Assignments - camper to bunk assignments
		{
			Collection: "bunk_assignments",
			SheetName:  "{year}-bunk-assign",
			IsGlobal:   false,
			Columns: []ColumnConfig{
				{Field: "cm_id", Header: "Assignment ID", Type: FieldTypeNumber},
				{Field: "person", Header: "Person ID", Type: FieldTypeForeignKeyID, RelatedCol: "persons"},
				{Field: "person", Header: "Person", Type: FieldTypeRelation, RelatedCol: "persons", RelatedField: "name"},
				{Field: "session", Header: "Session ID", Type: FieldTypeForeignKeyID, RelatedCol: "camp_sessions"},
				{Field: "session", Header: "Session", Type: FieldTypeRelation, RelatedCol: "camp_sessions", RelatedField: "name"},
				{Field: "bunk", Header: "Bunk ID", Type: FieldTypeForeignKeyID, RelatedCol: "bunks"},
				{Field: "bunk", Header: "Bunk", Type: FieldTypeRelation, RelatedCol: "bunks", RelatedField: "name"},
				{Field: "is_deleted", Header: "Is Deleted", Type: FieldTypeBool},
			},
		},
		// Financial Transactions - comprehensive export
		{
			Collection: "financial_transactions",
			SheetName:  "{year}-transactions",
			IsGlobal:   false,
			Columns: []ColumnConfig{
				// Identity
				{Field: "cm_id", Header: "Transaction ID", Type: FieldTypeNumber},
				{Field: "transaction_number", Header: "Transaction Number", Type: FieldTypeNumber},
				// Dates
				{Field: "post_date", Header: "Post Date", Type: FieldTypeDate},
				{Field: "effective_date", Header: "Effective Date", Type: FieldTypeDate},
				{Field: "service_start_date", Header: "Service Start", Type: FieldTypeDate},
				{Field: "service_end_date", Header: "Service End", Type: FieldTypeDate},
				// Reversal
				{Field: "is_reversed", Header: "Is Reversed", Type: FieldTypeBool},
				{Field: "reversal_date", Header: "Reversal Date", Type: FieldTypeDate},
				// Category (FK ID + name)
				{
					Field: "financial_category", Header: "Category ID",
					Type: FieldTypeForeignKeyID, RelatedCol: "financial_categories",
				},
				{
					Field: "financial_category", Header: "Category", Type: FieldTypeRelation,
					RelatedCol: "financial_categories", RelatedField: "name",
				},
				// Description & notes
				{Field: "description", Header: "Description", Type: FieldTypeText},
				{Field: "transaction_note", Header: "Transaction Note", Type: FieldTypeText},
				{Field: "gl_account_note", Header: "GL Account Note", Type: FieldTypeText},
				// Amounts
				{Field: "quantity", Header: "Quantity", Type: FieldTypeNumber},
				{Field: "unit_amount", Header: "Unit Amount", Type: FieldTypeNumber},
				{Field: "amount", Header: "Amount", Type: FieldTypeNumber},
				// GL accounts
				{Field: "recognition_gl_account_id", Header: "Recognition GL Account", Type: FieldTypeText},
				{Field: "deferral_gl_account_id", Header: "Deferral GL Account", Type: FieldTypeText},
				// Payment method (FK ID + name)
				{
					Field: "payment_method", Header: "Payment Method ID",
					Type: FieldTypeForeignKeyID, RelatedCol: "payment_methods",
				},
				{
					Field: "payment_method", Header: "Payment Method", Type: FieldTypeRelation,
					RelatedCol: "payment_methods", RelatedField: "name",
				},
				// Session (FK ID + name)
				{
					Field: "session", Header: "Session ID",
					Type: FieldTypeForeignKeyID, RelatedCol: "camp_sessions",
				},
				{
					Field: "session", Header: "Session", Type: FieldTypeRelation,
					RelatedCol: "camp_sessions", RelatedField: "name",
				},
				// Session group (FK ID + name)
				{
					Field: "session_group", Header: "Session Group ID",
					Type: FieldTypeForeignKeyID, RelatedCol: "session_groups",
				},
				{
					Field: "session_group", Header: "Session Group", Type: FieldTypeRelation,
					RelatedCol: "session_groups", RelatedField: "name",
				},
				// Division (FK ID + name)
				{
					Field: "division", Header: "Division ID",
					Type: FieldTypeForeignKeyID, RelatedCol: "divisions",
				},
				{
					Field: "division", Header: "Division", Type: FieldTypeRelation,
					RelatedCol: "divisions", RelatedField: "name",
				},
				// Person (FK ID + name)
				{
					Field: "person", Header: "Person ID",
					Type: FieldTypeForeignKeyID, RelatedCol: "persons",
				},
				{
					Field: "person", Header: "Person First Name", Type: FieldTypeNestedField,
					RelatedCol: "persons", NestedField: "first_name",
				},
				{
					Field: "person", Header: "Person Last Name", Type: FieldTypeNestedField,
					RelatedCol: "persons", NestedField: "last_name",
				},
				// Household (FK ID + name)
				{
					Field: "household", Header: "Household ID",
					Type: FieldTypeForeignKeyID, RelatedCol: "households",
				},
				{
					Field: "household", Header: "Household", Type: FieldTypeRelation,
					RelatedCol: "households", RelatedField: "mailing_title",
				},
			},
		},
		// Bunks - cabin definitions
		{
			Collection: "bunks",
			SheetName:  "{year}-bunk",
			IsGlobal:   false,
			Columns: []ColumnConfig{
				{Field: "cm_id", Header: "Bunk ID", Type: FieldTypeNumber},
				{Field: "name", Header: "Name", Type: FieldTypeText},
				{Field: "gender", Header: "Gender", Type: FieldTypeText},
				{Field: "is_active", Header: "Is Active", Type: FieldTypeBool},
				{Field: "area_id", Header: "Area ID", Type: FieldTypeNumber},
			},
		},
		// Households - family/household info
		{
			Collection: "households",
			SheetName:  "{year}-household",
			IsGlobal:   false,
			Columns: []ColumnConfig{
				{Field: "cm_id", Header: "Household ID", Type: FieldTypeNumber},
				{Field: "mailing_title", Header: "Mailing Title", Type: FieldTypeText},
			},
		},
		// Session Groups - session groupings
		{
			Collection: "session_groups",
			SheetName:  "{year}-sess-group",
			IsGlobal:   false,
			Columns: []ColumnConfig{
				{Field: "cm_id", Header: "Session Group ID", Type: FieldTypeNumber},
				{Field: "name", Header: "Name", Type: FieldTypeText},
				{Field: "description", Header: "Description", Type: FieldTypeText},
				{Field: "is_active", Header: "Is Active", Type: FieldTypeBool},
			},
		},
		// Person Custom Values - custom field values for persons
		{
			Collection: "person_custom_values",
			SheetName:  "{year}-person-cv",
			IsGlobal:   false,
			Columns: []ColumnConfig{
				{
					Field: "person", Header: "Person First Name", Type: FieldTypeNestedField,
					RelatedCol: "persons", NestedField: "first_name",
				},
				{
					Field: "person", Header: "Person Last Name", Type: FieldTypeNestedField,
					RelatedCol: "persons", NestedField: "last_name",
				},
				{
					Field: "person", Header: "Person ID",
					Type: FieldTypeForeignKeyID, RelatedCol: "persons",
				},
				{
					Field: "field_definition", Header: "Field Name", Type: FieldTypeRelation,
					RelatedCol: "custom_field_defs", RelatedField: "name",
				},
				{
					Field: "field_definition", Header: "Field ID",
					Type: FieldTypeForeignKeyID, RelatedCol: "custom_field_defs",
				},
				{Field: "value", Header: "Value", Type: FieldTypeText},
			},
		},
		// Household Custom Values - custom field values for households
		{
			Collection: "household_custom_values",
			SheetName:  "{year}-household-cv",
			IsGlobal:   false,
			Columns: []ColumnConfig{
				{
					Field: "household", Header: "Household", Type: FieldTypeRelation,
					RelatedCol: "households", RelatedField: "mailing_title",
				},
				{
					Field: "household", Header: "Household ID",
					Type: FieldTypeForeignKeyID, RelatedCol: "households",
				},
				{
					Field: "field_definition", Header: "Field Name", Type: FieldTypeRelation,
					RelatedCol: "custom_field_defs", RelatedField: "name",
				},
				{
					Field: "field_definition", Header: "Field ID",
					Type: FieldTypeForeignKeyID, RelatedCol: "custom_field_defs",
				},
				{Field: "value", Header: "Value", Type: FieldTypeText},
			},
		},
		// Camper History - denormalized camper data with retention metrics
		{
			Collection: "camper_history",
			SheetName:  "{year}-camper-history",
			IsGlobal:   false,
			Columns: []ColumnConfig{
				{Field: "person_id", Header: "Person ID", Type: FieldTypeNumber},
				{Field: "first_name", Header: "First Name", Type: FieldTypeText},
				{Field: "last_name", Header: "Last Name", Type: FieldTypeText},
				{Field: "year", Header: "Year", Type: FieldTypeNumber},
				{Field: "sessions", Header: "Sessions", Type: FieldTypeText},
				{Field: "bunks", Header: "Bunks", Type: FieldTypeText},
				{Field: "school", Header: "School", Type: FieldTypeText},
				{Field: "city", Header: "City", Type: FieldTypeText},
				{Field: "grade", Header: "Grade", Type: FieldTypeNumber},
				{Field: "is_returning", Header: "Is Returning", Type: FieldTypeBool},
				{Field: "years_at_camp", Header: "Years at Camp", Type: FieldTypeNumber},
				{Field: "prior_year_sessions", Header: "Prior Year Sessions", Type: FieldTypeText},
				{Field: "prior_year_bunks", Header: "Prior Year Bunks", Type: FieldTypeText},
				// New fields (v2) for enhanced retention/registration analysis
				{Field: "household_id", Header: "Household ID", Type: FieldTypeNumber},
				{Field: "gender", Header: "Gender", Type: FieldTypeText},
				{Field: "division_name", Header: "Division", Type: FieldTypeText},
				{Field: "enrollment_date", Header: "Enrollment Date", Type: FieldTypeDate},
				{Field: "status", Header: "Status", Type: FieldTypeText},
				{Field: "synagogue", Header: "Synagogue", Type: FieldTypeText},
			},
		},
	}
}

// GetAllExportSheetNames returns all sheet tab names that will be created for a full export
// This includes both year-specific and global tables
func GetAllExportSheetNames(year int) []string {
	yearSpecific := GetYearSpecificExports()
	globals := GetGlobalExports()
	names := make([]string, 0, len(yearSpecific)+len(globals))

	// Add year-specific sheet names
	for _, config := range yearSpecific {
		names = append(names, config.GetResolvedSheetName(year))
	}

	// Add global sheet names (year parameter ignored for globals)
	for _, config := range globals {
		names = append(names, config.SheetName)
	}

	return names
}

// GetGlobalExports returns export configurations for global (non-year-scoped) tables
// Global tables use "g-" prefix for shorter, more readable tab names
func GetGlobalExports() []ExportConfig {
	return []ExportConfig{
		{
			Collection: "person_tag_defs",
			SheetName:  "g-tag-def",
			IsGlobal:   true,
			Columns: []ColumnConfig{
				{Field: "name", Header: "Tag Name", Type: FieldTypeText},
				{Field: "is_seasonal", Header: "Seasonal", Type: FieldTypeBool},
				{Field: "is_hidden", Header: "Hidden", Type: FieldTypeBool},
			},
		},
		{
			Collection: "custom_field_defs",
			SheetName:  "g-cust-field-def",
			IsGlobal:   true,
			Columns: []ColumnConfig{
				{Field: "cm_id", Header: "Field ID", Type: FieldTypeNumber},
				{Field: "name", Header: "Name", Type: FieldTypeText},
				{Field: "data_type", Header: "Data Type", Type: FieldTypeText},
				{Field: "partition", Header: "Entity Types", Type: FieldTypeMultiSelect},
				{Field: "is_seasonal", Header: "Seasonal", Type: FieldTypeBool},
				{Field: "is_array", Header: "Is Array", Type: FieldTypeBool},
				{Field: "is_active", Header: "Active", Type: FieldTypeBool},
			},
		},
		{
			Collection: "financial_categories",
			SheetName:  "g-fin-cat",
			IsGlobal:   true,
			Columns: []ColumnConfig{
				{Field: "cm_id", Header: "Category ID", Type: FieldTypeNumber},
				{Field: "name", Header: "Name", Type: FieldTypeText},
				{Field: "is_archived", Header: "Archived", Type: FieldTypeBool},
			},
		},
		{
			Collection: "divisions",
			SheetName:  "g-division",
			IsGlobal:   true,
			Columns: []ColumnConfig{
				{Field: "cm_id", Header: "Division ID", Type: FieldTypeNumber},
				{Field: "name", Header: "Name", Type: FieldTypeText},
				{
					Field: "parent_division", Header: "Parent Division ID",
					Type: FieldTypeForeignKeyID, RelatedCol: "divisions",
				},
				{
					Field: "parent_division", Header: "Parent Division", Type: FieldTypeRelation,
					RelatedCol: "divisions", RelatedField: "name",
				},
			},
		},
	}
}
