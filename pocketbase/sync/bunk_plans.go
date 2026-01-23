// Package sync provides synchronization services between CampMinder and PocketBase
package sync

import (
	"context"
	"fmt"
	"log/slog"
	"regexp"
	"strconv"
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

// extractGradeRange extracts grade range from a name.
// Returns (min, max) grade numbers. For single grades, min == max.
// Returns (0, 0) if no grades found.
func extractGradeRange(name string) (minGrade, maxGrade int) {
	// Pattern 1: "X/Y" format (e.g., "9/10", "7/8")
	slashPattern := regexp.MustCompile(`(\d+)/(\d+)`)
	if matches := slashPattern.FindStringSubmatch(name); len(matches) >= 3 {
		minGrade, _ = strconv.Atoi(matches[1])
		maxGrade, _ = strconv.Atoi(matches[2])
		return minGrade, maxGrade
	}

	// Pattern 2: "Xth - Yth" or "X & Y" format (e.g., "7th - 9th", "9th & 10th")
	rangePattern := regexp.MustCompile(`(\d+)(?:st|nd|rd|th)?\s*[-–&]\s*(\d+)(?:st|nd|rd|th)?`)
	if matches := rangePattern.FindStringSubmatch(name); len(matches) >= 3 {
		minGrade, _ = strconv.Atoi(matches[1])
		maxGrade, _ = strconv.Atoi(matches[2])
		return minGrade, maxGrade
	}

	// Pattern 3: Single number after "AG-" or "AG " (e.g., "AG-8", "AG 10")
	singlePattern := regexp.MustCompile(`AG[-\s](\d+)`)
	if matches := singlePattern.FindStringSubmatch(name); len(matches) >= 2 {
		grade, _ := strconv.Atoi(matches[1])
		return grade, grade
	}

	return 0, 0
}

// gradeInRange checks if a grade is within a range (inclusive)
func gradeInRange(grade, minGrade, maxGrade int) bool {
	return grade >= minGrade && grade <= maxGrade
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
			return ctx.Err()
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
func (s *BunkPlansSync) processBunkPlan(planData map[string]interface{}) (int, error) {
	planID, _ := planData["ID"].(float64)
	bunkIDs, _ := planData["BunkIDs"].([]interface{})
	sessionIDs, _ := planData["SessionIDs"].([]interface{})

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
		s.Stats.Skipped++
		return 0, nil
	}

	// Create a bunk plan for each bunk-session combination
	for _, bunkIDRaw := range bunkIDs {
		bunkCMID := 0
		switch v := bunkIDRaw.(type) {
		case float64:
			bunkCMID = int(v)
		case int:
			bunkCMID = v
		default:
			continue
		}

		// Validate bunk exists
		if !s.validBunkCMIDs[bunkCMID] {
			s.Stats.Skipped++
			continue
		}

		// Get bunk name for AG filtering
		bunkName := s.bunkNames[bunkCMID]
		bunkIsAG := isAGBunk(bunkName)
		// Extract bunk grade (e.g., "AG-8" → 8, 8)
		bunkGradeMin, bunkGradeMax := extractGradeRange(bunkName)

		for _, sessionIDRaw := range sessionIDs {
			sessionCMID := 0
			switch v := sessionIDRaw.(type) {
			case float64:
				sessionCMID = int(v)
			case int:
				sessionCMID = v
			default:
				continue
			}

			// Validate session exists
			if !s.validSessionCMIDs[sessionCMID] {
				s.Stats.Skipped++
				continue
			}

			// AG filtering: Only create bunk_plans where bunk and session are compatible
			// - AG sessions should only have bunk_plans for AG bunks with matching grades
			// - Non-AG sessions should only have bunk_plans for non-AG bunks
			sessionData := s.sessionInfo[sessionCMID]
			sessionIsAG := sessionData.SessionType == "ag"

			if sessionIsAG {
				// AG session: only include AG bunks with matching grades
				if !bunkIsAG {
					// Skip non-AG bunk for AG session
					s.skippedAGPlans++
					continue
				}
				// Both are AG - check if bunk grade is within session's grade range
				// e.g., AG-8 bunk should match "7th - 9th grades" session (8 is in [7,9])
				sessionGradeMin, sessionGradeMax := extractGradeRange(sessionData.Name)
				if bunkGradeMin > 0 && sessionGradeMin > 0 {
					// Check if bunk's grade overlaps with session's grade range
					// For single-grade bunks (AG-8), check if grade is in session range
					if bunkGradeMin == bunkGradeMax {
						// Single grade bunk - must be within session range
						if !gradeInRange(bunkGradeMin, sessionGradeMin, sessionGradeMax) {
							s.skippedAGPlans++
							continue
						}
					} else {
						// Range bunk - check for any overlap
						if bunkGradeMax < sessionGradeMin || bunkGradeMin > sessionGradeMax {
							s.skippedAGPlans++
							continue
						}
					}
				}
			} else if sessionData.SessionType == "main" && bunkIsAG {
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
	recordData := map[string]interface{}{
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

	return s.DeleteOrphans(
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
	)
}
