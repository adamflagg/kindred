// Package sync provides synchronization services between CampMinder and PocketBase
package sync

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/camp/kindred/pocketbase/campminder"
	"github.com/pocketbase/pocketbase/core"
)

// RelationConfig defines configuration for populating a relation field
type RelationConfig struct {
	FieldName  string // The field name in the record (e.g., "person", "session")
	Collection string // The collection to search (e.g., "persons", "camp_sessions")
	CMID       int    // The CampMinder ID to look up
	Required   bool   // Whether to return error if relation not found
}

// Standard page sizes for sync operations
const (
	// SmallPageSize is for API endpoints with known limitations (e.g., bunk plans)
	SmallPageSize = 10
	// DefaultPageSize is a reasonable default for most sync operations
	DefaultPageSize = 100
	// LargePageSize is for high-volume sync operations that can handle larger batches
	LargePageSize = 500
)

// BaseSyncService provides common functionality for all sync services
type BaseSyncService struct {
	App            core.App
	Client         *campminder.Client
	Stats          Stats
	SyncSuccessful bool            // Track if the main sync operation succeeded
	ProcessedKeys  map[string]bool // Track processed composite keys for orphan detection
}

// NewBaseSyncService creates a new base sync service
func NewBaseSyncService(app core.App, client *campminder.Client) BaseSyncService {
	return BaseSyncService{
		App:            app,
		Client:         client,
		Stats:          Stats{},
		SyncSuccessful: false,
		ProcessedKeys:  make(map[string]bool),
	}
}

// LogSyncStart logs the start of a sync with the season
func (b *BaseSyncService) LogSyncStart(serviceName string) {
	slog.Info("Starting sync", "service", serviceName, "season", b.Client.GetSeasonID())
}

// LogSyncComplete logs the completion of a sync with standardized format
func (b *BaseSyncService) LogSyncComplete(serviceName string, extraStats ...string) {
	// Build the base stats string
	statsStr := fmt.Sprintf("created=%d, updated=%d, skipped=%d, errors=%d",
		b.Stats.Created, b.Stats.Updated, b.Stats.Skipped, b.Stats.Errors)

	// Add any extra stats
	if len(extraStats) > 0 {
		statsStr = strings.Join(extraStats, ", ") + ", " + statsStr
	}

	slog.Info("Sync complete", "service", serviceName, "stats", statsStr)
}

// LogSyncCompleteWithExpansion logs sync completion for services that expand records
func (b *BaseSyncService) LogSyncCompleteWithExpansion(
	serviceName string,
	fetchedCount int,
	expandedCount int,
	extraStats ...string,
) {
	// Build stats showing both fetched and expanded counts
	statsStr := fmt.Sprintf("fetched=%d templates, expanded=%d assignments, created=%d, updated=%d, skipped=%d, errors=%d",
		fetchedCount, expandedCount, b.Stats.Created, b.Stats.Updated, b.Stats.Skipped, b.Stats.Errors)

	// Add any extra stats
	if len(extraStats) > 0 {
		statsStr = strings.Join(extraStats, ", ") + ", " + statsStr
	}

	// Also update the Expanded stat for JSON output
	b.Stats.Expanded = expandedCount

	slog.Info("Sync complete", "service", serviceName, "stats", statsStr)
}

// GetStats returns the current stats for the sync service
func (b *BaseSyncService) GetStats() Stats {
	return b.Stats
}

// ClearProcessedKeys resets the processed keys tracker
func (b *BaseSyncService) ClearProcessedKeys() {
	for k := range b.ProcessedKeys {
		delete(b.ProcessedKeys, k)
	}
}

// TrackProcessedKey adds a composite key to the processed keys map
func (b *BaseSyncService) TrackProcessedKey(id interface{}, year int) {
	compKey := CompositeKey(id, year)
	b.ProcessedKeys[compKey] = true
}

// TrackProcessedCompositeKey adds a pre-built composite key to the processed keys map
func (b *BaseSyncService) TrackProcessedCompositeKey(compositeKey string, year int) {
	// Append year to make it year-scoped
	yearScopedKey := fmt.Sprintf("%s|%d", compositeKey, year)
	b.ProcessedKeys[yearScopedKey] = true
}

// DeleteOrphans deletes records that exist in PocketBase but weren't processed from CampMinder
// This method now uses the base class ProcessedKeys for tracking
// Parameters:
//   - collection: The PocketBase collection name
//   - getIDFunc: Function to extract the composite key from a record for comparison
//   - entityName: Human-readable name for logging (e.g., "session", "attendee")
//   - filter: Optional filter to restrict which records to check for orphans (e.g., "year = 2025")
func (b *BaseSyncService) DeleteOrphans(
	collection string,
	getIDFunc func(record *core.Record) (string, bool),
	entityName string,
	filter string,
) error {
	// Only delete orphans if the sync was successful
	if !b.SyncSuccessful {
		slog.Info("Skipping orphan deletion due to sync failure", "entity", entityName)
		return nil
	}

	orphanCount := 0
	page := 1
	perPage := DefaultPageSize

	for {
		// Get records from PocketBase
		records, err := b.App.FindRecordsByFilter(
			collection,
			filter,
			"-created",
			perPage,
			(page-1)*perPage,
		)
		if err != nil {
			return fmt.Errorf("loading %ss for orphan check: %w", entityName, err)
		}

		// Check each record
		for _, record := range records {
			idKey, ok := getIDFunc(record)
			if !ok {
				continue
			}

			// Check if this record was processed using base class tracking
			wasProcessed := b.ProcessedKeys[idKey]

			if !wasProcessed {
				// This record exists in PocketBase but not in CampMinder
				orphanCount++

				// Try to get a descriptive name for logging
				name := b.getRecordName(record, entityName)
				slog.Info("Deleting orphaned record", "entity", entityName, "name", name, "id", idKey)

				if err := b.App.Delete(record); err != nil {
					slog.Error("Failed to delete orphaned record", "entity", entityName, "id", idKey, "error", err)
					b.Stats.Errors++
				}
			}
		}

		if len(records) < perPage {
			break
		}
		page++
	}

	if orphanCount > 0 {
		slog.Info("Deleted orphaned records", "entity", entityName, "count", orphanCount)
	} else {
		slog.Info("No orphaned records found", "entity", entityName)
	}

	return nil
}

// PaginateRecords provides a generic way to paginate through PocketBase records
// It automatically adds year filtering for collections that have year fields
func (b *BaseSyncService) PaginateRecords(
	collection string,
	filter string,
	callback func(*core.Record) error,
) error {
	// Collections that have year fields and should be automatically year-filtered
	yearCollections := map[string]bool{
		"persons":          true,
		"camp_sessions":    true,
		"bunks":            true,
		"bunk_plans":       true,
		"bunk_assignments": true,
		"attendees":        true,
	}

	// Auto-add year filter if collection has year field and filter doesn't already have it
	if yearCollections[collection] && !strings.Contains(filter, "year =") {
		year := b.Client.GetSeasonID()
		if filter == "" {
			filter = fmt.Sprintf("year = %d", year)
		} else {
			filter = fmt.Sprintf("(%s) && year = %d", filter, year)
		}
	}

	page := 1
	perPage := LargePageSize

	for {
		records, err := b.App.FindRecordsByFilter(
			collection,
			filter,
			"-created",
			perPage,
			(page-1)*perPage,
		)
		if err != nil {
			return fmt.Errorf("querying %s: %w", collection, err)
		}

		for _, record := range records {
			if err := callback(record); err != nil {
				return err
			}
		}

		if len(records) < perPage {
			break
		}
		page++
	}

	return nil
}

// PreloadRecords provides a generic way to pre-load existing records into a map
// keyExtractor should return the key to use for the map (e.g., CampMinder ID)
func (b *BaseSyncService) PreloadRecords(
	collection string,
	filter string,
	keyExtractor func(*core.Record) (interface{}, bool),
) (map[interface{}]*core.Record, error) {
	existingRecords := make(map[interface{}]*core.Record)

	allRecords, err := b.App.FindRecordsByFilter(collection, filter, "", 0, 0)
	if err != nil {
		slog.Warn("Error loading existing records", "collection", collection, "error", err)
		// Return empty map instead of error to allow fallback to individual checks
		return existingRecords, nil
	}

	// Build map using composite keys (id|year) for year isolation
	for _, record := range allRecords {
		if idPart, ok := keyExtractor(record); ok {
			// Extract year from the record
			yearValue := record.Get("year")
			var year int
			switch v := yearValue.(type) {
			case float64:
				year = int(v)
			case int:
				year = v
			default:
				slog.Warn("Record missing or invalid year field", "collection", collection, "recordId", record.Id)
				continue
			}

			// Use composite key for storage
			compKey := CompositeKey(idPart, year)
			existingRecords[compKey] = record
		}
	}

	slog.Info("Loaded existing records from database", "collection", collection, "count", len(existingRecords))
	return existingRecords, nil
}

// ProcessSimpleRecord handles standard create/update logic for a single record
func (b *BaseSyncService) ProcessSimpleRecord(
	collection string,
	key interface{},
	recordData map[string]interface{},
	existingRecords map[interface{}]*core.Record,
	compareFields []string, // Optional: specific fields to check for updates
) error {
	// Extract year from recordData - required for year isolation
	yearValue, ok := recordData["year"]
	if !ok {
		return fmt.Errorf("recordData missing required 'year' field")
	}

	var year int
	switch v := yearValue.(type) {
	case float64:
		year = int(v)
	case int:
		year = v
	default:
		return fmt.Errorf("'year' field must be numeric, got %T", yearValue)
	}

	// Use composite key for lookup to ensure year isolation
	compKey := CompositeKey(key, year)
	existing := existingRecords[compKey]

	if existing != nil {
		// Check if update is needed
		needsUpdate := false

		if len(compareFields) > 0 {
			// Only compare specified fields
			for _, field := range compareFields {
				if value, exists := recordData[field]; exists {
					if !b.FieldEquals(existing.Get(field), value) {
						needsUpdate = true
						break
					}
				}
			}
		} else {
			// Compare all fields
			for field, value := range recordData {
				if !b.FieldEquals(existing.Get(field), value) {
					needsUpdate = true
					break
				}
			}
		}

		if needsUpdate {
			// Update existing record
			for field, value := range recordData {
				existing.Set(field, value)
			}

			if err := b.App.Save(existing); err != nil {
				return fmt.Errorf("updating record: %w", err)
			}
			b.Stats.Updated++
		} else {
			b.Stats.Skipped++
		}
	} else {
		// Create new record
		col, err := b.App.FindCollectionByNameOrId(collection)
		if err != nil {
			return fmt.Errorf("finding collection %s: %w", collection, err)
		}

		record := core.NewRecord(col)
		for field, value := range recordData {
			record.Set(field, value)
		}

		if err := b.App.Save(record); err != nil {
			return fmt.Errorf("creating record: %w", err)
		}
		b.Stats.Created++
	}

	return nil
}

// ProcessSimpleRecordGlobal handles standard create/update logic for a record that is NOT year-scoped.
// Used for entities like tag definitions and custom field definitions that are global across years.
// Unlike ProcessSimpleRecord, this does NOT require 'year' in recordData.
func (b *BaseSyncService) ProcessSimpleRecordGlobal(
	collection string,
	key interface{},
	recordData map[string]interface{},
	existingRecords map[interface{}]*core.Record,
	compareFields []string, // Optional: specific fields to check for updates
) error {
	// Use key directly - no year component for global entities
	existing := existingRecords[key]

	if existing != nil {
		// Check if update is needed
		needsUpdate := false

		if len(compareFields) > 0 {
			// Only compare specified fields
			for _, field := range compareFields {
				if value, exists := recordData[field]; exists {
					if !b.FieldEquals(existing.Get(field), value) {
						needsUpdate = true
						break
					}
				}
			}
		} else {
			// Compare all fields
			for field, value := range recordData {
				if !b.FieldEquals(existing.Get(field), value) {
					needsUpdate = true
					break
				}
			}
		}

		if needsUpdate {
			// Update existing record
			for field, value := range recordData {
				existing.Set(field, value)
			}

			if err := b.App.Save(existing); err != nil {
				return fmt.Errorf("updating record: %w", err)
			}
			b.Stats.Updated++
		} else {
			b.Stats.Skipped++
		}
	} else {
		// Create new record
		col, err := b.App.FindCollectionByNameOrId(collection)
		if err != nil {
			return fmt.Errorf("finding collection %s: %w", collection, err)
		}

		record := core.NewRecord(col)
		for field, value := range recordData {
			record.Set(field, value)
		}

		if err := b.App.Save(record); err != nil {
			return fmt.Errorf("creating record: %w", err)
		}
		b.Stats.Created++
	}

	return nil
}

// PreloadCompositeRecords pre-loads records with composite keys
// keyBuilder should build a composite key string from a record
func (b *BaseSyncService) PreloadCompositeRecords(
	collection string,
	filter string,
	keyBuilder func(*core.Record) (string, bool),
) (map[string]*core.Record, error) {
	existingRecords := make(map[string]*core.Record)

	allRecords, err := b.App.FindRecordsByFilter(collection, filter, "", 0, 0)
	if err != nil {
		slog.Warn("Error loading existing records", "collection", collection, "error", err)
		// Return empty map to allow fallback
		return existingRecords, nil
	}

	// Build map using composite keys with year appended for isolation
	for _, record := range allRecords {
		if key, ok := keyBuilder(record); ok {
			// Extract year from the record
			yearValue := record.Get("year")
			var year int
			switch v := yearValue.(type) {
			case float64:
				year = int(v)
			case int:
				year = v
			default:
				slog.Warn("Record missing or invalid year field", "collection", collection, "recordId", record.Id)
				continue
			}

			// Append year to the composite key
			yearScopedKey := fmt.Sprintf("%s|%d", key, year)
			existingRecords[yearScopedKey] = record
		}
	}

	slog.Info("Loaded existing records from database", "collection", collection, "count", len(existingRecords))
	return existingRecords, nil
}

// ProcessCompositeRecord handles create/update for records with composite keys
func (b *BaseSyncService) ProcessCompositeRecord(
	collection string,
	compositeKey string,
	recordData map[string]interface{},
	existingRecords map[string]*core.Record,
	skipFields []string, // Fields to skip during comparison (like "year" for idempotency)
) error {
	// Extract year from recordData - required for year isolation
	yearValue, ok := recordData["year"]
	if !ok {
		return fmt.Errorf("recordData missing required 'year' field")
	}

	var year int
	switch v := yearValue.(type) {
	case float64:
		year = int(v)
	case int:
		year = v
	default:
		return fmt.Errorf("'year' field must be numeric, got %T", yearValue)
	}

	// Append year to the composite key for year isolation
	yearScopedKey := fmt.Sprintf("%s|%d", compositeKey, year)
	existing := existingRecords[yearScopedKey]

	if existing != nil {
		// Check if update is needed
		needsUpdate := false

		// Build skip map for efficiency
		skipMap := make(map[string]bool)
		for _, field := range skipFields {
			skipMap[field] = true
		}

		for field, value := range recordData {
			// Skip specified fields
			if skipMap[field] {
				continue
			}

			if !b.FieldEquals(existing.Get(field), value) {
				needsUpdate = true
				break
			}
		}

		if needsUpdate {
			// Update existing record
			for field, value := range recordData {
				existing.Set(field, value)
			}

			if err := b.App.Save(existing); err != nil {
				return fmt.Errorf("updating record: %w", err)
			}
			b.Stats.Updated++
		} else {
			b.Stats.Skipped++
		}
	} else {
		// Create new record
		col, err := b.App.FindCollectionByNameOrId(collection)
		if err != nil {
			return fmt.Errorf("finding collection %s: %w", collection, err)
		}

		record := core.NewRecord(col)
		for field, value := range recordData {
			record.Set(field, value)
		}

		if err := b.App.Save(record); err != nil {
			return fmt.Errorf("creating record: %w", err)
		}
		b.Stats.Created++
	}

	return nil
}

// Helper functions

// getRecordName tries to extract a human-readable name from a record
func (b *BaseSyncService) getRecordName(record *core.Record, entityType string) string {
	// Try common name fields
	if name := record.GetString("name"); name != "" {
		return name
	}
	if firstName := record.GetString("first_name"); firstName != "" {
		lastName := record.GetString("last_name")
		return fmt.Sprintf("%s %s", firstName, lastName)
	}

	// For composite entities like attendees
	if entityType == "attendee" {
		personID := record.GetString("person_cm_id")
		sessionID := record.GetString("session_cm_id")
		if personID != "" && sessionID != "" {
			return fmt.Sprintf("person %s in session %s", personID, sessionID)
		}
	}

	// Fallback to ID
	return fmt.Sprintf("ID: %s", record.Id)
}

// CompositeKey creates a year-scoped key for record lookups
// This ensures year isolation by making the year part of the record's identity
func CompositeKey(id interface{}, year int) string {
	return fmt.Sprintf("%v|%d", id, year)
}

// ForceWALCheckpoint forces a SQLite WAL checkpoint to ensure data is flushed
func (b *BaseSyncService) ForceWALCheckpoint() error {
	// Get the database connection from PocketBase
	db := b.App.DB()
	if db == nil {
		return fmt.Errorf("unable to get database connection")
	}

	// Execute WAL checkpoint
	_, err := db.NewQuery("PRAGMA wal_checkpoint(FULL)").Execute()
	if err != nil {
		return fmt.Errorf("WAL checkpoint failed: %w", err)
	}

	// WAL checkpoint completed successfully
	return nil
}

// FieldEquals compares two field values for equality, handling type conversions and special cases
//
//nolint:gocyclo // complex type comparison logic requires many branches
func (b *BaseSyncService) FieldEquals(existingValue interface{}, newValue interface{}) bool {
	// Handle nil vs empty string equivalence
	if (existingValue == nil && newValue == "") || (existingValue == "" && newValue == nil) {
		return true
	}

	// Handle nil vs 0 equivalence for numeric fields
	if existingValue == nil && newValue == 0 {
		return true
	}
	if existingValue == 0 && newValue == nil {
		return true
	}

	// Handle JSON comparisons - check for both string and types.JSONRaw
	var existingStr, newStr string
	var existingIsJSON, newIsJSON bool

	// Extract string from existing value (could be string or types.JSONRaw)
	switch v := existingValue.(type) {
	case string:
		existingStr = v
		existingIsJSON = strings.HasPrefix(strings.TrimSpace(v), "{") || strings.HasPrefix(strings.TrimSpace(v), "[")
	case []byte:
		existingStr = string(v)
		trimmed := strings.TrimSpace(existingStr)
		existingIsJSON = strings.HasPrefix(trimmed, "{") || strings.HasPrefix(trimmed, "[")
	default:
		// Check if it has a String() method (like types.JSONRaw)
		if stringer, ok := existingValue.(fmt.Stringer); ok {
			existingStr = stringer.String()
			trimmed := strings.TrimSpace(existingStr)
			existingIsJSON = strings.HasPrefix(trimmed, "{") || strings.HasPrefix(trimmed, "[")
		}
	}

	// Extract string from new value
	switch v := newValue.(type) {
	case string:
		newStr = v
		newIsJSON = strings.HasPrefix(strings.TrimSpace(v), "{") || strings.HasPrefix(strings.TrimSpace(v), "[")
	case []byte:
		newStr = string(v)
		newIsJSON = strings.HasPrefix(strings.TrimSpace(newStr), "{") || strings.HasPrefix(strings.TrimSpace(newStr), "[")
	}

	// If both look like JSON, compare them semantically
	if existingIsJSON && newIsJSON {
		var existingJSON, newJSON interface{}
		if err := json.Unmarshal([]byte(existingStr), &existingJSON); err == nil {
			if err := json.Unmarshal([]byte(newStr), &newJSON); err == nil {
				// Both parsed successfully, compare the parsed values
				existingBytes, _ := json.Marshal(existingJSON)
				newBytes, _ := json.Marshal(newJSON)
				return string(existingBytes) == string(newBytes)
			}
		}
	}

	// Handle PocketBase DateTime type vs string comparison
	// Check if existingValue has a String() method (like types.DateTime)
	if stringer, ok := existingValue.(fmt.Stringer); ok {
		existingStr := stringer.String()
		if newStr, ok := newValue.(string); ok {
			// Check if both look like dates
			if strings.Contains(existingStr, "-") && strings.Contains(existingStr, ":") &&
				strings.Contains(newStr, "-") && strings.Contains(newStr, ":") {
				// Normalize both dates
				existingNorm := normalizeDateString(existingStr)
				newNorm := normalizeDateString(newStr)
				return existingNorm == newNorm
			}
		}
	}

	// Handle date comparisons - normalize ISO 8601 dates
	if existingStr, ok := existingValue.(string); ok {
		if newStr, ok := newValue.(string); ok {
			// Check if both strings look like dates (contain - and : chars)
			if strings.Contains(existingStr, "-") && strings.Contains(existingStr, ":") &&
				strings.Contains(newStr, "-") && strings.Contains(newStr, ":") {
				// Normalize dates by removing milliseconds and timezone info
				existingNorm := normalizeDateString(existingStr)
				newNorm := normalizeDateString(newStr)

				return existingNorm == newNorm
			}
			// Regular string comparison
			return existingStr == newStr
		}
	}

	// Handle float64 vs int comparison (common when reading from DB vs setting new values)
	if existingFloat, ok := existingValue.(float64); ok {
		if newInt, ok := newValue.(int); ok {
			return int(existingFloat) == newInt
		}
		if newFloat, ok := newValue.(float64); ok {
			return existingFloat == newFloat
		}
	}

	// Handle int vs float64 comparison
	if existingInt, ok := existingValue.(int); ok {
		if newFloat, ok := newValue.(float64); ok {
			return existingInt == int(newFloat)
		}
		if newInt, ok := newValue.(int); ok {
			return existingInt == newInt
		}
	}

	// Handle boolean comparisons
	if existingBool, ok := existingValue.(bool); ok {
		if newBool, ok := newValue.(bool); ok {
			return existingBool == newBool
		}
	}

	// Handle boolean vs integer comparison (for SQLite BOOLEAN columns)
	// SQLite stores BOOLEAN as integer 0/1
	if existingInt, ok := existingValue.(float64); ok {
		if newBool, ok := newValue.(bool); ok {
			return (existingInt != 0) == newBool
		}
	}
	if existingBool, ok := existingValue.(bool); ok {
		if newInt, ok := newValue.(float64); ok {
			return existingBool == (newInt != 0)
		}
	}

	// Direct comparison for same types
	return existingValue == newValue
}

// normalizeDateString normalizes an ISO 8601 date string for comparison
func normalizeDateString(dateStr string) string {
	// Remove milliseconds (everything after the decimal point but before Z or timezone)
	result := dateStr

	// Handle formats like "2024-01-15T10:00:00.000Z" or "2024-01-15T10:00:00.123456789Z"
	if idx := strings.Index(result, "."); idx != -1 {
		// Find where the fractional seconds end
		endIdx := idx + 1
		for endIdx < len(result) && result[endIdx] >= '0' && result[endIdx] <= '9' {
			endIdx++
		}
		// Remove the fractional seconds
		result = result[:idx] + result[endIdx:]
	}

	// Replace T with space for consistency
	result = strings.Replace(result, "T", " ", 1)

	// Remove Z suffix
	result = strings.TrimSuffix(result, "Z")

	// Remove any timezone offset like +00:00 or -05:00
	if len(result) > 6 {
		lastSix := result[len(result)-6:]
		if (lastSix[0] == '+' || lastSix[0] == '-') && lastSix[3] == ':' {
			result = result[:len(result)-6]
		}
	}

	// Trim any whitespace
	result = strings.TrimSpace(result)

	return result
}

// ParseRateLimitWait extracts the wait time from a rate limit error message
// Example: "Rate limit is exceeded. Try again in 60 seconds."
func (b *BaseSyncService) ParseRateLimitWait(message string) time.Duration {
	// Try to extract number from "Try again in X seconds"
	var seconds int
	pattern := "Rate limit is exceeded. Try again in %d seconds."
	if _, err := fmt.Sscanf(message, pattern, &seconds); err == nil && seconds > 0 {
		// Add 5 second buffer to ensure we're past the limit
		return time.Duration(seconds+5) * time.Second
	}

	// Default to 60 seconds if we can't parse
	return 60 * time.Second
}

// LookupRelation finds a record by CampMinder ID and returns its PocketBase ID
func (b *BaseSyncService) LookupRelation(collection string, cmID int, fieldName string) (string, bool) {
	if cmID == 0 {
		return "", false
	}

	// Start with cm_id filter
	filter := fmt.Sprintf("cm_id = %d", cmID)

	// Add year filter for collections that have year fields to prevent cross-year pollution
	// All major collections that use cm_id also have year fields
	yearCollections := map[string]bool{
		"persons":          true,
		"camp_sessions":    true,
		"bunks":            true,
		"bunk_plans":       true,
		"bunk_assignments": true,
		"attendees":        true,
	}

	if yearCollections[collection] {
		year := b.Client.GetSeasonID()
		filter = fmt.Sprintf("%s && year = %d", filter, year)
	}

	records, err := b.App.FindRecordsByFilter(collection, filter, "", 1, 0)
	if err != nil {
		slog.Error("Error looking up relation", "field", fieldName, "error", err)
		return "", false
	}

	if len(records) == 0 {
		return "", false
	}

	return records[0].Id, true
}

// LookupCMIDByPBID finds a record by PocketBase ID and returns its CampMinder ID
// This is the reverse of LookupRelation - given a PB ID, get the CM ID
func (b *BaseSyncService) LookupCMIDByPBID(collection, pbID string) (int, bool) {
	if pbID == "" {
		return 0, false
	}

	filter := fmt.Sprintf("id = '%s'", pbID)
	records, err := b.App.FindRecordsByFilter(collection, filter, "", 1, 0)
	if err != nil || len(records) == 0 {
		return 0, false
	}

	if cmID, ok := records[0].Get("cm_id").(float64); ok {
		return int(cmID), true
	}
	return 0, false
}

// BuildRecordCMIDMappings builds a mapping of PocketBase IDs to CampMinder IDs for related records
// This is commonly used when building composite keys from existing records that reference other tables
// relations is a map of fieldName -> collection (e.g., {"person": "persons", "session": "camp_sessions"})
func (b *BaseSyncService) BuildRecordCMIDMappings(
	sourceCollection string,
	filter string,
	relations map[string]string,
) (map[string]map[string]int, error) {
	mappings := make(map[string]map[string]int)

	if err := b.PaginateRecords(sourceCollection, filter, func(record *core.Record) error {
		mapping := make(map[string]int)

		for fieldName, relCollection := range relations {
			if relID := record.GetString(fieldName); relID != "" {
				if cmID, ok := b.LookupCMIDByPBID(relCollection, relID); ok {
					mapping[fieldName+"CMID"] = cmID
				}
			}
		}

		mappings[record.Id] = mapping
		return nil
	}); err != nil {
		return nil, fmt.Errorf("building CM ID mappings: %w", err)
	}

	return mappings, nil
}

// PopulateRelations populates multiple relation fields in recordData
func (b *BaseSyncService) PopulateRelations(recordData map[string]interface{}, relations []RelationConfig) error {
	for _, rel := range relations {
		pbID, found := b.LookupRelation(rel.Collection, rel.CMID, rel.FieldName)
		if !found {
			if rel.Required {
				return fmt.Errorf("required %s relation not found for cm_id %d", rel.FieldName, rel.CMID)
			}
			// Optional relation not found, skip it
			continue
		}
		recordData[rel.FieldName] = pbID
	}
	return nil
}

// LoadValidCMIDs loads all CampMinder IDs from a collection for validation
// It automatically applies year filtering for year-scoped collections
func (b *BaseSyncService) LoadValidCMIDs(collection string) (map[int]bool, error) {
	validIDs := make(map[int]bool)

	// Collections that have year fields
	yearCollections := map[string]bool{
		"persons":          true,
		"camp_sessions":    true,
		"bunks":            true,
		"bunk_plans":       true,
		"bunk_assignments": true,
		"attendees":        true,
	}

	// Build filter - will be auto-enhanced by PaginateRecords if needed
	filter := ""
	if yearCollections[collection] {
		// Explicitly add year filter for clarity, though PaginateRecords would add it anyway
		filter = fmt.Sprintf("year = %d", b.Client.GetSeasonID())
	}

	// Load all CM IDs from the collection
	if err := b.PaginateRecords(collection, filter, func(record *core.Record) error {
		if cmID, ok := record.Get("cm_id").(float64); ok && cmID > 0 {
			validIDs[int(cmID)] = true
		}
		return nil
	}); err != nil {
		return nil, fmt.Errorf("loading %s CM IDs: %w", collection, err)
	}

	slog.Info("Loaded valid CM IDs", "collection", collection, "count", len(validIDs), "year", b.Client.GetSeasonID())
	return validIDs, nil
}

// LookupBunkPlan finds a specific bunk plan by plan CM ID, bunk CM ID, and session CM ID
// This is needed because bunk plans can have non-unique CM IDs (one plan applies to multiple bunks)
func (b *BaseSyncService) LookupBunkPlan(planCMID, bunkCMID, sessionCMID int) (string, bool) {
	if planCMID == 0 || bunkCMID == 0 || sessionCMID == 0 {
		return "", false
	}

	// First, get the bunk PocketBase ID
	bunkPBID, found := b.LookupRelation("bunks", bunkCMID, "bunk")
	if !found {
		return "", false
	}

	// Then, get the session PocketBase ID
	sessionPBID, found := b.LookupRelation("camp_sessions", sessionCMID, "session")
	if !found {
		return "", false
	}

	// Now find the specific bunk plan with all three criteria including year
	year := b.Client.GetSeasonID()
	filter := fmt.Sprintf(
		"cm_id = %d && bunk = '%s' && session = '%s' && year = %d",
		planCMID, bunkPBID, sessionPBID, year,
	)
	records, err := b.App.FindRecordsByFilter("bunk_plans", filter, "", 1, 0)
	if err != nil {
		slog.Error("Error looking up bunk plan relation", "error", err)
		return "", false
	}

	if len(records) == 0 {
		return "", false
	}

	return records[0].Id, true
}
