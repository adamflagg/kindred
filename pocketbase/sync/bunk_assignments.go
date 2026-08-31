// Package sync provides synchronization services between CampMinder and PocketBase
package sync

import (
	"context"
	"errors"
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
	staffPersonCMIDs map[int]bool // person CM IDs where bunk_staff=true
	// "bunkPlanCMID:bunkCMID" → candidate sessionCMIDs. NOT one-to-one
	// (kindred#2264): a bunk_plans row is keyed on (year, bunk, session,
	// cm_id), so one bunk can legitimately be listed under several
	// sessions of the same plan -- every family-camp bunk is. Every
	// candidate is kept; ambiguity is resolved (or reported) at the read
	// sites, resolveViaBunk and resolveStaffSession.
	bunkPlanBunkToSession map[string][]int
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
		bunkPlanBunkToSession: make(map[string][]int),
		bunkPBIDToCMID:        make(map[string]int),
	}
}

// SetDryRun implements the orchestrator's DryRunnable interface (kindred#2351). Declared
// explicitly rather than inherited by embedding BaseSyncService -- see that field's doc
// comment for why a promoted setter is not safe here.
func (s *BunkAssignmentsSync) SetDryRun(dryRun bool) {
	s.DryRun = dryRun
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

	existingAssignments, existingByPersonBunk, err := s.preloadExistingAssignments(year)
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
			s.processResultGroup(result, existingAssignments, existingByPersonBunk, year)
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
	// unresolved_session is named in the completion line, not left to the JSON
	// alone: it is the counter an operator watches to know kindred#2465 has not
	// come back, and LogSyncComplete's own stats string cannot show it.
	s.LogSyncComplete("Bunk assignments", fmt.Sprintf("fetched=%d assignments, unresolved_session=%d",
		totalAssignments, s.Stats.UnresolvedSession))

	return nil
}

// loadMappings loads valid CampMinder IDs from PocketBase
func (s *BunkAssignmentsSync) loadMappings() error {
	slog.Info("Loading valid CampMinder IDs")

	year := s.Client.GetSeasonID()

	// Every map this function builds describes THIS run and is rebuilt from
	// scratch here (kindred#2465). The orchestrator constructs one
	// BunkAssignmentsSync at boot and dispatches every scheduled run to it, so
	// without this the append-shaped maps -- personEnrollments,
	// bunkPlanSessionsList, bunkPlanBunkToSession -- gained a full extra copy of
	// their contents every hour: a (bunkPlan, bunk) pair with ONE bunk_plans row
	// behind it read as two candidates on run 2, resolveStaffSession called that
	// ambiguous, the assignment was skipped without being tracked, and
	// deleteOrphans deleted the row for being untracked. 262 rows for 70 active
	// bunk staff, every hour, restored only by a container restart. The same
	// accumulation silently disabled kindred#2259/#2264's bunk-specific
	// narrowing on the camper path from run 2 onward.
	//
	// It belongs HERE, not in Sync()'s reset block: loadMappings is the only
	// writer of all eight, and bunkPBIDToCMID must be rebuilt before the
	// bunk_plans pass below reads it -- which the existing load order already
	// guarantees. The constructor's make() calls stay: several tests build
	// BunkAssignmentsSync as a struct literal and never call loadMappings.
	// stranded_assignment_cleanup.go's Sync() names the same hazard for Stats.
	s.validPersonCMIDs = make(map[int]bool)
	s.validBunkCMIDs = make(map[int]bool)
	s.validSessionCMIDs = make(map[int]bool)
	s.personEnrollments = make(map[int][]int)
	s.bunkPlanSessionsList = make(map[int][]int)
	s.staffPersonCMIDs = make(map[int]bool)
	s.bunkPlanBunkToSession = make(map[string][]int)
	s.bunkPBIDToCMID = make(map[string]int)

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
	// Also build bunkPlanBunkToSession: "bunkPlanCMID:bunkCMID" -> the list of
	// candidate sessionCMIDs, used to narrow a camper's session by the bunk the
	// assignment names and to resolve (or report as ambiguous) a staff
	// assignment's session. Both mappings are lists, not single values.
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

		// Build bunkPlanBunkToSession: collect every session this (bunkPlan,
		// bunk) pair is associated with -- NOT overwriting. A bunk_plans row
		// is unique on (year, bunk, session, cm_id), so the same bunk can
		// legitimately be listed under several sessions of one plan (every
		// family-camp bunk is, across all 8 of its plan's sessions). This
		// used to keep only whichever row PaginateRecords visited last,
		// silently, which is kindred#2264.
		if bunkPBID := record.GetString("bunk"); bunkPBID != "" {
			if bunkCMID, ok := s.bunkPBIDToCMID[bunkPBID]; ok && bpCMID > 0 && sessionCMID > 0 {
				key := fmt.Sprintf("%d:%d", bpCMID, bunkCMID)
				s.bunkPlanBunkToSession[key] = append(s.bunkPlanBunkToSession[key], sessionCMID)
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

// preloadExistingAssignments loads this year's bunk_assignments rows keyed on
// the full (person, session, bunk, year) composite Sync() writes and
// deleteOrphans reads back (kindred#2259). Extracted out of Sync() so tests
// can drive the same preload path directly without a live CampMinder HTTP
// client.
//
// "bunk" is part of the mapping -- and every key built from it -- because the
// grain of bunk_assignments is (person, session, bunk, year), not (person,
// session, year). A multi-session bunk plan can give one person two
// assignments that resolve through the same session-derivation path; without
// bunk in the key the second write collides with the first and one of the
// two is silently lost. See the write key in processAssignment and the
// orphan key in deleteOrphans -- all three (plus this preload key, the
// fourth of the grain) must move together.
//
// The second return is an index of the same rows by "personCMID:bunkCMID" ->
// the tracking keys ("personCMID:sessionCMID:bunkCMID") they were stored
// under -- the fourth site in this file built on that tracking format,
// alongside processAssignment, protectNonActiveStaffAssignments and the orphan
// key deleteOrphans rebuilds. It exists for the branch that cannot name a
// session (resolveSessionOrTrackUnresolved): person and bunk are the two thirds of the
// grain an unresolved assignment still knows, and this is how it finds the
// stored rows to keep from the sweep (kindred#2465, the kindred#2394 pattern).
func (s *BunkAssignmentsSync) preloadExistingAssignments(
	year int,
) (existing map[string]*core.Record, byPersonBunk map[string][]string, err error) {
	filter := fmt.Sprintf("year = %d", year)

	assignmentMappings, err := s.BuildRecordCMIDMappings("bunk_assignments", filter, map[string]string{
		"person":  "persons",
		"session": "camp_sessions",
		"bunk":    "bunks",
	})
	if err != nil {
		return nil, nil, fmt.Errorf("loading assignment mappings: %w", err)
	}

	byPersonBunk = make(map[string][]string)
	existing, err = s.PreloadCompositeRecords(
		"bunk_assignments", filter, func(record *core.Record) (string, bool) {
			mapping := assignmentMappings[record.Id]
			personCMID := mapping["personCMID"]
			sessionCMID := mapping["sessionCMID"]
			bunkCMID := mapping["bunkCMID"]
			recordYear, _ := record.Get("year").(float64)

			if personCMID > 0 && sessionCMID > 0 && bunkCMID > 0 && recordYear > 0 {
				key := fmt.Sprintf("%d:%d:%d:%d", personCMID, sessionCMID, bunkCMID, int(recordYear))
				personBunk := fmt.Sprintf("%d:%d", personCMID, bunkCMID)
				byPersonBunk[personBunk] = append(byPersonBunk[personBunk],
					fmt.Sprintf("%d:%d:%d", personCMID, sessionCMID, bunkCMID))
				return key, true
			}
			return "", false
		})
	if err != nil {
		return nil, nil, err
	}

	return existing, byPersonBunk, nil
}

// resolveSessionOrTrackUnresolved runs the resolution ladder for one
// CampMinder assignment and, when it comes back with no session, does the
// bookkeeping the skip needs: log the ambiguity, count it somewhere an
// operator can see it, and keep the rows this assignment already has on disk
// out of the orphan sweep. unresolved being true means the caller must skip
// this assignment.
//
// The tracking is the load-bearing half (kindred#2465, the kindred#2394
// pattern). Both skip branches used to `continue` before
// TrackProcessedCompositeKey, so the assignment was absent from ProcessedKeys
// and deleteOrphans read absence as "CampMinder no longer returns this row"
// and deleted it. That is the opposite of what the run observed -- CampMinder
// returned this person in this bunk, the run just could not say which session.
// persons.go's transformPersonToPB skip carries the same patch for the same
// symptom -- "Skipped and orphaned are different facts, and this branch only
// ever meant the first one."
//
// Session is the one third of the (person, session, bunk) grain an unresolved
// assignment does not know, so the keys come from the person:bunk index off
// preloadExistingAssignments -- every stored session for this person in this
// bunk. That is deliberately wider than one row: if a shared bunk gave a
// staffer two stored assignments, an unresolvable run must keep both, because
// it has no basis for choosing between them.
func (s *BunkAssignmentsSync) resolveSessionOrTrackUnresolved(
	personCMID, bunkPlanID, bunkID int,
	bunkPlanSessions []int,
	existingByPersonBunk map[string][]string,
	year int,
) (sessionID int, unresolved bool) {
	sessionID, ambiguous := s.resolveAssignmentSession(personCMID, bunkPlanID, bunkID, bunkPlanSessions)
	if !ambiguous && sessionID != 0 {
		return sessionID, false
	}

	if ambiguous {
		key := fmt.Sprintf("%d:%d", bunkPlanID, bunkID)
		slog.Warn("Ambiguous (bunkPlan, bunk) staff session lookup, skipping assignment",
			"bunkPlanCMID", bunkPlanID, "bunkCMID", bunkID, "personCMID", personCMID,
			"candidateCount", len(distinctSessions(s.bunkPlanBunkToSession[key])))
	}

	// Skipped keeps its existing meaning -- no row was written -- and
	// UnresolvedSession names the subset of it that is a resolution failure
	// rather than an unchanged row. See Stats.UnresolvedSession for why one
	// counter could not do both jobs.
	s.Stats.Skipped++
	s.Stats.UnresolvedSession++

	for _, trackingKey := range existingByPersonBunk[fmt.Sprintf("%d:%d", personCMID, bunkID)] {
		s.TrackProcessedCompositeKey(trackingKey, year)
	}

	return 0, true
}

// findMatchingSession finds the session that a person is enrolled in that also belongs to the bunk plan.
// CampMinder assignments don't include session ID - we must derive it by intersecting:
// - The sessions the person is enrolled in (from attendees)
// - The sessions the bunk plan applies to (from bunk_plans)
// Returns the first matching session ID, or 0 if no match found.
//
// This is the PLAN-WIDE fallback, used when resolveViaBunk cannot narrow the
// candidates using the specific bunk on this assignment (kindred#2259). It is
// deliberately imprecise in exactly the case it always was: when a bunk is
// shared across every session of its plan (the family plan) and the person
// is enrolled in more than one of those sessions, this returns the first
// intersecting session for every assignment that person holds under the
// plan, regardless of which bunk each one names. Widening the storage grain
// to include bunk (see processAssignment) means both assignments still
// survive as separate rows even though this function alone cannot tell them
// apart -- per-bunk disambiguation "cannot be made to work for the family
// plan" (kindred#2259's Fix direction), so this fallback intentionally does
// not try.
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

// resolveViaBunk narrows a camper's session candidates to the ones the
// SPECIFIC bunk on this assignment is associated with under the plan
// (s.bunkPlanBunkToSession, kindred#2264), intersected with the sessions the
// person is actually enrolled in. It reports a session only when that
// narrowing is unambiguous -- exactly one session that is both a candidate
// for this bunk and one the person is enrolled in.
//
// This is precise whenever a bunk pins to fewer sessions than the whole
// plan -- e.g. a main+AG plan, where main and AG bunks are disjoint sets, so
// each bunk's own candidate list already has only one session in it. It
// deliberately reports no match when the bunk is shared across every
// session of its plan (the family plan): the candidate list is then as long
// as the plan's whole session list, narrows nothing, and resolution falls
// back to the plan-wide findMatchingSession instead of guessing which of
// several equally-valid sessions this bunk-specific assignment belongs to.
func (s *BunkAssignmentsSync) resolveViaBunk(personSessions []int, bunkPlanID, bunkID int) (int, bool) {
	key := fmt.Sprintf("%d:%d", bunkPlanID, bunkID)
	candidates := s.bunkPlanBunkToSession[key]
	if len(candidates) == 0 {
		return 0, false
	}

	personSessionSet := make(map[int]bool, len(personSessions))
	for _, sessionID := range personSessions {
		personSessionSet[sessionID] = true
	}

	// DISTINCT sessions, not candidate occurrences (kindred#2465). On a clean
	// run this changes nothing -- see distinctSessions for why a duplicate
	// inside one map key is a bug rather than data. What it buys is that a
	// RECURRENCE of the run-to-run accumulation degrades into the right answer:
	// counting occurrences is what made a bunk listed under a single session
	// look like two competing answers, silently dropping this narrowing in
	// favor of the plan-wide fallback from run 2 onward.
	match := 0
	matched := make(map[int]bool, len(candidates))
	for _, sessionID := range candidates {
		if personSessionSet[sessionID] {
			match = sessionID
			matched[sessionID] = true
		}
	}
	if len(matched) == 1 {
		return match, true
	}
	return 0, false
}

// distinctSessions returns the candidate session CM IDs with duplicates
// removed, preserving first-seen order.
//
// On a clean run it is a NO-OP, and saying so plainly is the point.
// bunkPlanBunkToSession is keyed "bunkPlanCMID:bunkCMID", and bunk_plans
// carries a unique index on (year, bunk, session, cm_id) -- see
// pb_migrations/1500000017_bunk_plans.js -- so the rows behind any ONE map key
// differ only in session. Within a key the same session cannot legitimately
// repeat: a duplicate there is not data, it is a bug.
//
// It exists as defense against a RECURRENCE of that bug. kindred#2465 was one
// instance reused across scheduled runs with append-only maps, so every hour
// added another copy of every candidate; a read site that decides on how many
// ENTRIES there are rather than how many DIFFERENT sessions they name mistakes
// that accumulation for ambiguity, and for bunk staff that meant an untracked
// skip and a deleted row. Rebuilding the maps per run (loadMappings) removed
// the cause; this keeps the read sites correct either way.
//
// Deduping here rather than at the build site is still deliberate, but the
// reason is the SIBLING map, not this one: bunkPlanSessionsList legitimately
// holds one entry per bunk_plans row, which
// TestLoadMappings_KeepsEveryCandidateSessionForASharedBunk pins as [A, A, B]
// for a plan whose shared bunk spans two sessions. That same test pins
// bunkPlanBunkToSession duplicate-FREE ([A, B]) for that bunk. Nothing here
// licenses the build site to start emitting duplicates it does not emit today.
func distinctSessions(candidates []int) []int {
	if len(candidates) < 2 {
		return candidates
	}
	seen := make(map[int]bool, len(candidates))
	out := make([]int, 0, len(candidates))
	for _, sessionID := range candidates {
		if seen[sessionID] {
			continue
		}
		seen[sessionID] = true
		out = append(out, sessionID)
	}
	return out
}

// resolveStaffSession looks up the session(s) a specific (bunkPlan, bunk)
// pair is associated with, for staff -- who are not in attendees, so there
// is no enrollment to intersect against the way resolveViaBunk does for
// campers. It reports the session only when exactly one candidate exists;
// ambiguous is true when there is more than one, so the caller can skip and
// warn instead of guessing. kindred#2264: the map this reads used to
// silently keep whichever bunk_plans row was written last, so a bunk shared
// across several sessions of one plan resolved every staff member on it to
// an arbitrary session with no error and no log line.
func (s *BunkAssignmentsSync) resolveStaffSession(bunkPlanID, bunkID int) (sessionID int, ambiguous bool) {
	key := fmt.Sprintf("%d:%d", bunkPlanID, bunkID)
	// DISTINCT, not len(candidates) (kindred#2465): the raw list holds one entry
	// per bunk_plans row, so before the map was rebuilt per run this switch was
	// reading the number of syncs since boot rather than anything in the
	// database, and reported every staff assignment in the season ambiguous from
	// run 2 onward. Rebuilding the map fixed the cause; deciding on distinct
	// sessions is what makes this switch mean what it says either way.
	candidates := distinctSessions(s.bunkPlanBunkToSession[key])
	switch len(candidates) {
	case 0:
		return 0, false
	case 1:
		return candidates[0], false
	default:
		return 0, true
	}
}

// resolveAssignmentSession is the full session-resolution ladder applied to
// one CampMinder assignment (personCMID, under bunkPlanID, in bunkID):
//
//  1. Camper path, narrow: resolveViaBunk, using the specific bunk this
//     assignment names (kindred#2259/#2264).
//  2. Camper path, plan-wide fallback: findMatchingSession, unchanged from
//     before this pair of fixes.
//  3. Staff fallback: resolveStaffSession, only reached if steps 1-2 found
//     nothing -- staff are not in attendees, so personSessions is always
//     empty for them and neither camper path can ever match.
//
// ambiguous is true only when step 3 finds more than one candidate session;
// the caller must skip that assignment rather than guess (kindred#2264).
func (s *BunkAssignmentsSync) resolveAssignmentSession(
	personCMID, bunkPlanID, bunkID int, bunkPlanSessions []int,
) (sessionID int, ambiguous bool) {
	personSessions := s.personEnrollments[personCMID]

	if sid, ok := s.resolveViaBunk(personSessions, bunkPlanID, bunkID); ok {
		return sid, false
	}

	if sid := s.findMatchingSession(personSessions, bunkPlanSessions); sid != 0 {
		return sid, false
	}

	if s.staffPersonCMIDs[personCMID] {
		return s.resolveStaffSession(bunkPlanID, bunkID)
	}

	return 0, false
}

// processResultGroup handles one entry of a CampMinder bunk-assignments page:
// the (bunkPlan, bunk) pair and every assignment CampMinder returned for it.
//
// It is a method rather than an inline block so the group-level skips below
// are reachable from a test. Client is a concrete *campminder.Client, so
// Sync() itself cannot be driven without an HTTP fake, and the skips are
// precisely the branches kindred#2465 showed nobody was pinning.
func (s *BunkAssignmentsSync) processResultGroup(
	result map[string]any,
	existingAssignments map[string]*core.Record,
	existingByPersonBunk map[string][]string,
	year int,
) {
	// The three shape checks below are the only skips in this file that stay
	// untracked, and they are the one case where that is right: a result with
	// no BunkID, no BunkPlanID or no Assignments array names no person and no
	// bunk, so there is no key to keep from the sweep and nothing to count
	// against a grain. Every skip that DOES know a person and a bunk goes
	// through resolveSessionOrTrackUnresolved instead.
	bunkIDFloat, ok := result["BunkID"].(float64)
	if !ok {
		slog.Warn("Missing or invalid BunkID in result")
		return
	}
	bunkID := int(bunkIDFloat)

	bunkPlanIDFloat, ok := result["BunkPlanID"].(float64)
	if !ok {
		slog.Warn("Missing or invalid BunkPlanID in result")
		return
	}
	bunkPlanID := int(bunkPlanIDFloat)

	// Get the assignments array from this result
	assignmentsArray, ok := result["Assignments"].([]any)
	if !ok {
		slog.Warn("No Assignments array in result")
		return
	}

	// Get the list of sessions this bunk plan applies to. Warned once for the
	// group, but deliberately NOT skipped as a group (kindred#2465): dropping
	// the whole (bunkPlan, bunk) pair here is the same untracked-skip mechanism
	// the wrapper below exists to close, only a group at a time -- every
	// assignment under it would be missing from ProcessedKeys and deleteOrphans
	// would read that absence as "CampMinder dropped these rows".
	//
	// Falling through cannot write a row to the wrong session: loadMappings
	// gates bunkPlanSessionsList and bunkPlanBunkToSession on the same
	// `bpCMID > 0 && sessionCMID > 0`, so an empty plan-session list guarantees
	// an empty candidate list too, and every step of the resolution ladder
	// fails. Each assignment therefore lands in the unresolved branch, which is
	// the honest place for it.
	bunkPlanSessions := s.bunkPlanSessionsList[bunkPlanID]
	if len(bunkPlanSessions) == 0 {
		slog.Warn("No sessions found for bunk plan, every assignment under it is unresolved",
			"bunkPlanID", bunkPlanID, "bunkCMID", bunkID, "assignments", len(assignmentsArray))
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

		// Find the correct session. See resolveAssignmentSession for the
		// full ladder; ambiguous is only ever true on the staff path,
		// where a (bunkPlan, bunk) key has more than one candidate
		// session and guessing would be worse than skipping (kindred#2264).
		// Both no-session outcomes go through one wrapper because both
		// owe the same bookkeeping before they skip -- counting the
		// failure where it can be seen, and keeping the assignment's
		// stored rows out of the orphan sweep (kindred#2465).
		sessionID, unresolved := s.resolveSessionOrTrackUnresolved(
			personCMID, bunkPlanID, bunkID, bunkPlanSessions, existingByPersonBunk, year)
		if unresolved {
			continue
		}

		// Add BunkID, BunkPlanID, and SessionID to the assignment data
		assignmentData["BunkID"] = float64(bunkID)
		assignmentData["BunkPlanID"] = float64(bunkPlanID)
		assignmentData["SessionID"] = float64(sessionID)

		if err := s.processAssignment(assignmentData, existingAssignments); err != nil {
			if errors.Is(err, errRejectedRecord) {
				slog.Warn("Rejected assignment", "error", err)
				s.Stats.Rejected++
			} else {
				slog.Error("Error processing assignment", "error", err)
				s.Stats.Errors++
			}
		}
	}
}

// processAssignment processes a single bunk assignment using pre-loaded existing assignments
func (s *BunkAssignmentsSync) processAssignment(
	assignmentData map[string]any,
	existingAssignments map[string]*core.Record,
) error {
	// Extract required fields. A missing field here is malformed upstream data,
	// not an infrastructure failure -- kindred#2292.
	personID, ok := assignmentData["PersonID"].(float64)
	if !ok {
		return fmt.Errorf("%w: missing PersonID", errRejectedRecord)
	}

	sessionID, ok := assignmentData["SessionID"].(float64)
	if !ok {
		return fmt.Errorf("%w: missing SessionID", errRejectedRecord)
	}

	bunkID, ok := assignmentData["BunkID"].(float64)
	if !ok {
		return fmt.Errorf("%w: missing BunkID", errRejectedRecord)
	}

	bunkPlanID, ok := assignmentData["BunkPlanID"].(float64)
	if !ok {
		return fmt.Errorf("%w: missing BunkPlanID", errRejectedRecord)
	}

	personCMID := int(personID)
	sessionCMID := int(sessionID)
	bunkCMID := int(bunkID)
	bunkPlanCMID := int(bunkPlanID)

	// Track this assignment as processed using base class tracking. The key
	// includes bunk (kindred#2259), and FOUR sites now build that same
	// person:session:bunk tracking format: this one, the ORPHAN key
	// deleteOrphans rebuilds, the one protectNonActiveStaffAssignments writes
	// for protected non-active staff, and -- since kindred#2465 -- the values
	// preloadExistingAssignments indexes by person:bunk, which
	// resolveSessionOrTrackUnresolved re-tracks when a run cannot name the
	// session. All four must move together, or a run after this one deletes
	// the very rows this widening exists to keep.
	s.TrackProcessedCompositeKey(fmt.Sprintf("%d:%d:%d", personCMID, sessionCMID, bunkCMID), s.Client.GetSeasonID())

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

	// Check if assignment already exists using composite key. bunk is part
	// of the grain (kindred#2259): a multi-session bunk plan can give one
	// person two assignments that resolve to the same session (see
	// findMatchingSession's doc comment), and without bunk in the key the
	// second write collides with the first under the unique index and one
	// row is silently lost.
	year := s.Client.GetSeasonID()
	key := fmt.Sprintf("%d:%d:%d:%d", personCMID, sessionCMID, bunkCMID, year)

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

			// bunk is part of the grain (kindred#2259) and the same
			// query-failure-vs-absence distinction applies to it as to
			// session above: a lookup error must abort, a genuinely missing
			// bunk relation is a non-destructive skip.
			bunkPBID := ba.GetString("bunk")
			if bunkPBID == "" {
				continue
			}
			bunks, err := s.App.FindRecordsByFilter("bunks", fmt.Sprintf("id = '%s'", bunkPBID), "", 1, 0)
			if err != nil {
				return fmt.Errorf("resolving bunk %q for person %d: %w", bunkPBID, personCMID, err)
			}
			if len(bunks) == 0 {
				continue
			}
			bunkCMID, ok := bunks[0].Get("cm_id").(float64)
			if !ok {
				continue
			}

			key := fmt.Sprintf("%d:%d:%d", personCMID, int(sessionCMID), int(bunkCMID))
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

	// First, load mappings for all assignments. "bunk" is part of the grain
	// (kindred#2259) -- see the matching comment on the preload mapping in
	// Sync(). A widened key that cannot be reconstructed for an existing row
	// (bunkCMID == 0) must fail to key, not silently fall back to the old
	// narrower key: that would present as an orphan under the new key format
	// while never matching anything protectNonActiveStaffAssignments or
	// processAssignment tracked, and get deleted.
	assignmentMappings, err := s.BuildRecordCMIDMappings("bunk_assignments", filter, map[string]string{
		"person":  "persons",
		"session": "camp_sessions",
		"bunk":    "bunks",
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
			bunkCMID := mapping["bunkCMID"]
			yearValue := record.Get("year")

			if personCMID > 0 && sessionCMID > 0 && bunkCMID > 0 {
				// Build composite key with year
				year, ok := yearValue.(float64)
				if !ok {
					return "", false
				}
				// For composite records, append year to the composite key.
				// This must match TrackProcessedCompositeKey's format exactly
				// (person:session:bunk, then "|" + year). Three sites feed that
				// format in: processAssignment, protectNonActiveStaffAssignments,
				// and preloadExistingAssignments' person:bunk index, whose values
				// resolveSessionOrTrackUnresolved re-tracks for an assignment it
				// could not resolve (kindred#2465). Change the shape in one and
				// the other three stop matching -- which reads here as an orphan.
				key := fmt.Sprintf("%d:%d:%d|%d", personCMID, sessionCMID, bunkCMID, int(year))
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
