package sync

import (
	"context"
	"crypto/md5" //nolint:gosec // G501: MD5 used for change detection, not security
	"encoding/csv"
	"encoding/hex"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/camp/kindred/pocketbase/campminder"
	"github.com/pocketbase/pocketbase/core"
)

// calculateContentHash computes MD5 hash of content for change detection
func calculateContentHash(content string) string {
	hash := md5.Sum([]byte(content)) //nolint:gosec // G401: MD5 for change detection
	return hex.EncodeToString(hash[:])
}

// CSV column to field mapping
var csvFieldMap = map[string]string{
	"Share Bunk With":             "bunk_with",
	"Do Not Share Bunk With":      "not_bunk_with",
	"Internal Bunk Notes":         "internal_notes",
	"BunkingNotes Notes":          "bunking_notes",
	"RetParent-Socializewithbest": "socialize_with",
}

// BunkRequestsSync handles syncing bunk requests from CSV to original_bunk_requests table
type BunkRequestsSync struct {
	BaseSyncService
	validPersonIDs map[int]string // Maps CampMinder person ID to PocketBase person ID
}

// NewBunkRequestsSync creates a new sync service
func NewBunkRequestsSync(app core.App, client *campminder.Client) *BunkRequestsSync {
	return &BunkRequestsSync{
		BaseSyncService: NewBaseSyncService(app, client),
		validPersonIDs:  make(map[int]string),
	}
}

// RunSync executes the sync process
func (s *BunkRequestsSync) RunSync(csvPath string, _ int) error {
	// Reset stats for this run
	s.Stats = Stats{}
	s.SyncSuccessful = false

	slog.Info("Starting bunk requests sync from CSV", "path", csvPath)
	s.LogSyncStart("bunk_requests")

	// Check if CSV file exists (fresh deployment may not have one yet)
	if _, err := os.Stat(csvPath); os.IsNotExist(err) {
		slog.Warn("Bunk requests CSV not found, skipping sync", "path", csvPath)
		s.SyncSuccessful = true
		return nil
	}

	// Load valid person IDs
	if err := s.loadValidPersonIDs(); err != nil {
		return fmt.Errorf("loading valid person IDs: %w", err)
	}

	// Open CSV file
	file, err := os.Open(csvPath) //nolint:gosec // G304: path from trusted internal source
	if err != nil {
		return fmt.Errorf("opening CSV file: %w", err)
	}
	defer func() { _ = file.Close() }()

	// Parse CSV
	reader := csv.NewReader(file)
	// Configure reader for flexibility (same as upload endpoint)
	reader.LazyQuotes = true       // Allow improperly quoted fields
	reader.TrimLeadingSpace = true // Trim spaces
	reader.FieldsPerRecord = -1    // Allow variable number of fields

	// Read headers
	headers, err := reader.Read()
	if err != nil {
		return fmt.Errorf("reading CSV headers: %w", err)
	}

	// Trim whitespace from headers
	for i := range headers {
		headers[i] = strings.TrimSpace(headers[i])
	}

	// Create column index map
	columnIndex := make(map[string]int)
	for i, header := range headers {
		columnIndex[header] = i
	}

	// Validate required columns (case-insensitive)
	requiredColumns := []string{"PersonID", "Last Name", "First Name"}
	missingColumns := []string{}

	for _, required := range requiredColumns {
		found := false
		for header := range columnIndex {
			if strings.EqualFold(header, required) {
				found = true
				break
			}
		}
		if !found {
			missingColumns = append(missingColumns, required)
		}
	}

	if len(missingColumns) > 0 {
		return fmt.Errorf("missing required columns: %v (found: %v)", missingColumns, headers)
	}

	// Get current year from config
	currentYear := s.getCurrentYear()

	// Process rows
	rowNumber := 1 // Start at 1 since we already read headers
	for {
		row, err := reader.Read()
		if err != nil {
			if err.Error() == "EOF" {
				break
			}
			return fmt.Errorf("reading row %d: %w", rowNumber+1, err)
		}
		rowNumber++

		// Process row
		if err := s.processRow(row, columnIndex, currentYear); err != nil {
			slog.Error("Error processing row", "row", rowNumber, "error", err)
			s.Stats.Errors++
		}
	}

	// Log summary
	slog.Info("Bunk requests sync complete",
		"created", s.Stats.Created,
		"updated", s.Stats.Updated,
		"deleted", s.Stats.Deleted,
		"skipped", s.Stats.Skipped,
	)

	s.SyncSuccessful = true
	s.LogSyncComplete("bunk_requests")
	return nil
}

// loadValidPersonIDs loads all enrolled person IDs for validation
func (s *BunkRequestsSync) loadValidPersonIDs() error {
	currentYear := s.getCurrentYear()

	// Query enrolled attendees with person relations
	records, err := s.App.FindRecordsByFilter(
		"attendees",
		fmt.Sprintf("year = %d && status = 'enrolled' && person != ''", currentYear),
		"",
		0,
		0,
	)
	if err != nil {
		return fmt.Errorf("querying attendees: %w", err)
	}

	// Build map: CampMinder person ID -> PocketBase person ID
	s.validPersonIDs = make(map[int]string)
	for _, record := range records {
		personCMID, _ := record.Get("person_id").(float64)
		personPBID := record.GetString("person")
		if personCMID > 0 && personPBID != "" {
			s.validPersonIDs[int(personCMID)] = personPBID
		}
	}

	slog.Info("Loaded enrolled persons", "count", len(s.validPersonIDs), "year", currentYear)
	return nil
}

// processRow processes a single CSV row
func (s *BunkRequestsSync) processRow(row []string, columnIndex map[string]int, year int) error {
	// Extract PersonID
	personIDStr := s.getColumn(row, columnIndex, "PersonID")
	if personIDStr == "" {
		return fmt.Errorf("missing PersonID")
	}

	personID, err := strconv.Atoi(personIDStr)
	if err != nil {
		return fmt.Errorf("invalid PersonID: %s", personIDStr)
	}

	// Validate person is enrolled and get their PocketBase ID
	personPBID, enrolled := s.validPersonIDs[personID]
	if !enrolled {
		// Skip silently - person not enrolled in current year
		s.Stats.Skipped++
		return nil
	}

	// Process each CSV field that maps to our field options
	for csvColumn, fieldName := range csvFieldMap {
		content := s.getColumn(row, columnIndex, csvColumn)

		// Check if record exists for this person/year/field combination
		existingRecords, err := s.App.FindRecordsByFilter(
			"original_bunk_requests",
			fmt.Sprintf("requester = '%s' && year = %d && field = '%s'", personPBID, year, fieldName),
			"",
			1,
			0,
		)

		if err != nil {
			return fmt.Errorf("querying existing record for person %d field %s: %w", personID, fieldName, err)
		}

		// Handle empty fields - delete existing record if present
		if strings.TrimSpace(content) == "" {
			if len(existingRecords) > 0 {
				// Delete the existing record since CSV field is now empty
				if err := s.App.Delete(existingRecords[0]); err != nil {
					return fmt.Errorf("deleting record for person %d field %s: %w", personID, fieldName, err)
				}

				s.Stats.Deleted++
			}
			continue
		}

		// Calculate hash for the new content
		newHash := calculateContentHash(content)

		if len(existingRecords) > 0 {
			// Update existing record if content hash changed
			existing := existingRecords[0]
			existingHash := existing.GetString("content_hash")

			// Use hash comparison for change detection (more reliable than content comparison)
			if existingHash != newHash {
				existing.Set("content", content)
				existing.Set("content_hash", newHash)
				// Clear processed timestamp so Python processor knows to reprocess
				existing.Set("processed", "")

				if err := s.App.Save(existing); err != nil {
					return fmt.Errorf("updating record for person %d field %s: %w", personID, fieldName, err)
				}

				s.Stats.Updated++
			} else {
				s.Stats.Skipped++
			}
		} else {
			// Create new record
			collection, err := s.App.FindCollectionByNameOrId("original_bunk_requests")
			if err != nil {
				return fmt.Errorf("finding collection: %w", err)
			}

			record := core.NewRecord(collection)
			record.Set("requester", personPBID)
			record.Set("year", year)
			record.Set("field", fieldName)
			record.Set("content", content)
			record.Set("content_hash", newHash)
			// Created and updated fields will be automatically set by PocketBase

			if err := s.App.Save(record); err != nil {
				return fmt.Errorf("creating record for person %d field %s: %w", personID, fieldName, err)
			}

			s.Stats.Created++
		}
	}

	return nil
}

// getColumn safely retrieves a column value by name
func (s *BunkRequestsSync) getColumn(row []string, columnIndex map[string]int, columnName string) string {
	// Try exact match first
	if idx, ok := columnIndex[columnName]; ok && idx < len(row) {
		return strings.TrimSpace(row[idx])
	}

	// Try case-insensitive match
	for col, idx := range columnIndex {
		if strings.EqualFold(col, columnName) && idx < len(row) {
			return strings.TrimSpace(row[idx])
		}
	}

	return ""
}

// getCurrentYear returns the current camp year from config
func (s *BunkRequestsSync) getCurrentYear() int {
	return s.Client.GetSeasonID()
}

// GetStats returns sync statistics
func (s *BunkRequestsSync) GetStats() Stats {
	return s.Stats
}

// WasSuccessful returns whether the sync completed successfully
func (s *BunkRequestsSync) WasSuccessful() bool {
	return s.SyncSuccessful
}

// Name returns the service name
func (s *BunkRequestsSync) Name() string {
	return "bunk_requests"
}

// Sync implements the Service interface - calls RunSync with year-prefixed CSV path
func (s *BunkRequestsSync) Sync(_ context.Context) error {
	// Get current year from config
	currentYear := s.getCurrentYear()

	// Use year-prefixed CSV file from pb_data directory
	csvFilename := fmt.Sprintf("%d_latest.csv", currentYear)
	csvPath := filepath.Join(s.App.DataDir(), "bunk_requests", csvFilename)
	return s.RunSync(csvPath, 0)
}
