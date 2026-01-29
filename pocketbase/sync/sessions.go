package sync

import (
	"context"
	"fmt"
	"log/slog"
	"regexp"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"github.com/camp/kindred/pocketbase/campminder"
)

// Session type constants
const (
	sessionTypeMain   = "main"
	sessionTypeAdult  = "adult"
	sessionTypeFamily = "family"
)

// Service name constant
const serviceNameSessions = "sessions"

// SessionsSync handles syncing session data from CampMinder
type SessionsSync struct {
	BaseSyncService
	groupIDMap map[int]string // Maps CampMinder group ID to PocketBase record ID
}

// NewSessionsSync creates a new sessions sync service
func NewSessionsSync(app core.App, client *campminder.Client) *SessionsSync {
	return &SessionsSync{
		BaseSyncService: NewBaseSyncService(app, client),
	}
}

// Name returns the name of this sync service
func (s *SessionsSync) Name() string {
	return serviceNameSessions
}

// Sync performs the session sync
func (s *SessionsSync) Sync(ctx context.Context) error {
	// Use custom implementation like bunks for idempotency
	year := s.Client.GetSeasonID()
	filter := fmt.Sprintf("year = %d", year)

	// Pre-load existing records for this year
	existingRecords, err := s.PreloadRecords("camp_sessions", filter, func(record *core.Record) (interface{}, bool) {
		if cmID, ok := record.Get("cm_id").(float64); ok {
			return int(cmID), true
		}
		return nil, false
	})
	if err != nil {
		return err
	}

	// Pre-load session_groups to resolve group_id -> PocketBase record ID
	s.groupIDMap = make(map[int]string)
	groupRecords, err := s.PreloadRecords("session_groups", filter, func(record *core.Record) (interface{}, bool) {
		if cmID, ok := record.Get("cm_id").(float64); ok {
			// Store the PocketBase ID for this group's CampMinder ID
			s.groupIDMap[int(cmID)] = record.Id
			return int(cmID), true
		}
		return nil, false
	})
	if err != nil {
		slog.Warn("Failed to preload session_groups", "error", err)
		// Continue without group resolution - groups will be nil
	} else {
		slog.Info("Preloaded session_groups for relation resolution", "count", len(groupRecords))
	}

	// Start the sync process
	s.LogSyncStart(serviceNameSessions)
	s.Stats = Stats{}
	s.SyncSuccessful = false

	// Clear processed tracker
	s.ClearProcessedKeys()

	// Fetch sessions from CampMinder
	sessions, err := s.Client.GetSessions()
	if err != nil {
		return fmt.Errorf("fetching sessions: %w", err)
	}

	if len(sessions) == 0 {
		slog.Info("No sessions to sync")
		return nil
	}

	slog.Info("Fetched sessions from CampMinder", "count", len(sessions))
	s.SyncSuccessful = true

	// First pass: collect initial types from name-based classification
	initialTypes := make(map[int]string)
	mainSessions := make(map[string]int) // date key -> cm_id (for AG parent matching)

	for _, sessionData := range sessions {
		idFloat, ok := sessionData["ID"].(float64)
		if !ok {
			continue
		}
		cmID := int(idFloat)

		// Parse dates for grouping
		startDate := ""
		endDate := ""
		if startStr, ok := sessionData["StartDate"].(string); ok && startStr != "" {
			startDate = s.parseDate(startStr)
		}
		if endStr, ok := sessionData["EndDate"].(string); ok && endStr != "" {
			endDate = s.parseDate(endStr)
		}

		// Determine session type from name
		sessionName, _ := sessionData["Name"].(string)
		sessionType := s.getSessionTypeFromName(sessionName)
		initialTypes[cmID] = sessionType

		// Store main sessions for AG parent lookup (requires exact date match)
		if sessionType == sessionTypeMain && startDate != "" && endDate != "" {
			dateKey := fmt.Sprintf("%s|%s", startDate, endDate)
			mainSessions[dateKey] = cmID
		}
	}

	// Second pass: reclassify overlapping sessions
	// Sessions sharing start_date or end_date are reclassified so the longest stays "main"
	correctedTypes, overrideParentIDs := s.reclassifyOverlappingSessions(sessions, initialTypes)

	// Update mainSessions map with corrected types for AG parent matching
	// (AG sessions need to find their parent among sessions that stayed "main")
	mainSessions = make(map[string]int)
	for _, sessionData := range sessions {
		idFloat, ok := sessionData["ID"].(float64)
		if !ok {
			continue
		}
		cmID := int(idFloat)

		if correctedTypes[cmID] == sessionTypeMain {
			startDate := ""
			endDate := ""
			if startStr, ok := sessionData["StartDate"].(string); ok && startStr != "" {
				startDate = s.parseDate(startStr)
			}
			if endStr, ok := sessionData["EndDate"].(string); ok && endStr != "" {
				endDate = s.parseDate(endStr)
			}
			if startDate != "" && endDate != "" {
				dateKey := fmt.Sprintf("%s|%s", startDate, endDate)
				mainSessions[dateKey] = cmID
			}
		}
	}

	// Process each session with corrected types and parent relationships
	for _, sessionData := range sessions {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		// Transform to PocketBase format with corrected types and parent relationships
		pbData, err := s.transformSessionToPBWithParent(sessionData, mainSessions, correctedTypes, overrideParentIDs)
		if err != nil {
			slog.Error("Error transforming session", "error", err)
			s.Stats.Errors++
			continue
		}

		// Extract key
		sessionID, ok := sessionData["ID"].(float64)
		if !ok {
			slog.Error("Invalid session ID type")
			s.Stats.Errors++
			continue
		}
		key := int(sessionID)

		// Track as processed using base class tracking
		yearValue := pbData["year"]
		year, ok := yearValue.(int)
		if !ok {
			slog.Error("Invalid year type in pbData")
			s.Stats.Errors++
			continue
		}
		s.TrackProcessedKey(key, year)

		// Process the record - specify fields to compare (including parent_id and all new fields)
		compareFields := []string{
			"cm_id", "name", "start_date", "end_date", "session_type", "parent_id",
			"description", "is_active", "sort_order", "session_group",
			"is_day", "is_residential", "is_for_children", "is_for_adults",
			"start_grade_id", "end_grade_id", "gender_id",
		}
		if err := s.ProcessSimpleRecord("camp_sessions", key, pbData, existingRecords, compareFields); err != nil {
			slog.Error("Error processing session", "error", err)
			s.Stats.Errors++
		}
	}

	// Delete orphans using base class tracking
	if err := s.DeleteOrphans(
		"camp_sessions",
		func(record *core.Record) (string, bool) {
			// Build composite key from record for comparison
			cmIDValue := record.Get("cm_id")
			yearValue := record.Get("year")

			cmID, cmOK := cmIDValue.(float64)
			year, yearOK := yearValue.(float64)

			if cmOK && yearOK {
				// Return composite key for comparison
				return CompositeKey(int(cmID), int(year)), true
			}
			return "", false
		},
		"session",
		filter, // Use the same year filter
	); err != nil {
		slog.Error("Error deleting orphans", "error", err)
	}

	// Force WAL checkpoint
	if err := s.ForceWALCheckpoint(); err != nil {
		slog.Warn("WAL checkpoint failed", "error", err)
	}

	s.LogSyncComplete("Sessions")
	return nil
}

// transformSessionToPBWithParent transforms CampMinder session data to PocketBase format
// It uses overrideTypes for the session_type (from date overlap detection) and
// overrideParents for the parent_id (for embedded sessions from date overlap detection).
// AG sessions still use mainSessions for parent lookup (exact date matching).
func (s *SessionsSync) transformSessionToPBWithParent(
	data map[string]interface{},
	mainSessions map[string]int,
	overrideTypes map[int]string,
	overrideParents map[int]int,
) (map[string]interface{}, error) {
	pbData := make(map[string]interface{})

	// Extract session ID
	sessionIDFloat, ok := data["ID"].(float64)
	if !ok {
		return nil, fmt.Errorf("invalid session ID type")
	}
	sessionID := int(sessionIDFloat)
	pbData["cm_id"] = sessionID

	// Extract name
	sessionName, _ := data["Name"].(string)
	pbData["name"] = sessionName

	// Parse dates - CampMinder returns dates in various formats
	startDate := ""
	endDate := ""
	if startStr, ok := data["StartDate"].(string); ok && startStr != "" {
		startDate = s.parseDate(startStr)
		pbData["start_date"] = startDate
	}
	if endStr, ok := data["EndDate"].(string); ok && endStr != "" {
		endDate = s.parseDate(endStr)
		pbData["end_date"] = endDate
	}

	// Extract year from SeasonID
	if yearFloat, ok := data["SeasonID"].(float64); ok {
		pbData["year"] = int(yearFloat)
	} else {
		// Fallback to client's season ID
		pbData["year"] = s.Client.GetSeasonID()
	}

	// Use overrideTypes if available (from date overlap detection), otherwise use name-based
	sessionType := overrideTypes[sessionID]
	if sessionType == "" {
		sessionType = s.getSessionTypeFromName(sessionName)
	}
	pbData["session_type"] = sessionType

	// Calculate parent_id
	// Priority: 1) overrideParents (from date overlap detection for embedded sessions)
	//           2) mainSessions (for AG sessions - exact date match)
	parentID := 0

	// Check override parents first (set by reclassifyOverlappingSessions for embedded sessions)
	if overrideParent, exists := overrideParents[sessionID]; exists && overrideParent > 0 {
		parentID = overrideParent
	} else if sessionType == "ag" {
		// AG sessions match parents with exact same start AND end dates
		if startDate != "" && endDate != "" {
			if mainID, exists := mainSessions[fmt.Sprintf("%s|%s", startDate, endDate)]; exists {
				parentID = mainID
			}
		}
	}

	// Only set parent_id if we found a valid parent
	if parentID > 0 {
		pbData["parent_id"] = parentID
	}

	// Extract new fields from CampMinder (all optional, pass through as-is)
	pbData["description"] = data["Description"]
	pbData["is_active"] = data["IsActive"]
	pbData["sort_order"] = data["SortOrder"]

	// Resolve GroupID to PocketBase session_group relation
	if groupID, ok := data["GroupID"].(float64); ok && groupID > 0 {
		if pbID, exists := s.groupIDMap[int(groupID)]; exists {
			pbData["session_group"] = pbID
		} else {
			slog.Debug("No session_group found for GroupID", "groupID", int(groupID))
		}
	}

	pbData["is_day"] = data["IsDay"]
	pbData["is_residential"] = data["IsResidential"]
	pbData["is_for_children"] = data["IsForChilden"] // Note: CampMinder API has typo (missing 'r')
	pbData["is_for_adults"] = data["IsForAdults"]
	pbData["start_grade_id"] = data["StartGradeID"]
	pbData["end_grade_id"] = data["EndGradeID"]
	pbData["gender_id"] = data["GenderID"]

	return pbData, nil
}

// parseDate handles various date formats from CampMinder and returns ISO format without milliseconds
func (s *SessionsSync) parseDate(dateStr string) string {
	// Try various date formats that CampMinder might return
	formats := []string{
		"2006-01-02T15:04:05Z",
		"2006-01-02T15:04:05",
		"2006-01-02",
		time.RFC3339,
		"1/2/2006",                 // US format M/D/YYYY
		"01/02/2006",               // US format MM/DD/YYYY
		"2006-01-02T15:04:05.000Z", // ISO with milliseconds
	}

	for _, format := range formats {
		if t, err := time.Parse(format, dateStr); err == nil {
			// Return in PocketBase expected format WITHOUT milliseconds
			// This ensures consistent comparison with stored DateTime values
			return t.UTC().Format("2006-01-02 15:04:05Z")
		}
	}

	// If parsing fails, return empty string
	return ""
}

// sessionOverlapInfo holds information needed for date overlap analysis
type sessionOverlapInfo struct {
	cmID        int
	name        string
	startDate   string
	endDate     string
	duration    int // days
	sessionType string
}

// reclassifyOverlappingSessions detects sessions sharing start or end dates and
// reclassifies shorter ones as "embedded" with parent_id pointing to the primary.
// Only sessions initially classified as "main" or "embedded" are considered for reclassification.
// AG, family, and other non-main types are exempt.
//
// Business rule: When multiple non-AG sessions share a start_date OR end_date:
// 1. The session with the longest duration is the "primary" (stays main)
// 2. If durations are equal, alphabetically first name wins
// 3. All others become "embedded" with parent_id set to the primary's cm_id
func (s *SessionsSync) reclassifyOverlappingSessions(
	sessions []map[string]interface{},
	initialTypes map[int]string,
) (correctedTypes map[int]string, parentIDs map[int]int) {
	// Initialize output maps with input values
	correctedTypes = make(map[int]string)
	parentIDs = make(map[int]int)

	for cmID, sessionType := range initialTypes {
		correctedTypes[cmID] = sessionType
		parentIDs[cmID] = 0
	}

	// Build session info list and date indexes
	sessionInfos := make(map[int]*sessionOverlapInfo)
	byStartDate := make(map[string][]*sessionOverlapInfo)
	byEndDate := make(map[string][]*sessionOverlapInfo)

	for _, sessionData := range sessions {
		idFloat, ok := sessionData["ID"].(float64)
		if !ok {
			continue
		}
		cmID := int(idFloat)

		name, _ := sessionData["Name"].(string)
		startDateStr, _ := sessionData["StartDate"].(string)
		endDateStr, _ := sessionData["EndDate"].(string)

		// Parse dates using the existing parseDate function
		startDate := s.parseDate(startDateStr)
		endDate := s.parseDate(endDateStr)

		// Skip sessions without valid dates
		if startDate == "" || endDate == "" {
			continue
		}

		// Calculate duration in days
		duration := s.calculateDurationDays(startDate, endDate)

		info := &sessionOverlapInfo{
			cmID:        cmID,
			name:        name,
			startDate:   startDate,
			endDate:     endDate,
			duration:    duration,
			sessionType: initialTypes[cmID],
		}

		sessionInfos[cmID] = info

		// Index by dates
		byStartDate[startDate] = append(byStartDate[startDate], info)
		byEndDate[endDate] = append(byEndDate[endDate], info)
	}

	// Process date groups with overlaps
	processedGroups := make(map[string]bool)

	// Helper to process a group of sessions sharing a date
	processDateGroup := func(sessions []*sessionOverlapInfo, groupKey string) {
		if processedGroups[groupKey] {
			return
		}
		processedGroups[groupKey] = true

		// Filter to only sessions that could be reclassified (main or embedded)
		// AG, family, and other types are exempt
		var candidates []*sessionOverlapInfo
		for _, info := range sessions {
			if info.sessionType == "main" || info.sessionType == "embedded" {
				candidates = append(candidates, info)
			}
		}

		// Need at least 2 candidates to have an overlap
		if len(candidates) < 2 {
			return
		}

		// Sort by duration (desc), then by name (asc) for tie-breaking
		sortSessionsByPriority(candidates)

		// First candidate is the primary (stays or becomes main)
		primary := candidates[0]
		correctedTypes[primary.cmID] = "main"

		// All others become embedded with parent_id pointing to primary
		for _, info := range candidates[1:] {
			correctedTypes[info.cmID] = "embedded"
			parentIDs[info.cmID] = primary.cmID
		}
	}

	// Process all start date groups
	for startDate, sessions := range byStartDate {
		processDateGroup(sessions, "start:"+startDate)
	}

	// Process all end date groups
	for endDate, sessions := range byEndDate {
		processDateGroup(sessions, "end:"+endDate)
	}

	return correctedTypes, parentIDs
}

// calculateDurationDays calculates the number of days between two parsed dates
func (s *SessionsSync) calculateDurationDays(startDate, endDate string) int {
	// Parse the dates (format: "2006-01-02 15:04:05Z")
	start, err := time.Parse("2006-01-02 15:04:05Z", startDate)
	if err != nil {
		return 0
	}
	end, err := time.Parse("2006-01-02 15:04:05Z", endDate)
	if err != nil {
		return 0
	}

	return int(end.Sub(start).Hours() / 24)
}

// sortSessionsByPriority sorts sessions by duration (desc), then by name (asc)
func sortSessionsByPriority(sessions []*sessionOverlapInfo) {
	for i := 0; i < len(sessions)-1; i++ {
		for j := i + 1; j < len(sessions); j++ {
			// Sort by duration descending
			if sessions[j].duration > sessions[i].duration {
				sessions[i], sessions[j] = sessions[j], sessions[i]
			} else if sessions[j].duration == sessions[i].duration {
				// Tie-break by name ascending
				if sessions[j].name < sessions[i].name {
					sessions[i], sessions[j] = sessions[j], sessions[i]
				}
			}
		}
	}
}

// getSessionTypeFromName returns the session type based directly on the session name
func (s *SessionsSync) getSessionTypeFromName(sessionName string) string {
	nameLower := strings.ToLower(sessionName)

	// Check patterns in order of specificity
	// Most specific patterns first to avoid false matches

	// Embedded sessions (e.g., "Session 2a", "Session 3b")
	if matched, _ := regexp.MatchString(`session \d[ab]`, nameLower); matched {
		return "embedded"
	}

	// All-gender sessions
	if strings.Contains(nameLower, "all-gender cabin-session") {
		return "ag"
	}

	// Main sessions - check for specific patterns to avoid false matches
	if strings.Contains(nameLower, "taste of camp") {
		return sessionTypeMain
	}
	matched, _ := regexp.MatchString(`session [234](\s|$)`, nameLower)
	if matched && !strings.Contains(nameLower, "all-gender") {
		return sessionTypeMain
	}

	// TLI programs - check sub-programs first
	if strings.Contains(nameLower, "tli:") {
		return "tli"
	}
	if strings.Contains(nameLower, "teen leadership institute") {
		return "tli"
	}

	// Family camps
	if matched, _ := regexp.MatchString(`family camp \d`, nameLower); matched {
		return sessionTypeFamily
	}
	if strings.Contains(nameLower, "winter family camp") {
		return sessionTypeFamily
	}

	// Adult programs - specific matches
	if strings.Contains(nameLower, "adults unplugged") {
		return sessionTypeAdult
	}
	if strings.Contains(nameLower, "divorce") && strings.Contains(nameLower, "discovery") {
		return sessionTypeAdult
	}
	if strings.Contains(nameLower, "women's weekend") || strings.Contains(nameLower, "womens weekend") {
		return sessionTypeAdult
	}

	// Training programs
	if strings.Contains(nameLower, "counselor in-training") || strings.Contains(nameLower, "cit") {
		return "training"
	}
	if strings.Contains(nameLower, "specialist in-training") || strings.Contains(nameLower, "sit") {
		return "training"
	}

	// Quest programs
	if strings.Contains(nameLower, "quest") {
		return "quest"
	}

	// School programs
	if strings.Contains(nameLower, "school") {
		return "school"
	}

	// Hebrew programs
	if strings.Contains(nameLower, "hebrew") {
		return "hebrew"
	}

	// B'Mitzvah programs
	if strings.Contains(nameLower, "mitzvah") {
		return "bmitzvah"
	}

	// Teen programs
	if strings.Contains(nameLower, "teen winter retreat") {
		return "teen"
	}

	// Default fallback
	return "other"
}
