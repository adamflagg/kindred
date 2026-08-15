// Package sync provides synchronization services between CampMinder and PocketBase
package sync

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/camp/kindred/pocketbase/campminder"
)

// AttendeesSync handles syncing attendee enrollment data from CampMinder
type AttendeesSync struct {
	BaseSyncService

	// Caches for validation
	sessionCMIDs map[string]bool

	// DuplicateSessionEnrollments counts, across the whole run, how many "extra" entries
	// appeared beyond the first for a given attendee's (person, session) pair — see
	// duplicateSessionEnrollments below and kindred#2263. Zero over a real season answers
	// the open question; non-zero gives it data. This is observation only: it does not
	// change dedup behavior, the composite key, or idx_attendees_unique.
	DuplicateSessionEnrollments int
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

// SetDryRun implements the orchestrator's DryRunnable interface (kindred#2351). Declared
// explicitly rather than inherited by embedding BaseSyncService -- see that field's doc
// comment on BaseSyncService for why a promoted setter is not safe. Setting it also gates
// logStatusChange's own App.Save call below, which is outside BaseSyncService's write sites.
func (s *AttendeesSync) SetDryRun(dryRun bool) {
	s.DryRun = dryRun
}

// Sync performs the attendees sync
func (s *AttendeesSync) Sync(ctx context.Context) error {
	s.LogSyncStart("attendees")
	s.Stats = Stats{}                 // Reset stats
	s.SyncSuccessful = false          // Reset sync status
	s.ClearProcessedKeys()            // Reset processed tracking
	s.DuplicateSessionEnrollments = 0 // Reset kindred#2263 observation counter

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
			return fmt.Errorf("attendees sync cancelled: %w", ctx.Err())
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

	s.LogSyncComplete("Attendees",
		fmt.Sprintf("duplicate_session_enrollments=%d", s.DuplicateSessionEnrollments))

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
	attendeeData map[string]any,
	existingAttendees map[string]*core.Record,
) error {
	// Extract person ID
	personID, ok := attendeeData["PersonID"].(float64)
	if !ok {
		return fmt.Errorf("invalid or missing PersonID")
	}
	personCMID := int(personID)

	// Get session enrollments
	sessionStatuses, ok := attendeeData["SessionProgramStatus"].([]any)
	if !ok || len(sessionStatuses) == 0 {
		// No enrollments for this person
		s.DebugLog("Skipping attendee: no session enrollments", "person_cm_id", personCMID)
		s.Stats.Skipped++
		return nil
	}

	// kindred#2263 observation: does this attendee's own array ever repeat a SessionID? See
	// duplicateSessionEnrollments below for what this catches and why it matters.
	duplicateSessions := s.duplicateSessionEnrollments(personCMID, sessionStatuses)

	// Process each enrollment
	for _, enrollmentData := range sessionStatuses {
		enrollment, ok := enrollmentData.(map[string]any)
		if !ok {
			continue
		}

		if err := s.processEnrollment(personCMID, enrollment, existingAttendees); err != nil {
			// processEnrollment now distinguishes its two failure classes with
			// errRejectedRecord (kindred#2292): a malformed enrollment (e.g. a
			// missing SessionID) never reaches App.Save, so the idx_attendees_unique
			// collision diagnostic below -- which is specifically about a DB write
			// colliding -- only applies to the non-rejection branch.
			if errors.Is(err, errRejectedRecord) {
				slog.Warn("Rejected enrollment", "person_cm_id", personCMID, "error", err)
				s.Stats.Rejected++
			} else if sessionIDFloat, ok := enrollment["SessionID"].(float64); ok &&
				duplicateSessions[int(sessionIDFloat)] != nil {
				// duplicateSessions is keyed by SessionID and holds every entry that shares a
				// SessionID with another entry in this attendee's array — first, second, or
				// later; it doesn't identify which one is "the duplicate". So this only tells
				// us the group fact: this SessionID appears more than once. A (person, session)
				// key collision — overwriting the first entry on an idempotent upsert, or, on a
				// first-ever sync before existingAttendees has an entry for the key, taking the
				// create branch and hitting idx_attendees_unique — is one plausible cause of
				// this failure, but not the only one; this entry could equally be failing for a
				// reason unrelated to the collision. Tag it so the possible collision is legible
				// in the logs rather than the error reading as an unexplained local DB fault.
				slog.Error("Error processing enrollment (this SessionID appears more than "+
					"once in this attendee's SessionProgramStatus — see kindred#2263)",
					"person_cm_id", personCMID, "session_cm_id", int(sessionIDFloat), "error", err)
				s.Stats.Errors++
			} else {
				slog.Error("Error processing enrollment", "person_cm_id", personCMID, "error", err)
				s.Stats.Errors++
			}
		}
	}

	return nil
}

// duplicateSessionEnrollments scans a single attendee's SessionProgramStatus entries for
// SessionIDs that appear more than once, and returns them keyed by SessionID with each
// occurrence's ProgramID (or nil, if the entry has none) in encounter order.
//
// This is the identity question kindred#2263 asks, made observable. processEnrollment keys
// an enrollment on (person, session) only — fmt.Sprintf("%d:%d", personCMID, sessionCMID) —
// never reading ProgramID. If CampMinder's vendor API ever returns two SessionProgramStatus
// entries for the same person+session (one per program, say), the second one collapses onto
// the first: whichever is processed last wins the upsert. Nobody can currently see that
// happen without inspecting a live API response, which needs credentials this sync doesn't
// have reason to spend. This function only observes and logs; it changes no identity, no
// key, and no schema — see the scope note on kindred#2263 for why that split is deliberate.
//
// Every duplicated SessionID found logs one slog.Warn naming every ProgramID seen (or its
// absence), and s.DuplicateSessionEnrollments accumulates the "extra" entries (len-1 per
// duplicated session) across the whole run, so a season's worth of runs can answer whether
// this ever actually happens.
func (s *AttendeesSync) duplicateSessionEnrollments(personCMID int, sessionStatuses []any) map[int][]any {
	bySession := make(map[int][]any)
	for _, raw := range sessionStatuses {
		enrollment, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		sessionIDFloat, ok := enrollment["SessionID"].(float64)
		if !ok {
			continue
		}
		sessionCMID := int(sessionIDFloat)
		// enrollment["ProgramID"] is nil when the key is absent, which is exactly the
		// "or their absence" the counter needs to record.
		bySession[sessionCMID] = append(bySession[sessionCMID], enrollment["ProgramID"])
	}

	duplicates := make(map[int][]any)
	for sessionCMID, programIDs := range bySession {
		if len(programIDs) < 2 {
			continue
		}
		duplicates[sessionCMID] = programIDs
		s.DuplicateSessionEnrollments += len(programIDs) - 1
		slog.Warn("Duplicate SessionID within one attendee's SessionProgramStatus "+
			"(kindred#2263 — observation only, no identity change)",
			"person_cm_id", personCMID,
			"session_cm_id", sessionCMID,
			"count", len(programIDs),
			"program_ids", programIDs)
	}
	return duplicates
}

// processEnrollment processes a single enrollment using pre-loaded existing attendees
func (s *AttendeesSync) processEnrollment(
	personCMID int,
	enrollment map[string]any,
	existingAttendees map[string]*core.Record,
) error {
	// Extract session ID
	sessionID, ok := enrollment["SessionID"].(float64)
	if !ok {
		return fmt.Errorf("%w: invalid or missing SessionID", errRejectedRecord)
	}
	sessionCMID := int(sessionID)

	// Check if session exists
	if !s.sessionCMIDs[strconv.Itoa(sessionCMID)] {
		// Session doesn't exist in PocketBase, skip
		s.DebugLog("Skipping enrollment: session not in PocketBase",
			"person_cm_id", personCMID,
			"session_cm_id", sessionCMID)
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
		1:   "none",
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

	// Parse enrollment date (PostDate = current status date)
	var enrollmentDate string
	if postDate, ok := enrollment["PostDate"].(string); ok {
		enrollmentDate = ParseDate(postDate)
	}

	// Parse EffectiveDate (original registration/application date, never overwritten)
	var effectiveDate string
	if ed, ok := enrollment["EffectiveDate"].(string); ok {
		effectiveDate = ParseDate(ed)
	}

	// Parse LastUpdatedUTC (last modification timestamp)
	var lastUpdatedUTC string
	if lu, ok := enrollment["LastUpdatedUTC"].(string); ok {
		lastUpdatedUTC = ParseDate(lu)
	}

	// Note: CampMinder attendee ID exists in enrollment["ID"] but we don't need it in PocketBase

	// Prepare record data
	recordData := map[string]any{
		"person_id":        personCMID,
		"status":           status,
		"status_id":        statusID,
		"enrollment_date":  enrollmentDate,
		"effective_date":   effectiveDate,
		"last_updated_utc": lastUpdatedUTC,
		"year":             s.Client.GetSeasonID(),
	}

	// Populate session and person relations
	relations := []RelationConfig{
		{FieldName: "session", Collection: "camp_sessions", CMID: sessionCMID, Required: true},
		{FieldName: "person", Collection: "persons", CMID: personCMID, Required: false},
	}
	if err := s.PopulateRelations(recordData, relations); err != nil {
		return fmt.Errorf("populating relations: %w", err)
	}

	// Detect status changes for history tracking
	// Use year-scoped key to match PreloadCompositeRecords format: "{person}:{session}|{year}"
	yearScopedKey := fmt.Sprintf("%s|%d", key, s.Client.GetSeasonID())
	if existing, ok := existingAttendees[yearScopedKey]; ok {
		oldStatus := existing.GetString("status")
		if oldStatus != "" && oldStatus != status {
			if err := s.logStatusChange(personCMID, sessionCMID, oldStatus, status, recordData); err != nil {
				slog.Warn("Failed to log status change",
					"person", personCMID,
					"session", sessionCMID,
					"old_status", oldStatus,
					"new_status", status,
					"error", err)
			}
		}
	}

	// Use ProcessCompositeRecord utility with year field skipped for idempotency
	return s.ProcessCompositeRecord("attendees", key, recordData, existingAttendees, []string{"year"})
}

// logStatusChange creates a record in attendee_status_history when a status transition is detected.
// This is a non-critical operation - errors are logged but do not fail the sync.
func (s *AttendeesSync) logStatusChange(
	personCMID, sessionCMID int, oldStatus, newStatus string, recordData map[string]any,
) error {
	collection, err := s.App.FindCollectionByNameOrId("attendee_status_history")
	if err != nil {
		return fmt.Errorf("finding attendee_status_history collection: %w", err)
	}

	record := core.NewRecord(collection)
	record.Set("person_id", personCMID)
	record.Set("old_status", oldStatus)
	record.Set("new_status", newStatus)
	record.Set("detected_at", time.Now().UTC().Format("2006-01-02 15:04:05.000Z"))
	record.Set("year", s.Client.GetSeasonID())

	// Copy session and person relations from the attendee record data
	if sessionPBID, ok := recordData["session"]; ok {
		record.Set("session", sessionPBID)
	}
	if personPBID, ok := recordData["person"]; ok {
		record.Set("person", personPBID)
	}

	if s.DryRun {
		return nil
	}

	if err := s.App.Save(record); err != nil {
		return fmt.Errorf("saving status history record: %w", err)
	}

	slog.Info("Recorded status change",
		"person_id", personCMID,
		"session_cm_id", sessionCMID,
		"old_status", oldStatus,
		"new_status", newStatus)

	return nil
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

	return s.DeleteOrphansGuarded(
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
		OrphanSweepGuard{
			Entity:   "attendees",
			Year:     year,
			Computed: len(s.ProcessedKeys),
			Hint: "check that the CampMinder attendee feed returned this season (a collapsed " +
				"camp_sessions table shows up as the unkeyable-record warning above, not here)",
		},
	)
}
