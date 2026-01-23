// Package sync provides synchronization services between CampMinder and PocketBase
package sync

import (
	"context"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/camp/kindred/pocketbase/campminder"
)

// AttendeesSync handles syncing attendee enrollment data from CampMinder
type AttendeesSync struct {
	BaseSyncService

	// Caches for validation
	sessionCMIDs map[string]bool
}

// NewAttendeesSync creates a new attendees sync service
func NewAttendeesSync(app core.App, client *campminder.Client) *AttendeesSync {
	return &AttendeesSync{
		BaseSyncService: NewBaseSyncService(app, client),
		sessionCMIDs:    make(map[string]bool),
	}
}

// Name returns the name of this sync service
func (s *AttendeesSync) Name() string {
	return "attendees"
}

// Sync performs the attendees sync
func (s *AttendeesSync) Sync(ctx context.Context) error {
	s.LogSyncStart("attendees")
	s.Stats = Stats{}        // Reset stats
	s.SyncSuccessful = false // Reset sync status
	s.ClearProcessedKeys()   // Reset processed tracking

	// Load session CampMinder IDs for validation
	if err := s.loadSessionIDs(); err != nil {
		return fmt.Errorf("loading session IDs: %w", err)
	}

	// Pre-load existing attendees for current year using composite key utility
	year := s.Client.GetSeasonID()
	filter := fmt.Sprintf("year = %d", year)

	// First load session mappings since session_id field was removed
	sessionMappings := make(map[string]int) // pbID -> cmID
	if err := s.PaginateRecords("attendees", filter, func(record *core.Record) error {
		if sessionID := record.GetString("session"); sessionID != "" {
			sessionFilter := fmt.Sprintf("id = '%s'", sessionID)
			sessions, err := s.App.FindRecordsByFilter("camp_sessions", sessionFilter, "", 1, 0, nil)
			if err == nil && len(sessions) > 0 {
				if cmID, ok := sessions[0].Get("cm_id").(float64); ok {
					sessionMappings[sessionID] = int(cmID)
				}
			}
		}
		return nil
	}); err != nil {
		return fmt.Errorf("loading session mappings: %w", err)
	}

	// Now load existing attendees with proper composite keys
	existingAttendees, err := s.PreloadCompositeRecords("attendees", filter, func(record *core.Record) (string, bool) {
		personCMID, _ := record.Get("person_id").(float64)
		sessionID := record.GetString("session")
		sessionCMID := sessionMappings[sessionID]

		if personCMID > 0 && sessionCMID > 0 {
			key := fmt.Sprintf("%d:%d", int(personCMID), sessionCMID)
			return key, true
		}
		return "", false
	})
	if err != nil {
		return err
	}

	// Fetch all attendees page by page
	page := 1
	pageSize := LargePageSize

	for {
		// Check context cancellation
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		// Fetch page
		attendees, hasMore, err := s.Client.GetAttendeesPage(page, pageSize)
		if err != nil {
			return fmt.Errorf("fetching attendees page %d: %w", page, err)
		}

		slog.Info("Processing attendees page", "page", page, "count", len(attendees))

		// Mark sync as successful once we've successfully fetched data
		if page == 1 && len(attendees) > 0 {
			s.SyncSuccessful = true
		}

		// Process each attendee on this page
		for _, attendee := range attendees {
			if err := s.processAttendee(attendee, existingAttendees); err != nil {
				slog.Error("Error processing attendee", "error", err)
				s.Stats.Errors++
			}
		}

		// Check if we have more pages
		if !hasMore || len(attendees) == 0 {
			break
		}
		page++
	}

	// Delete orphaned attendees
	if err := s.deleteOrphans(); err != nil {
		slog.Error("Error deleting orphans", "error", err)
	}

	// Force WAL checkpoint to ensure data is flushed
	if err := s.ForceWALCheckpoint(); err != nil {
		slog.Warn("WAL checkpoint failed", "error", err)
		// Don't fail the sync if checkpoint fails
	}

	s.LogSyncComplete("Attendees")

	return nil
}

// loadSessionIDs loads all session CampMinder IDs for validation
func (s *AttendeesSync) loadSessionIDs() error {
	slog.Info("Loading session CampMinder IDs")

	// Use PaginateRecords which will automatically add year filtering
	// for the camp_sessions collection
	if err := s.PaginateRecords("camp_sessions", "", func(record *core.Record) error {
		cmID := record.GetString("cm_id")
		if cmID != "" {
			s.sessionCMIDs[cmID] = true
		}
		return nil
	}); err != nil {
		return fmt.Errorf("loading sessions: %w", err)
	}

	slog.Info("Loaded session CM IDs", "count", len(s.sessionCMIDs), "year", s.Client.GetSeasonID())
	return nil
}

// processAttendee processes a single attendee using pre-loaded existing attendees
func (s *AttendeesSync) processAttendee(
	attendeeData map[string]interface{},
	existingAttendees map[string]*core.Record,
) error {
	// Extract person ID
	personID, ok := attendeeData["PersonID"].(float64)
	if !ok {
		return fmt.Errorf("invalid or missing PersonID")
	}
	personCMID := int(personID)

	// Get session enrollments
	sessionStatuses, ok := attendeeData["SessionProgramStatus"].([]interface{})
	if !ok || len(sessionStatuses) == 0 {
		// No enrollments for this person
		s.Stats.Skipped++
		return nil
	}

	// Process each enrollment
	for _, enrollmentData := range sessionStatuses {
		enrollment, ok := enrollmentData.(map[string]interface{})
		if !ok {
			continue
		}

		if err := s.processEnrollment(personCMID, enrollment, existingAttendees); err != nil {
			slog.Error("Error processing enrollment", "person_cm_id", personCMID, "error", err)
			s.Stats.Errors++
		}
	}

	return nil
}

// processEnrollment processes a single enrollment using pre-loaded existing attendees
func (s *AttendeesSync) processEnrollment(
	personCMID int,
	enrollment map[string]interface{},
	existingAttendees map[string]*core.Record,
) error {
	// Extract session ID
	sessionID, ok := enrollment["SessionID"].(float64)
	if !ok {
		return fmt.Errorf("invalid or missing SessionID")
	}
	sessionCMID := int(sessionID)

	// Check if session exists
	if !s.sessionCMIDs[strconv.Itoa(sessionCMID)] {
		// Session doesn't exist in PocketBase, skip
		s.Stats.Skipped++
		return nil
	}

	// Create composite key for lookup
	key := fmt.Sprintf("%d:%d", personCMID, sessionCMID)

	// Track this attendee as processed using base class tracking
	s.TrackProcessedCompositeKey(key, s.Client.GetSeasonID())

	// Extract status ID
	statusIDFloat, _ := enrollment["StatusID"].(float64)
	statusID := int(statusIDFloat)

	// Map StatusID to our status values
	statusMap := map[int]string{
		2:   "enrolled",
		4:   "applied",
		8:   "waitlisted",
		16:  "left_early",
		32:  "cancelled", //nolint:misspell // CampMinder status value
		64:  "dismissed",
		128: "inquiry",
		256: "withdrawn",
		512: "incomplete",
	}

	status, ok := statusMap[statusID]
	if !ok {
		status = "unknown"
	}

	// Only StatusID = 2 is truly enrolled
	isActive := statusID == 2

	// Parse enrollment date
	var enrollmentDate string
	if postDate, ok := enrollment["PostDate"].(string); ok {
		enrollmentDate = s.parseDate(postDate)
	}

	// Note: CampMinder attendee ID exists in enrollment["ID"] but we don't need it in PocketBase

	// Prepare record data
	recordData := map[string]interface{}{
		"person_id":       personCMID,
		"status":          status,
		"status_id":       statusID,
		"enrollment_date": enrollmentDate,
		"is_active":       isActive,
		"year":            s.Client.GetSeasonID(),
	}

	// Populate session and person relations
	relations := []RelationConfig{
		{FieldName: "session", Collection: "camp_sessions", CMID: sessionCMID, Required: true},
		{FieldName: "person", Collection: "persons", CMID: personCMID, Required: false},
	}
	if err := s.PopulateRelations(recordData, relations); err != nil {
		return fmt.Errorf("populating relations: %w", err)
	}

	// Use ProcessCompositeRecord utility with year field skipped for idempotency
	return s.ProcessCompositeRecord("attendees", key, recordData, existingAttendees, []string{"year"})
}

// parseDate parses CampMinder date format
func (s *AttendeesSync) parseDate(dateStr string) string {
	if dateStr == "" {
		return ""
	}

	// Handle ISO format with timezone
	if strings.Contains(dateStr, "T") {
		// Parse the time
		t, err := time.Parse(time.RFC3339, strings.Replace(dateStr, "Z", "+00:00", 1))
		if err != nil {
			// Try without timezone replacement
			t, err = time.Parse(time.RFC3339, dateStr)
			if err != nil {
				return dateStr // Return as-is if parsing fails
			}
		}
		// Format as PocketBase expects
		return t.Format("2006-01-02 15:04:05.000Z")
	}

	return dateStr
}

// deleteOrphans deletes attendees that exist in PocketBase but weren't in CampMinder
func (s *AttendeesSync) deleteOrphans() error {
	year := s.Client.GetSeasonID()
	filter := fmt.Sprintf("year = %d", year)

	// First load session mappings for orphan detection
	sessionMappings := make(map[string]int) // pbID -> cmID
	if err := s.PaginateRecords("attendees", filter, func(record *core.Record) error {
		if sessionID := record.GetString("session"); sessionID != "" {
			// Lookup session CM ID
			sessionFilter := fmt.Sprintf("id = '%s'", sessionID)
			sessions, err := s.App.FindRecordsByFilter("camp_sessions", sessionFilter, "", 1, 0, nil)
			if err == nil && len(sessions) > 0 {
				if cmID, ok := sessions[0].Get("cm_id").(float64); ok {
					sessionMappings[sessionID] = int(cmID)
				}
			}
		}
		return nil
	}); err != nil {
		return fmt.Errorf("loading session mappings for orphan detection: %w", err)
	}

	return s.DeleteOrphans(
		"attendees",
		func(record *core.Record) (string, bool) {
			personCMID, _ := record.Get("person_id").(float64)
			sessionID := record.GetString("session")
			sessionCMID := sessionMappings[sessionID]
			yearValue := record.Get("year")

			if personCMID > 0 && sessionCMID > 0 {
				// Build composite key with year
				year, ok := yearValue.(float64)
				if !ok {
					return "", false
				}
				// For composite records, append year to the composite key
				key := fmt.Sprintf("%d:%d|%d", int(personCMID), sessionCMID, int(year))
				return key, true
			}
			return "", false
		},
		"attendee",
		filter,
	)
}
