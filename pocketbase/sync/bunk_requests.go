package sync

import (
	"context"
	"crypto/md5" //nolint:gosec // G501: MD5 used for change detection, not security
	"encoding/csv"
	"encoding/hex"
	"errors"
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
	"Share Bunk With":             "bunk_request_form",
	"Do Not Share Bunk With":      "staff_not_bunk_with",
	"Internal Bunk Notes":         "internal_notes",
	"BunkingNotes Notes":          "bunking_notes",
	"RetParent-Socializewithbest": "socialize_with",
}

// BunkRequestsSync handles syncing bunk requests from CSV to original_bunk_requests table
type BunkRequestsSync struct {
	BaseSyncService
	validPersonIDs map[int]string // Maps CampMinder person ID to PocketBase person ID
	csvPersonIDs   map[int]bool   // Tracks all enrolled person IDs seen in the CSV

	// socializeWithByPerson maps person PB id -> the CampMinder custom field's raw
	// value (cm_id 85803, "Ret Parent-Socialize with best") for the current sync year.
	// kindred#2484: processRow prefers this over the CSV column when the CSV has no
	// value at all; when both are present and disagree, the CSV wins and the
	// disagreement is logged (see processRow for why). A person absent from this map
	// (custom field not yet synced for them) falls back to the CSV column unchanged.
	socializeWithByPerson map[string]string
}

// NewBunkRequestsSync creates a new sync service
func NewBunkRequestsSync(app core.App, client *campminder.Client) *BunkRequestsSync {
	return &BunkRequestsSync{
		BaseSyncService: NewBaseSyncService(app, client),
		validPersonIDs:  make(map[int]string),
		csvPersonIDs:    make(map[int]bool),
	}
}

// RunSync executes the sync process
func (s *BunkRequestsSync) RunSync(csvPath string, _ int) error {
	// Reset stats for this run
	s.Stats = Stats{}
	s.SyncSuccessful = false
	s.csvPersonIDs = make(map[int]bool)

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

	// kindred#2484: preload the socialize_with custom field values once for this run,
	// rather than per-row -- the field definition and every person's answer for the
	// year are the same for every row processRow will see. A load failure (or the
	// field definition not being synced yet) is not fatal to the CSV sync: it just
	// means every row falls back to sourcing socialize_with from the CSV column, as
	// it did before this issue.
	socializeWithValues, err := loadPersonCustomFieldValuesByCMID(s.App, cmIDSocializeWithBest, currentYear)
	if err != nil {
		slog.Warn("Loading socialize_with custom field values failed, sourcing socialize_with from CSV only",
			"error", err)
		socializeWithValues = map[string]string{}
	}
	s.socializeWithByPerson = socializeWithValues

	// Process rows
	rowNumber := 1 // Start at 1 since we already read headers
	for {
		row, readErr := reader.Read()
		if readErr != nil {
			if readErr.Error() == "EOF" {
				break
			}
			return fmt.Errorf("reading row %d: %w", rowNumber+1, readErr)
		}
		rowNumber++

		// Process row
		if rowErr := s.processRow(row, columnIndex, currentYear); rowErr != nil {
			if errors.Is(rowErr, errRejectedRecord) {
				slog.Warn("Rejected bunk request row", "row", rowNumber, "error", rowErr)
				s.Stats.Rejected++
			} else {
				slog.Error("Error processing row", "row", rowNumber, "error", rowErr)
				s.Stats.Errors++
			}
		}
	}

	// Log summary
	slog.Info("Bunk requests sync complete",
		"created", s.Stats.Created,
		"updated", s.Stats.Updated,
		"deleted", s.Stats.Deleted,
		"skipped", s.Stats.Skipped,
	)

	// Purge OBRs and BRs for persons no longer in the CSV (cancelled/unenrolled)
	obrPersonIDs, err := s.purgeOrphanedRequests(currentYear)
	if err != nil {
		slog.Error("Failed to purge orphaned requests", "error", err)
		// Non-fatal — don't fail the entire sync for cleanup
	}

	// Sweep zombie BRs — requesters whose OBRs were already purged in a prior run
	if obrPersonIDs != nil {
		if err := s.purgeZombieBRs(currentYear, obrPersonIDs); err != nil {
			slog.Error("Failed to purge zombie BRs", "error", err)
		}
	}

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
	// Extract PersonID. A missing or malformed value here is a bad CSV row, not
	// an infrastructure failure -- kindred#2292.
	personIDStr := s.getColumn(row, columnIndex, "PersonID")
	if personIDStr == "" {
		return fmt.Errorf("%w: missing PersonID", errRejectedRecord)
	}

	personID, err := strconv.Atoi(personIDStr)
	if err != nil {
		return fmt.Errorf("%w: invalid PersonID: %s", errRejectedRecord, personIDStr)
	}

	// Validate person is enrolled and get their PocketBase ID
	personPBID, enrolled := s.validPersonIDs[personID]
	if !enrolled {
		// Skip silently - person not enrolled in current year
		s.Stats.Skipped++
		return nil
	}

	// Track this person as present in the CSV
	s.csvPersonIDs[personID] = true

	// Process each CSV field that maps to our field options
	for csvColumn, fieldName := range csvFieldMap {
		content := s.getColumn(row, columnIndex, csvColumn)

		// kindred#2484: socialize_with's source of truth is the CampMinder custom
		// field (cm_id 85803) whenever there is no CSV column to compare it against --
		// the coverage-increase population the issue's own numbers document (1,145
		// custom-field persons vs 1,134 CSV, full overlap). A person absent from the
		// map, or present with an empty value (field synced but genuinely blank),
		// falls back to the CSV content unchanged, same as before.
		//
		// PR #2523 review: when BOTH sources carry a non-empty value and they
		// disagree, the CSV value wins, not the custom field. socialize_with's sole
		// consumer, orchestrator.py's _parse_socialize_preference, exact-matches the
		// value against exactly two literal strings with no AI fallback -- trusting an
		// unverified custom-field value on disagreement risks silently dropping the
		// request out of the social graph. The disagreement is still logged so the two
		// can be diffed in production, per the issue's own build note ("verify the
		// value shape matches before switching... before cutting over").
		if fieldName == "socialize_with" {
			if customValue, ok := s.socializeWithByPerson[personPBID]; ok && customValue != "" {
				switch content {
				case "":
					content = customValue
				case customValue:
					// Agreement -- nothing to do.
				default:
					slog.Warn("socialize_with: CSV and custom field values disagree, keeping CSV value",
						"person_cm_id", personID,
						"csv_value", content,
						"custom_field_value", customValue)
				}
			}
		}

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

// findOrphanedPersonIDs returns person CampMinder IDs that have existing OBRs
// but are not present in the current CSV (i.e., no longer enrolled).
func findOrphanedPersonIDs(csvPersonIDs map[int]bool, existingOBRPersonIDs []int) []int {
	var orphaned []int
	for _, personID := range existingOBRPersonIDs {
		if !csvPersonIDs[personID] {
			orphaned = append(orphaned, personID)
		}
	}
	return orphaned
}

// purgeOrphanedRequests deletes OBRs and BRs for persons no longer in the CSV.
// Called after CSV sync to clean up data from campers who have cancelled/unenrolled.
// Returns the set of OBR person cm_ids (post-purge) for use by the zombie BR sweep.
func (s *BunkRequestsSync) purgeOrphanedRequests(year int) (map[int]bool, error) {
	// This sweep is hand-rolled rather than routed through
	// BaseSyncService.DeleteOrphansGuarded, so it does not pick up
	// OrphanSweepGuard's Rejected arm for free -- orphan_guard.go's own doc
	// warns this is exactly the gap a hand-rolled sweep falls into. A row
	// this run's processRow rejected (kindred#2292) never reaches
	// s.csvPersonIDs, which makes its still-current requester look identical
	// to one who genuinely cancelled. Skip explicitly rather than purge on an
	// incomplete set (kindred#2295's precondition, applied by hand here).
	if s.skipSweepForRejections("bunk_requests", nil) {
		return nil, nil
	}

	if len(s.csvPersonIDs) == 0 {
		slog.Info("No CSV persons tracked, skipping orphan purge")
		return nil, nil
	}

	// Query all OBRs for this year
	existingOBRs, err := s.App.FindRecordsByFilter(
		"original_bunk_requests",
		fmt.Sprintf("year = %d", year),
		"",
		0,
		0,
	)
	if err != nil {
		return nil, fmt.Errorf("querying existing OBRs for orphan purge: %w", err)
	}

	// Expand requester relation to get cm_id
	if errs := s.App.ExpandRecords(existingOBRs, []string{"requester"}, nil); len(errs) > 0 {
		slog.Warn("Some requester expansions failed during orphan purge", "errors", errs)
	}

	// Collect unique requester cm_ids from existing OBRs
	obrsByPerson := make(map[int][]*core.Record)
	for _, obr := range existingOBRs {
		requester := obr.ExpandedOne("requester")
		if requester == nil {
			continue
		}
		personCMID, _ := requester.Get("cm_id").(float64)
		if personCMID <= 0 {
			continue
		}
		cmID := int(personCMID)
		obrsByPerson[cmID] = append(obrsByPerson[cmID], obr)
	}

	// Build the OBR person set (returned for zombie sweep)
	obrPersonIDs := make(map[int]bool, len(obrsByPerson))
	for cmID := range obrsByPerson {
		obrPersonIDs[cmID] = true
	}

	// Find persons not in the CSV
	existingPersonIDs := make([]int, 0, len(obrsByPerson))
	for cmID := range obrsByPerson {
		existingPersonIDs = append(existingPersonIDs, cmID)
	}
	orphanedIDs := findOrphanedPersonIDs(s.csvPersonIDs, existingPersonIDs)

	if len(orphanedIDs) == 0 {
		slog.Info("No orphaned requests to purge")
		return obrPersonIDs, nil
	}

	// Delete OBRs and BRs for orphaned persons
	totalOBRs := 0
	totalBRs := 0
	for _, cmID := range orphanedIDs {
		// Delete OBRs
		for _, obr := range obrsByPerson[cmID] {
			if err := s.App.Delete(obr); err != nil {
				slog.Error("Failed to delete orphaned OBR", "person_cm_id", cmID, "error", err)
				s.Stats.Errors++
				continue
			}
			totalOBRs++
		}

		// Delete BRs for this person
		brs, err := s.App.FindRecordsByFilter(
			"bunk_requests",
			fmt.Sprintf("requester_id = %d && year = %d", cmID, year),
			"", 0, 0,
		)
		if err != nil {
			slog.Error("Failed to query BRs for orphaned person", "person_cm_id", cmID, "error", err)
			continue
		}
		for _, br := range brs {
			if err := s.App.Delete(br); err != nil {
				slog.Error("Failed to delete orphaned BR", "person_cm_id", cmID, "error", err)
				s.Stats.Errors++
				continue
			}
			totalBRs++
		}

		// Remove purged persons from the OBR set
		delete(obrPersonIDs, cmID)
	}

	s.Stats.Deleted += totalOBRs + totalBRs

	slog.Info("Purged orphaned requests",
		"persons", len(orphanedIDs),
		"obrs_deleted", totalOBRs,
		"brs_deleted", totalBRs,
	)
	return obrPersonIDs, nil
}

// findZombieBRPersonIDs returns requester cm_ids that have BRs but no OBRs and are not in the CSV.
// These are "zombie" BRs — their OBRs were already purged in a prior run, so the OBR-based purge
// can't see them. They persist forever unless explicitly swept.
func findZombieBRPersonIDs(csvPersonIDs, obrPersonIDs map[int]bool, brRequesterIDs []int) []int {
	seen := make(map[int]bool)
	var zombies []int
	for _, cmID := range brRequesterIDs {
		if seen[cmID] {
			continue
		}
		seen[cmID] = true
		if !csvPersonIDs[cmID] && !obrPersonIDs[cmID] {
			zombies = append(zombies, cmID)
		}
	}
	return zombies
}

// purgeZombieBRs deletes BRs whose requesters have no OBRs and are not in the CSV.
// This runs AFTER the OBR-based purge to catch BRs that survived because their OBRs
// were already deleted in a prior purge cycle.
func (s *BunkRequestsSync) purgeZombieBRs(year int, obrPersonIDs map[int]bool) error {
	// Query all BR requester_ids for this year
	brs, err := s.App.FindRecordsByFilter(
		"bunk_requests",
		fmt.Sprintf("year = %d", year),
		"",
		0,
		0,
	)
	if err != nil {
		return fmt.Errorf("querying BRs for zombie sweep: %w", err)
	}

	// Collect unique requester cm_ids
	var brRequesterIDs []int
	brsByRequester := make(map[int][]*core.Record)
	for _, br := range brs {
		cmID, _ := br.Get("requester_id").(float64)
		if cmID <= 0 {
			continue
		}
		id := int(cmID)
		brRequesterIDs = append(brRequesterIDs, id)
		brsByRequester[id] = append(brsByRequester[id], br)
	}

	zombieIDs := findZombieBRPersonIDs(s.csvPersonIDs, obrPersonIDs, brRequesterIDs)
	if len(zombieIDs) == 0 {
		return nil
	}

	totalBRs := 0
	for _, cmID := range zombieIDs {
		for _, br := range brsByRequester[cmID] {
			if err := s.App.Delete(br); err != nil {
				slog.Error("Failed to delete zombie BR", "requester_cm_id", cmID, "error", err)
				s.Stats.Errors++
				continue
			}
			totalBRs++
		}
	}

	s.Stats.Deleted += totalBRs

	slog.Info("Purged zombie BRs (requesters with no OBRs, not in CSV)",
		"persons", len(zombieIDs),
		"brs_deleted", totalBRs,
	)
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

// Sync implements the Service interface - calls RunSync with year-prefixed CSV path
func (s *BunkRequestsSync) Sync(_ context.Context) error {
	// Get current year from config
	currentYear := s.getCurrentYear()

	// Use year-prefixed CSV file from pb_data directory
	csvFilename := fmt.Sprintf("%d_latest.csv", currentYear)
	csvPath := filepath.Join(s.App.DataDir(), "bunk_requests", csvFilename)
	return s.RunSync(csvPath, 0)
}
