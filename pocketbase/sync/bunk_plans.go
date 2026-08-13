// Package sync provides synchronization services between CampMinder and PocketBase
package sync

import (
	"context"
	"fmt"
	"log/slog"
	"slices"
	"strings"

	"github.com/camp/kindred/pocketbase/campminder"
	"github.com/pocketbase/pocketbase/core"
)

// BunkPlansSync handles syncing bunk plan records from CampMinder
type BunkPlansSync struct {
	BaseSyncService

	// Cache valid CampMinder IDs
	validBunkCMIDs    map[int]bool
	validSessionCMIDs map[int]bool

	// Bunk info for filtering: cm_id -> name
	bunkNames map[int]string

	// Session info for filtering: cm_id -> {name, session_type}
	sessionInfo map[int]sessionInfoData

	// Track existing bunk plans for orphan detection
	existingPlans map[string]*core.Record // key: "bunk_id:session_id"

	// Track templates vs expanded assignments
	totalTemplates   int
	totalAssignments int
	skippedAGPlans   int // Track filtered AG bunk_plans
}

// sessionInfoData holds session metadata for filtering
type sessionInfoData struct {
	Name        string
	SessionType string
}

// NewBunkPlansSync creates a new bunk plans sync service
func NewBunkPlansSync(app core.App, client *campminder.Client) *BunkPlansSync {
	return &BunkPlansSync{
		BaseSyncService:   NewBaseSyncService(app, client),
		validBunkCMIDs:    make(map[int]bool),
		validSessionCMIDs: make(map[int]bool),
		bunkNames:         make(map[int]string),
		sessionInfo:       make(map[int]sessionInfoData),
		existingPlans:     make(map[string]*core.Record),
	}
}

// Name returns the name of this sync service
func (s *BunkPlansSync) Name() string {
	return "bunk_plans"
}

// Sync performs the bunk plans synchronization
func (s *BunkPlansSync) Sync(ctx context.Context) error {
	s.LogSyncStart("bunk plans")
	s.Stats = Stats{}        // Reset stats
	s.SyncSuccessful = false // Reset sync status
	s.ClearProcessedKeys()   // Reset processed tracking
	s.skippedAGPlans = 0     // Reset AG skip counter

	// Load mappings first
	if err := s.loadMappings(); err != nil {
		return fmt.Errorf("loading mappings: %w", err)
	}

	// Fetch and process bunk plans
	if err := s.syncBunkPlans(ctx); err != nil {
		return fmt.Errorf("syncing bunk plans: %w", err)
	}

	// Delete orphaned bunk plans
	if err := s.deleteOrphans(); err != nil {
		slog.Error("Error deleting orphans", "error", err)
	}

	// Force WAL checkpoint to ensure data is flushed
	if err := s.ForceWALCheckpoint(); err != nil {
		slog.Warn("WAL checkpoint failed", "error", err)
		// Don't fail the sync if checkpoint fails
	}

	s.LogSyncCompleteWithExpansion("Bunk plans", s.totalTemplates, s.totalAssignments)

	return nil
}

// loadMappings loads valid CampMinder IDs from PocketBase
func (s *BunkPlansSync) loadMappings() error {
	// Load bunks using utility - also capture names for AG filtering
	if err := s.PaginateRecords("bunks", "", func(record *core.Record) error {
		if cmID, ok := record.Get("cm_id").(float64); ok && cmID > 0 {
			s.validBunkCMIDs[int(cmID)] = true
			// Also store name for AG filtering
			if name := record.GetString("name"); name != "" {
				s.bunkNames[int(cmID)] = name
			}
		}
		return nil
	}); err != nil {
		return fmt.Errorf("loading bunks: %w", err)
	}
	slog.Info("Loaded bunks with names", "count", len(s.bunkNames))

	// Load sessions using utility - also capture name and type for AG filtering
	year := s.Client.GetSeasonID()
	sessionFilter := fmt.Sprintf("year = %d", year)
	if err := s.PaginateRecords("camp_sessions", sessionFilter, func(record *core.Record) error {
		if cmID, ok := record.Get("cm_id").(float64); ok && cmID > 0 {
			s.validSessionCMIDs[int(cmID)] = true
			// Also store name and type for AG filtering
			s.sessionInfo[int(cmID)] = sessionInfoData{
				Name:        record.GetString("name"),
				SessionType: record.GetString("session_type"),
			}
		}
		return nil
	}); err != nil {
		return fmt.Errorf("loading sessions: %w", err)
	}
	slog.Info("Loaded sessions with metadata", "count", len(s.sessionInfo))

	// Load existing bunk plans using composite key utility
	// We need to look up the CM IDs from the related records
	planMappings, err := s.BuildRecordCMIDMappings("bunk_plans", "", map[string]string{
		"bunk":    "bunks",
		"session": "camp_sessions",
	})
	if err != nil {
		return fmt.Errorf("loading plan mappings: %w", err)
	}

	// Now load existing plans with proper composite keys
	s.existingPlans, err = s.PreloadCompositeRecords("bunk_plans", "", func(record *core.Record) (string, bool) {
		mapping := planMappings[record.Id]
		bunkCMID := mapping["bunkCMID"]
		sessionCMID := mapping["sessionCMID"]

		if bunkCMID > 0 && sessionCMID > 0 {
			// Include plan CM ID in the key to handle multiple plans per session
			planCMID, _ := record.Get("cm_id").(float64)
			key := fmt.Sprintf("%d:%d:%d", int(planCMID), bunkCMID, sessionCMID)
			return key, true
		}
		return "", false
	})
	if err != nil {
		return fmt.Errorf("loading existing plans: %w", err)
	}

	slog.Info("Loaded existing bunk plans", "count", len(s.existingPlans))
	return nil
}

// pairAGBunksToSessions decides which AG session each AG bunk in a plan maps to.
//
// CampMinder's plan payload is two flat lists (BunkIDs, SessionIDs) with no
// per-bunk pairing, so the sync must decide. The AG bunk's cabin number is a
// physical location in the unit layout (5-6 Eilat, 7-8 Haifa, 9-10 Chalutzim 1
// — see frontend/src/utils/unitMapping.ts), NOT a grade, so no grade matching
// is possible (kindred#1749: AG-6 hosting the 7th/8th-grade AG session).
//
// Rules:
//   - one AG session in the plan (every year since 2026): all AG bunks map to it
//   - multiple AG sessions: deterministic pairing, sorted bunk cm_id ⇄ sorted
//     session cm_id, leftover bunks onto the last session. Sibling AG sessions
//     always share the same parent session (same bunking board), so a
//     provisional pairing is display-equivalent before assignments exist —
//     and camper assignments resolve to each camper's own enrolled AG session
//     regardless (see findMatchingSession in bunk_assignments.go). Staff
//     assignments lack enrollments and resolve via bunkPlanBunkToSession, so
//     they DO trust this pairing — in a multi-AG-session year a staff row can
//     land on the sibling session (accepted; matches pre-#1749-fix behavior).
//
// Only bunks/sessions known to PocketBase participate; returns an empty map
// when the plan has no AG sessions. An AG session left without any paired
// bunk gets no bunk_plans rows — the caller warns when that happens.
func pairAGBunksToSessions(
	bunkCMIDs, sessionCMIDs []int,
	bunkNames map[int]string,
	sessionInfo map[int]sessionInfoData,
) map[int]int {
	agSessions := make([]int, 0, len(sessionCMIDs))
	for _, id := range sessionCMIDs {
		if info, ok := sessionInfo[id]; ok && info.SessionType == "ag" {
			agSessions = append(agSessions, id)
		}
	}

	pairing := make(map[int]int)
	if len(agSessions) == 0 {
		return pairing
	}
	slices.Sort(agSessions)

	agBunks := make([]int, 0, len(bunkCMIDs))
	for _, id := range bunkCMIDs {
		if name, ok := bunkNames[id]; ok && isAGBunk(name) {
			agBunks = append(agBunks, id)
		}
	}
	slices.Sort(agBunks)

	for i, bunkCMID := range agBunks {
		if i < len(agSessions) {
			pairing[bunkCMID] = agSessions[i]
		} else {
			pairing[bunkCMID] = agSessions[len(agSessions)-1]
		}
	}
	return pairing
}

// toCMIDSlice converts a raw JSON ID list ([]any of float64/int) to []int
func toCMIDSlice(raw []any) []int {
	ids := make([]int, 0, len(raw))
	for _, v := range raw {
		switch n := v.(type) {
		case float64:
			ids = append(ids, int(n))
		case int:
			ids = append(ids, n)
		}
	}
	return ids
}

// isAGBunk checks if a bunk is an All-Gender bunk based on its name
func isAGBunk(bunkName string) bool {
	upperName := strings.ToUpper(bunkName)
	return strings.Contains(upperName, "AG-") ||
		strings.HasPrefix(upperName, "AG ") ||
		strings.Contains(upperName, "ALL-GENDER") ||
		strings.Contains(upperName, "ALL GENDER")
}

// syncBunkPlans fetches and syncs all bunk plans
func (s *BunkPlansSync) syncBunkPlans(ctx context.Context) error {
	page := 1
	// CampMinder API appears to have a limit of 10 for bunk plans
	pageSize := SmallPageSize
	totalTemplates := 0
	totalAssignments := 0

	for {
		// Check context cancellation
		select {
		case <-ctx.Done():
			return fmt.Errorf("bunk plans sync cancelled: %w", ctx.Err())
		default:
		}

		// Fetch page of bunk plans
		slog.Info("Fetching bunk plans page", "page", page, "pageSize", pageSize)
		plans, hasMore, err := s.Client.GetBunkPlansPage(page, pageSize)
		if err != nil {
			return fmt.Errorf("fetching page %d: %w", page, err)
		}

		slog.Info("Processing bunk plans page", "page", page, "count", len(plans), "hasMore", hasMore)

		// Mark sync as successful once we've successfully fetched data
		if page == 1 && len(plans) > 0 {
			s.SyncSuccessful = true
		}

		// Process each plan
		for _, plan := range plans {
			assignmentsCreated, err := s.processBunkPlan(plan)
			if err != nil {
				slog.Error("Error processing bunk plan", "error", err)
				s.Stats.Errors++
			}
			totalTemplates++
			totalAssignments += assignmentsCreated
		}

		if !hasMore || len(plans) == 0 {
			break
		}
		page++
	}

	// Store counts for use in completion log
	s.totalTemplates = totalTemplates
	s.totalAssignments = totalAssignments

	slog.Info("Bunk plans fetch complete",
		"templates", totalTemplates,
		"assignments", totalAssignments,
		"skippedAGMismatches", s.skippedAGPlans,
	)
	return nil
}

// processBunkPlan processes a single bunk plan record and returns the number of assignments created
func (s *BunkPlansSync) processBunkPlan(planData map[string]any) (int, error) {
	planID, _ := planData["ID"].(float64)
	bunkIDs, _ := planData["BunkIDs"].([]any)
	sessionIDs, _ := planData["SessionIDs"].([]any)

	// Extract name and code fields
	name, _ := planData["Name"].(string)
	code, _ := planData["Code"].(string)

	// Extract IsActive (defaults to true if not present)
	isActive := true
	if val, ok := planData["IsActive"].(bool); ok {
		isActive = val
	}

	assignmentsCreated := 0

	if len(bunkIDs) == 0 || len(sessionIDs) == 0 {
		s.DebugLog("Skipping bunk plan template: empty bunkIDs or sessionIDs",
			"plan_id", int(planID),
			"name", name,
			"bunk_count", len(bunkIDs),
			"session_count", len(sessionIDs))
		s.Stats.Skipped++
		return 0, nil
	}

	// Convert raw ID lists up front — the AG pairing needs whole-plan visibility
	bunkCMIDs := toCMIDSlice(bunkIDs)
	sessionCMIDs := toCMIDSlice(sessionIDs)

	// Decide which AG session each AG bunk belongs to (kindred#1749)
	agPairing := pairAGBunksToSessions(bunkCMIDs, sessionCMIDs, s.bunkNames, s.sessionInfo)

	// An AG session with no paired AG bunk gets zero bunk_plans rows and drops
	// out of downstream session resolution (bunkPlanSessionsList) — the same
	// silent-blackhole shape #1749 fixed. Can't pair what isn't there, so warn.
	agSessionCount := 0
	for _, sessionCMID := range sessionCMIDs {
		if info, ok := s.sessionInfo[sessionCMID]; ok && info.SessionType == "ag" {
			agSessionCount++
		}
	}
	pairedSessions := make(map[int]bool, len(agPairing))
	for _, sessionCMID := range agPairing {
		pairedSessions[sessionCMID] = true
	}
	if agSessionCount > len(pairedSessions) {
		slog.Warn("Plan has more AG sessions than AG bunks; unpaired AG sessions get no bunk_plans rows",
			"plan_id", int(planID),
			"plan_name", name,
			"ag_sessions", agSessionCount,
			"ag_bunks_paired", len(pairedSessions))
	}

	// Create a bunk plan for each bunk-session combination
	for _, bunkCMID := range bunkCMIDs {
		// Validate bunk exists
		if !s.validBunkCMIDs[bunkCMID] {
			s.DebugLog("Skipping bunk plan: bunk not in PocketBase",
				"plan_id", int(planID),
				"bunk_cm_id", bunkCMID)
			s.Stats.Skipped++
			continue
		}

		bunkIsAG := isAGBunk(s.bunkNames[bunkCMID])

		for _, sessionCMID := range sessionCMIDs {
			// Validate session exists
			if !s.validSessionCMIDs[sessionCMID] {
				s.DebugLog("Skipping bunk plan: session not in PocketBase",
					"plan_id", int(planID),
					"bunk_cm_id", bunkCMID,
					"session_cm_id", sessionCMID)
				s.Stats.Skipped++
				continue
			}

			// AG filtering: AG sessions take exactly the AG bunk(s) paired to
			// them by pairAGBunksToSessions; main sessions never take AG bunks
			// (those reach the board via the AG child session).
			sessionData := s.sessionInfo[sessionCMID]

			if sessionData.SessionType == "ag" {
				if agPairing[bunkCMID] != sessionCMID {
					// Non-AG bunk, or AG bunk paired to a sibling AG session
					s.skippedAGPlans++
					continue
				}
			} else if sessionData.SessionType == sessionTypeMain && bunkIsAG {
				// Main session should not include AG bunks (they go through AG sessions)
				s.skippedAGPlans++
				continue
			}

			// Create bunk plan record with name, code, and is_active
			if err := s.createBunkPlan(int(planID), bunkCMID, sessionCMID, name, code, isActive); err != nil {
				return assignmentsCreated, err
			}
			assignmentsCreated++
		}
	}

	return assignmentsCreated, nil
}

// createBunkPlan creates or updates a single bunk plan record
func (s *BunkPlansSync) createBunkPlan(planID, bunkCMID, sessionCMID int, name, code string, isActive bool) error {
	year := s.Client.GetSeasonID()
	// Include plan ID in the key to handle multiple plans per session
	key := fmt.Sprintf("%d:%d:%d", planID, bunkCMID, sessionCMID)

	// Track this plan as processed using base class tracking
	s.TrackProcessedCompositeKey(key, year)

	// Prepare data for the record
	recordData := map[string]any{
		"year":      year,
		"cm_id":     planID, // The plan's own CampMinder ID
		"name":      name,
		"code":      code,
		"is_active": isActive,
	}

	// Populate relations - both are required for a valid bunk plan
	relations := []RelationConfig{
		{FieldName: "bunk", Collection: "bunks", CMID: bunkCMID, Required: true},
		{FieldName: "session", Collection: "camp_sessions", CMID: sessionCMID, Required: true},
	}

	if err := s.PopulateRelations(recordData, relations); err != nil {
		slog.Warn("Skipping bunk plan due to missing relations", "error", err)
		s.Stats.Skipped++
		return nil
	}

	// Use ProcessCompositeRecord utility
	// Skip year from comparison since it's part of the composite key
	skipFields := []string{"year"}
	if err := s.ProcessCompositeRecord("bunk_plans", key, recordData, s.existingPlans, skipFields); err != nil {
		return err
	}

	// If this was a new record, add it to cache for future lookups
	yearScopedKey := fmt.Sprintf("%s|%d", key, year)
	if existing := s.existingPlans[yearScopedKey]; existing == nil {
		// Fetch the newly created record to add to cache
		// Use the relation fields to find the record
		filter := fmt.Sprintf("bunk = '%s' && session = '%s' && year = %d", recordData["bunk"], recordData["session"], year)
		records, err := s.App.FindRecordsByFilter("bunk_plans", filter, "", 1, 0)
		if err == nil && len(records) > 0 {
			s.existingPlans[yearScopedKey] = records[0]
		}
	}

	return nil
}

// deleteOrphans deletes bunk plans that exist in PocketBase but weren't in CampMinder
func (s *BunkPlansSync) deleteOrphans() error {
	year := s.Client.GetSeasonID()
	filter := fmt.Sprintf("year = %d", year)

	// First, load mappings for all plans
	planMappings, err := s.BuildRecordCMIDMappings("bunk_plans", filter, map[string]string{
		"bunk":    "bunks",
		"session": "camp_sessions",
	})
	if err != nil {
		return fmt.Errorf("loading mappings for orphan detection: %w", err)
	}

	return s.DeleteOrphansGuarded(
		"bunk_plans",
		func(record *core.Record) (string, bool) {
			mapping := planMappings[record.Id]
			bunkCMID := mapping["bunkCMID"]
			sessionCMID := mapping["sessionCMID"]
			yearValue := record.Get("year")

			if bunkCMID > 0 && sessionCMID > 0 {
				// Get plan CM ID
				planCMID, _ := record.Get("cm_id").(float64)
				// Build composite key with year
				year, ok := yearValue.(float64)
				if !ok {
					return "", false
				}
				// Build the same format that DeleteOrphans expects (key|year)
				key := fmt.Sprintf("%d:%d:%d|%d", int(planCMID), bunkCMID, sessionCMID, int(year))
				return key, true
			}
			return "", false
		},
		"bunk plan",
		filter,
		OrphanSweepGuard{
			Entity:   "bunk_plans",
			Year:     year,
			Computed: len(s.ProcessedKeys),
			Hint:     "check the bunks and camp_sessions tables for that year -- the plan keys are built from both",
		},
	)
}
