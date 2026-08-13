// Package sync provides synchronization services between CampMinder and PocketBase
package sync

import (
	"context"
	"fmt"
	"log/slog"

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

	// Staff inclusion: resolve staff assignments to exact sessions
	staffPersonCMIDs      map[int]bool   // person CM IDs where bunk_staff=true
	bunkPlanBunkToSession map[string]int // "bunkPlanCMID:bunkCMID" → sessionCMID
	bunkPBIDToCMID        map[string]int // bunk PB ID → bunk CM ID (reverse lookup)
}

// NewBunkAssignmentsSync creates a new bunk assignments sync service
func NewBunkAssignmentsSync(app core.App, client *campminder.Client) *BunkAssignmentsSync {
	return &BunkAssignmentsSync{
		BaseSyncService:       NewBaseSyncService(app, client),
		validPersonCMIDs:      make(map[int]bool),
		validBunkCMIDs:        make(map[int]bool),
		validSessionCMIDs:     make(map[int]bool),
		personEnrollments:     make(map[int][]int),
		bunkPlanSessionsList:  make(map[int][]int),
		staffPersonCMIDs:      make(map[int]bool),
		bunkPlanBunkToSession: make(map[string]int),
		bunkPBIDToCMID:        make(map[string]int),
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
			return fmt.Errorf("bunk assignments sync cancelled: %w", ctx.Err())
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
			bunkIDFloat, ok := result["BunkID"].(float64)
			if !ok {
				slog.Warn("Missing or invalid BunkID in result")
				continue
			}
			bunkID := int(bunkIDFloat)

			bunkPlanIDFloat, ok := result["BunkPlanID"].(float64)
			if !ok {
				slog.Warn("Missing or invalid BunkPlanID in result")
				continue
			}
			bunkPlanID := int(bunkPlanIDFloat)

			// Get the assignments array from this result
			assignmentsArray, ok := result["Assignments"].([]any)
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
				assignmentData, ok := assignment.(map[string]any)
				if !ok {
					slog.Warn("Invalid assignment data type")
					continue
				}

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
					// Staff fallback: use (bunkPlan, bunk) → session lookup.
					// Staff aren't in attendees, so enrollment intersection won't work.
					// Each (bunkPlanCMID, bunkCMID) pair maps to exactly one session.
					if s.staffPersonCMIDs[personCMID] {
						key := fmt.Sprintf("%d:%d", bunkPlanID, bunkID)
						if sid, ok := s.bunkPlanBunkToSession[key]; ok {
							sessionID = sid
						}
					}
					if sessionID == 0 {
						s.Stats.Skipped++
						continue
					}
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

	// Protect bunk_assignments for non-active staff from orphan deletion, then
	// sweep orphans -- in that order, and only if protection succeeded. See
	// protectThenSweepOrphans.
	sweepErr := s.protectThenSweepOrphans(year)

	// Force WAL checkpoint to ensure data is flushed.
	//
	// This precedes the sweepErr return deliberately: the fetch loop above has
	// already written this run's assignments, and those writes are still in the
	// WAL on the failure path too. Checkpointing after the return would strand
	// them. staff_applications.go and staff_vehicle_info.go order it the same
	// way, for the same reason.
	if err := s.ForceWALCheckpoint(); err != nil {
		slog.Warn("WAL checkpoint failed", "error", err)
		// Don't fail the sync if checkpoint fails
	}

	if sweepErr != nil {
		return sweepErr
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
	attendeeFilter := fmt.Sprintf("year = %d && status_id = 2", year)
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

	// Load bunks (also build PB ID → CM ID reverse lookup for bunkPlanBunkToSession)
	if err := s.PaginateRecords("bunks", "", func(record *core.Record) error {
		if cmID, ok := record.Get("cm_id").(float64); ok && cmID > 0 {
			s.validBunkCMIDs[int(cmID)] = true
			s.bunkPBIDToCMID[record.Id] = int(cmID)
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
	// Also build bunkPlanBunkToSession: "bunkPlanCMID:bunkCMID" → sessionCMID
	// for resolving staff assignments to exact sessions.
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

		// Build bunkPlanBunkToSession: each (bunkPlan, bunk) pair maps to exactly one session
		if bunkPBID := record.GetString("bunk"); bunkPBID != "" {
			if bunkCMID, ok := s.bunkPBIDToCMID[bunkPBID]; ok && bpCMID > 0 && sessionCMID > 0 {
				key := fmt.Sprintf("%d:%d", bpCMID, bunkCMID)
				s.bunkPlanBunkToSession[key] = sessionCMID
			}
		}

		return nil
	}); err != nil {
		return fmt.Errorf("loading bunk plan sessions: %w", err)
	}
	slog.Info("Loaded bunk plans with session mappings",
		"bunkPlanSessions", len(s.bunkPlanSessionsList),
		"bunkPlanBunkToSession", len(s.bunkPlanBunkToSession))

	// Load bunk staff: person CM IDs for staff with bunk_staff=true
	// These are added to validPersonCMIDs so processAssignment doesn't skip them.
	staffFilter := fmt.Sprintf("bunk_staff = true && year = %d", year)
	if err := s.PaginateRecords("staff", staffFilter, func(record *core.Record) error {
		if personID, ok := record.Get("person_id").(float64); ok && personID > 0 {
			personCMID := int(personID)
			s.staffPersonCMIDs[personCMID] = true
			s.validPersonCMIDs[personCMID] = true
		}
		return nil
	}); err != nil {
		return fmt.Errorf("loading bunk staff: %w", err)
	}
	slog.Info("Loaded bunk staff", "count", len(s.staffPersonCMIDs), "year", year)

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
	assignmentData map[string]any,
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

	// Get CampMinder assignment ID
	var assignmentCMID int
	if id, ok := assignmentData["ID"].(float64); ok {
		assignmentCMID = int(id)
	}

	// Check if assignment already exists using composite key
	year := s.Client.GetSeasonID()
	key := fmt.Sprintf("%d:%d:%d", personCMID, sessionCMID, year)

	recordData := map[string]any{
		"year":  year,
		"cm_id": assignmentCMID, // The assignment's own CampMinder ID
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

// protectThenSweepOrphans marks non-active staff assignments as protected
// before running the orphan sweep, and only runs the sweep if protection
// succeeded.
//
// The ordering is load-bearing, not cosmetic: deleteOrphans removes the
// bunk_assignments this run did not mark as processed, unless OrphanSweepGuard
// refuses the sweep outright for having too small a computed set to believe
// (kindred#2279). If protection fails partway through, the tracking it was
// building is incomplete -- so running the sweep anyway would delete precisely
// the assignments protection exists to save, and only afterward would the run
// report a failure. That reports the damage instead of preventing it. Aborting
// here means a protection failure costs a sync cycle, not the data. See
// kindred#2287.
//
// Both failure branches below are counted and returned, not logged and
// dropped. They are the same event from an operator's point of view -- an
// upstream step came back untrustworthy and rows were therefore not swept --
// and a returned error is what makes Sync() report the run as failed. Counting
// alone does not: the orchestrator derives a run's status from the returned
// error, so a protection failure that only incremented Stats.Errors reported
// success until kindred#2293 lands, and would silently depend on that PR's
// merge order afterwards. staff_applications.go and staff_vehicle_info.go
// return their sweep refusals the same way.
func (s *BunkAssignmentsSync) protectThenSweepOrphans(year int) error {
	if _, err := s.protectNonActiveStaffAssignments(year); err != nil {
		slog.Error("Error protecting non-active staff bunk assignments", "error", err)
		s.Stats.Errors++
		return fmt.Errorf("protecting non-active staff bunk assignments: %w", err)
	}

	if err := s.deleteOrphans(); err != nil {
		slog.Error("Error deleting orphans", "error", err)
		s.Stats.Errors++
		return fmt.Errorf("orphan sweep refused: %w", err)
	}

	return nil
}

// protectNonActiveStaffAssignments marks existing bunk_assignments for non-active
// bunk staff as processed so DeleteOrphans won't remove them. CampMinder strips
// assignments from dismissed/resigned staff API responses, but we preserve them.
//
// bunk_assignments has no person_id column -- the person link is the `person`
// relation, resolved from the CampMinder id (docs/reference/sync-id-conventions.md).
// It returns the number of assignments protected and any error encountered;
// the caller decides how to surface a failure instead of it being swallowed.
func (s *BunkAssignmentsSync) protectNonActiveStaffAssignments(year int) (int, error) {
	nonActiveFilter := fmt.Sprintf("status != 'active' && bunk_staff = true && year = %d", year)
	protectedCount := 0

	if err := s.PaginateRecords("staff", nonActiveFilter, func(staffRecord *core.Record) error {
		personID, ok := staffRecord.Get("person_id").(float64)
		if !ok || personID <= 0 {
			return nil
		}
		personCMID := int(personID)

		// Resolve the person's CampMinder id to their persons PB id so we can
		// filter bunk_assignments on the `person` relation.
		personFilter := fmt.Sprintf("cm_id = %d && year = %d", personCMID, year)
		people, err := s.App.FindRecordsByFilter("persons", personFilter, "", 1, 0)
		if err != nil {
			return fmt.Errorf("resolving person %d: %w", personCMID, err)
		}
		if len(people) == 0 {
			return nil
		}
		personPBID := people[0].Id

		// Find this person's existing bunk_assignments and mark as processed
		baFilter := fmt.Sprintf("year = %d && person = '%s'", year, personPBID)
		bas, err := s.App.FindRecordsByFilter("bunk_assignments", baFilter, "", 0, 0)
		if err != nil {
			return fmt.Errorf("finding bunk assignments for person %d: %w", personCMID, err)
		}
		if len(bas) == 0 {
			return nil
		}

		for _, ba := range bas {
			sessionPBID := ba.GetString("session")
			if sessionPBID == "" {
				continue
			}
			// A query failure and a genuinely absent session are not the same
			// event and must not share a branch. Collapsing them is how this
			// function silently dropped an assignment it was meant to protect:
			// the key was never tracked, protection still reported success, and
			// the sweep below then deleted the row. A missing session stays a
			// non-destructive skip -- deleteOrphans cannot derive a composite
			// key for such a record either, so it is not at risk.
			sessions, err := s.App.FindRecordsByFilter("camp_sessions", fmt.Sprintf("id = '%s'", sessionPBID), "", 1, 0)
			if err != nil {
				return fmt.Errorf("resolving session %q for person %d: %w", sessionPBID, personCMID, err)
			}
			if len(sessions) == 0 {
				continue
			}
			sessionCMID, ok := sessions[0].Get("cm_id").(float64)
			if !ok {
				continue
			}
			key := fmt.Sprintf("%d:%d", personCMID, int(sessionCMID))
			s.TrackProcessedCompositeKey(key, year)
			protectedCount++
		}

		return nil
	}); err != nil {
		return protectedCount, fmt.Errorf("loading non-active staff for bunk assignment protection: %w", err)
	}

	if protectedCount > 0 {
		slog.Info("Protected bunk assignments for non-active staff", "count", protectedCount)
	}

	return protectedCount, nil
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

	return s.DeleteOrphansGuarded(
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
		OrphanSweepGuard{
			Entity:   "bunk_assignments",
			Year:     year,
			Computed: len(s.ProcessedKeys),
			Hint: "check that the CampMinder bunk-assignment feed returned this season (a " +
				"collapsed persons or camp_sessions table shows up as the unkeyable-record " +
				"warning above, not here)",
		},
	)
}
