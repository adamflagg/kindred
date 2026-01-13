// Package sync provides synchronization services between CampMinder and PocketBase
package sync

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/camp/kindred/pocketbase/campminder"
	"github.com/pocketbase/pocketbase/core"
)

// BunkAssignmentsSync handles syncing bunk assignment records from CampMinder
type BunkAssignmentsSync struct {
	BaseSyncService

	// Cache valid CampMinder IDs for validation
	validPersonCMIDs  map[int]bool
	validBunkCMIDs    map[int]bool
	validSessionCMIDs map[int]bool

	// Person enrollment: personCMID -> list of enrolled sessionCMIDs
	personEnrollments map[int][]int

	// Bunk plan sessions: bunkPlanCMID -> list of sessionCMIDs
	bunkPlanSessionsList map[int][]int
}

// NewBunkAssignmentsSync creates a new bunk assignments sync service
func NewBunkAssignmentsSync(app core.App, client *campminder.Client) *BunkAssignmentsSync {
	return &BunkAssignmentsSync{
		BaseSyncService:      NewBaseSyncService(app, client),
		validPersonCMIDs:     make(map[int]bool),
		validBunkCMIDs:       make(map[int]bool),
		validSessionCMIDs:    make(map[int]bool),
		personEnrollments:    make(map[int][]int),
		bunkPlanSessionsList: make(map[int][]int),
	}
}

// Name returns the name of this sync service
func (s *BunkAssignmentsSync) Name() string {
	return "bunk_assignments"
}

// Sync performs the bunk assignments synchronization
func (s *BunkAssignmentsSync) Sync(ctx context.Context) error {
	s.LogSyncStart("bunk assignments")
	s.Stats = Stats{}        // Reset stats
	s.SyncSuccessful = false // Reset sync status
	s.ClearProcessedKeys()   // Reset processed tracking

	// Load mappings for validation
	if err := s.loadMappings(); err != nil {
		return fmt.Errorf("loading mappings: %w", err)
	}

	// Pre-load all existing assignments using composite key utility
	// We need to build keys based on person/session CampMinder IDs stored during creation
	year := s.Client.GetSeasonID()
	filter := fmt.Sprintf("year = %d", year)

	// First, load mappings of PocketBase IDs to CampMinder IDs for existing assignments
	assignmentMappings, err := s.BuildRecordCMIDMappings("bunk_assignments", filter, map[string]string{
		"person":  "persons",
		"session": "camp_sessions",
	})
	if err != nil {
		return fmt.Errorf("loading assignment mappings: %w", err)
	}

	// Now load existing assignments with proper composite keys
	existingAssignments, err := s.PreloadCompositeRecords(
		"bunk_assignments", filter, func(record *core.Record) (string, bool) {
			mapping := assignmentMappings[record.Id]
			personCMID := mapping["personCMID"]
			sessionCMID := mapping["sessionCMID"]
			recordYear, _ := record.Get("year").(float64)

			if personCMID > 0 && sessionCMID > 0 && recordYear > 0 {
				key := fmt.Sprintf("%d:%d:%d", personCMID, sessionCMID, int(recordYear))
				return key, true
			}
			return "", false
		})
	if err != nil {
		return err
	}

	// Get all bunk IDs
	bunkIDs := make([]int, 0, len(s.validBunkCMIDs))
	for bunkID := range s.validBunkCMIDs {
		bunkIDs = append(bunkIDs, bunkID)
	}

	if len(bunkIDs) == 0 {
		slog.Info("No bunks found")
		return nil
	}

	// Load all bunk plan IDs
	bunkPlanIDs := make([]int, 0)
	bpFilter := fmt.Sprintf("year = %d", year)
	if err := s.PaginateRecords("bunk_plans", bpFilter, func(record *core.Record) error {
		if cmID, ok := record.Get("cm_id").(float64); ok && cmID > 0 {
			bunkPlanIDs = append(bunkPlanIDs, int(cmID))
		}
		return nil
	}); err != nil {
		return fmt.Errorf("loading bunk plans: %w", err)
	}

	if len(bunkPlanIDs) == 0 {
		slog.Info("No bunk plans found for current year")
		return nil
	}

	slog.Info("Loaded bunk plans and bunks", "bunkPlans", len(bunkPlanIDs), "bunks", len(bunkIDs))

	// Fetch assignments for all bunk plans and bunks
	page := 1
	pageSize := LargePageSize
	totalAssignments := 0

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		slog.Info("Fetching bunk assignments page", "page", page)
		assignments, err := s.Client.GetBunkAssignments(bunkPlanIDs, bunkIDs, page, pageSize)
		if err != nil {
			return fmt.Errorf("fetching bunk assignments page %d: %w", page, err)
		}

		if len(assignments) == 0 {
			break
		}

		totalAssignments += len(assignments)
		slog.Info("Processing assignments from page", "count", len(assignments), "page", page)

		// Mark sync as successful once we've successfully fetched data
		if page == 1 && len(assignments) > 0 {
			s.SyncSuccessful = true
		}

		// Process each result
		for _, result := range assignments {
			bunkID := int(result["BunkID"].(float64))
			bunkPlanID := int(result["BunkPlanID"].(float64))

			// Get the assignments array from this result
			assignmentsArray, ok := result["Assignments"].([]interface{})
			if !ok {
				slog.Warn("No Assignments array in result")
				continue
			}

			// Get the list of sessions this bunk plan applies to
			bunkPlanSessions := s.bunkPlanSessionsList[bunkPlanID]
			if len(bunkPlanSessions) == 0 {
				slog.Warn("No sessions found for bunk plan, skipping", "bunkPlanID", bunkPlanID)
				continue
			}

			// Process each assignment in the array
			for _, assignment := range assignmentsArray {
				assignmentData := assignment.(map[string]interface{})

				// Get the person ID to look up their enrollment
				personID, ok := assignmentData["PersonID"].(float64)
				if !ok {
					slog.Warn("No PersonID in assignment")
					continue
				}
				personCMID := int(personID)

				// Find the correct session by intersecting person's enrollments with bunk plan's sessions
				personSessions := s.personEnrollments[personCMID]
				sessionID := s.findMatchingSession(personSessions, bunkPlanSessions)
				if sessionID == 0 {
					// No intersection - person not enrolled in any session for this bunk plan
					// (expected for family camp, staff, etc.)
					s.Stats.Skipped++
					continue
				}

				// Add BunkID, BunkPlanID, and SessionID to the assignment data
				assignmentData["BunkID"] = float64(bunkID)
				assignmentData["BunkPlanID"] = float64(bunkPlanID)
				assignmentData["SessionID"] = float64(sessionID)

				if err := s.processAssignment(assignmentData, existingAssignments); err != nil {
					slog.Error("Error processing assignment", "error", err)
					s.Stats.Errors++
				}
			}
		}

		page++
	}

	slog.Info("Fetched bunk assignments from CampMinder", "count", totalAssignments)

	// Delete orphaned assignments
	if err := s.deleteOrphans(); err != nil {
		slog.Error("Error deleting orphans", "error", err)
	}

	// Force WAL checkpoint to ensure data is flushed
	if err := s.ForceWALCheckpoint(); err != nil {
		slog.Warn("WAL checkpoint failed", "error", err)
		// Don't fail the sync if checkpoint fails
	}

	// Use extra stats to show fetched count
	s.LogSyncComplete("Bunk assignments", fmt.Sprintf("fetched=%d assignments", totalAssignments))

	return nil
}

// loadMappings loads valid CampMinder IDs from PocketBase
func (s *BunkAssignmentsSync) loadMappings() error {
	slog.Info("Loading valid CampMinder IDs")

	year := s.Client.GetSeasonID()

	// Load person enrollments: personCMID -> list of sessionCMIDs they're enrolled in
	// This is the source of truth for which session a person belongs to
	attendeeFilter := fmt.Sprintf("year = %d && is_active = true", year)
	if err := s.PaginateRecords("attendees", attendeeFilter, func(record *core.Record) error {
		personCMID := 0
		sessionCMID := 0

		// Get person CM ID
		if personID, ok := record.Get("person_id").(float64); ok && personID > 0 {
			personCMID = int(personID)
			s.validPersonCMIDs[personCMID] = true
		}

		// Get session CM ID by looking up the related session
		if sessionID := record.GetString("session"); sessionID != "" {
			sessionFilter := fmt.Sprintf("id = '%s'", sessionID)
			sessions, err := s.App.FindRecordsByFilter("camp_sessions", sessionFilter, "", 1, 0)
			if err == nil && len(sessions) > 0 {
				if cmID, ok := sessions[0].Get("cm_id").(float64); ok {
					sessionCMID = int(cmID)
				}
			}
		}

		// Add to person enrollments list
		if personCMID > 0 && sessionCMID > 0 {
			s.personEnrollments[personCMID] = append(s.personEnrollments[personCMID], sessionCMID)
		}

		return nil
	}); err != nil {
		return fmt.Errorf("loading person enrollments from attendees: %w", err)
	}
	slog.Info("Loaded enrolled persons with session mappings", "count", len(s.personEnrollments), "year", year)

	// Load bunks
	if err := s.PaginateRecords("bunks", "", func(record *core.Record) error {
		if cmID, ok := record.Get("cm_id").(float64); ok && cmID > 0 {
			s.validBunkCMIDs[int(cmID)] = true
		}
		return nil
	}); err != nil {
		return fmt.Errorf("loading bunks: %w", err)
	}

	// Load sessions for current year
	filter := fmt.Sprintf("year = %d", year)
	if err := s.PaginateRecords("camp_sessions", filter, func(record *core.Record) error {
		if cmID, ok := record.Get("cm_id").(float64); ok && cmID > 0 {
			s.validSessionCMIDs[int(cmID)] = true
		}
		return nil
	}); err != nil {
		return fmt.Errorf("loading sessions: %w", err)
	}

	// Load bunk plan sessions: bunkPlanCMID -> list of sessionCMIDs
	// A bunk plan can apply to multiple sessions (e.g., main + AG sessions)
	slog.Info("Loading bunk plan to sessions mapping")
	bpFilter := fmt.Sprintf("year = %d", year)
	if err := s.PaginateRecords("bunk_plans", bpFilter, func(record *core.Record) error {
		bpCMID := 0
		sessionCMID := 0

		if cmID, ok := record.Get("cm_id").(float64); ok && cmID > 0 {
			bpCMID = int(cmID)
		}

		// Get session CM ID by looking up the related session
		if sessionID := record.GetString("session"); sessionID != "" {
			sessionFilter := fmt.Sprintf("id = '%s'", sessionID)
			sessions, err := s.App.FindRecordsByFilter("camp_sessions", sessionFilter, "", 1, 0)
			if err == nil && len(sessions) > 0 {
				if cmID, ok := sessions[0].Get("cm_id").(float64); ok {
					sessionCMID = int(cmID)
				}
			}
		}

		// Add to bunk plan sessions list (not overwriting!)
		if bpCMID > 0 && sessionCMID > 0 {
			s.bunkPlanSessionsList[bpCMID] = append(s.bunkPlanSessionsList[bpCMID], sessionCMID)
		}

		return nil
	}); err != nil {
		return fmt.Errorf("loading bunk plan sessions: %w", err)
	}
	slog.Info("Loaded bunk plans with session mappings", "count", len(s.bunkPlanSessionsList))

	return nil
}

// findMatchingSession finds the session that a person is enrolled in that also belongs to the bunk plan.
// CampMinder assignments don't include session ID - we must derive it by intersecting:
// - The sessions the person is enrolled in (from attendees)
// - The sessions the bunk plan applies to (from bunk_plans)
// Returns the first matching session ID, or 0 if no match found.
func (s *BunkAssignmentsSync) findMatchingSession(personSessions, bunkPlanSessions []int) int {
	// Build a set of person's sessions for O(1) lookup
	personSessionSet := make(map[int]bool)
	for _, sessionID := range personSessions {
		personSessionSet[sessionID] = true
	}

	// Find first matching session
	for _, sessionID := range bunkPlanSessions {
		if personSessionSet[sessionID] {
			return sessionID
		}
	}

	return 0
}

// processAssignment processes a single bunk assignment using pre-loaded existing assignments
func (s *BunkAssignmentsSync) processAssignment(
	assignmentData map[string]interface{},
	existingAssignments map[string]*core.Record,
) error {
	// Extract required fields
	personID, ok := assignmentData["PersonID"].(float64)
	if !ok {
		return fmt.Errorf("missing PersonID")
	}

	sessionID, ok := assignmentData["SessionID"].(float64)
	if !ok {
		return fmt.Errorf("missing SessionID")
	}

	bunkID, ok := assignmentData["BunkID"].(float64)
	if !ok {
		return fmt.Errorf("missing BunkID")
	}

	bunkPlanID, ok := assignmentData["BunkPlanID"].(float64)
	if !ok {
		return fmt.Errorf("missing BunkPlanID")
	}

	personCMID := int(personID)
	sessionCMID := int(sessionID)
	bunkCMID := int(bunkID)
	bunkPlanCMID := int(bunkPlanID)

	// Track this assignment as processed using base class tracking
	s.TrackProcessedCompositeKey(fmt.Sprintf("%d:%d", personCMID, sessionCMID), s.Client.GetSeasonID())

	// Validate person exists
	if !s.validPersonCMIDs[personCMID] {
		s.Stats.Skipped++
		return nil
	}

	// Validate session exists
	if !s.validSessionCMIDs[sessionCMID] {
		s.Stats.Skipped++
		return nil
	}

	// Validate bunk exists
	if !s.validBunkCMIDs[bunkCMID] {
		s.Stats.Skipped++
		return nil
	}

	// Extract other fields
	grade := 0
	if g, ok := assignmentData["Grade"].(float64); ok {
		grade = int(g)
	}

	age := 0
	if a, ok := assignmentData["Age"].(float64); ok {
		age = int(a)
	}

	// Parse assignment date
	var assignedDate *time.Time
	if dateStr, ok := assignmentData["AssignedDate"].(string); ok && dateStr != "" {
		if t, err := time.Parse("2006-01-02", dateStr); err == nil {
			assignedDate = &t
		}
	}

	// Get CampMinder assignment ID
	var assignmentCMID int
	if id, ok := assignmentData["ID"].(float64); ok {
		assignmentCMID = int(id)
	}

	// Check if assignment already exists using composite key
	year := s.Client.GetSeasonID()
	key := fmt.Sprintf("%d:%d:%d", personCMID, sessionCMID, year)

	// Prepare record data with CM ID
	recordData := map[string]interface{}{
		"year":  year,
		"grade": grade,
		"age":   age,
		"cm_id": assignmentCMID, // The assignment's own CampMinder ID
	}

	if assignedDate != nil {
		recordData["assigned_date"] = assignedDate.Format("2006-01-02 15:04:05.000Z")
	}

	// Populate all relations - person, session, and bunk are all required
	// Without these, the assignment record is useless and causes data integrity issues
	relations := []RelationConfig{
		{FieldName: "person", Collection: "persons", CMID: personCMID, Required: true},
		{FieldName: "session", Collection: "camp_sessions", CMID: sessionCMID, Required: true},
		{FieldName: "bunk", Collection: "bunks", CMID: bunkCMID, Required: true},
	}

	if err := s.PopulateRelations(recordData, relations); err != nil {
		return fmt.Errorf("populating relations: %w", err)
	}

	// Special handling for bunk_plan relation since it has non-unique CM IDs
	if bunkPlanCMID > 0 {
		bunkPlanPBID, found := s.LookupBunkPlan(bunkPlanCMID, bunkCMID, sessionCMID)
		if found {
			recordData["bunk_plan"] = bunkPlanPBID
		}
	}

	// Use ProcessCompositeRecord utility
	return s.ProcessCompositeRecord("bunk_assignments", key, recordData, existingAssignments, []string{"year"})
}

// deleteOrphans deletes assignments that exist in PocketBase but weren't in CampMinder
func (s *BunkAssignmentsSync) deleteOrphans() error {
	year := s.Client.GetSeasonID()
	filter := fmt.Sprintf("year = %d", year)

	// First, load mappings for all assignments
	assignmentMappings, err := s.BuildRecordCMIDMappings("bunk_assignments", filter, map[string]string{
		"person":  "persons",
		"session": "camp_sessions",
	})
	if err != nil {
		return fmt.Errorf("loading mappings for orphan detection: %w", err)
	}

	return s.DeleteOrphans(
		"bunk_assignments",
		func(record *core.Record) (string, bool) {
			mapping := assignmentMappings[record.Id]
			personCMID := mapping["personCMID"]
			sessionCMID := mapping["sessionCMID"]
			yearValue := record.Get("year")

			if personCMID > 0 && sessionCMID > 0 {
				// Build composite key with year
				year, ok := yearValue.(float64)
				if !ok {
					return "", false
				}
				// For composite records, append year to the composite key
				key := fmt.Sprintf("%d:%d|%d", personCMID, sessionCMID, int(year))
				return key, true
			}
			return "", false
		},
		"bunk assignment",
		filter,
	)
}
