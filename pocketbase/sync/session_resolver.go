package sync

import (
	"fmt"
	"log/slog"
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

// SessionResolver handles resolving friendly session names to CampMinder session IDs
type SessionResolver struct {
	app core.App
}

// NewSessionResolver creates a new session resolver
func NewSessionResolver(app core.App) *SessionResolver {
	return &SessionResolver{app: app}
}

// sessionNameMap maps friendly session names to session numbers/types
// This matches the Python session resolution logic and frontend extractFriendlyName()
var sessionNameMap = map[string]string{
	"1":   "1",
	"2":   "2",
	"2a":  "2a",
	"2b":  "2b",
	"3":   "3",
	"3a":  "3a",
	"3b":  "3b",
	"4":   "4",
	"toc": "1", // Taste of Camp is session 1
}

// GetSessionNamePattern returns the name pattern to match for a given session number.
// Session 1 is "Taste of Camp", sessions 2-4 are "Session N".
func GetSessionNamePattern(sessionNum string) string {
	if sessionNum == "1" {
		return "Taste of Camp"
	}
	return fmt.Sprintf("Session %s", sessionNum)
}

// IsEmbeddedSession returns true if the session number indicates an embedded session (2a, 2b, 3a, etc.)
func IsEmbeddedSession(sessionNum string) bool {
	return strings.Contains(sessionNum, "a") || strings.Contains(sessionNum, "b")
}

// IsValidSession returns true if the session string is a valid session identifier
func IsValidSession(session string) bool {
	if session == "" || session == DefaultSession {
		return true
	}
	_, ok := sessionNameMap[strings.ToLower(session)]
	return ok
}

// ResolveSessionCMIDs resolves a friendly session name to CampMinder session IDs.
// For main sessions (1, 2, 3, 4), also includes related AG sessions.
// Returns empty slice for "all" or empty session.
func (r *SessionResolver) ResolveSessionCMIDs(session string, year int) ([]int, error) {
	if session == "" || session == DefaultSession {
		return nil, nil
	}

	sessionNum, ok := sessionNameMap[strings.ToLower(session)]
	if !ok {
		return nil, fmt.Errorf("unknown session: %s", session)
	}

	var cmIDs []int
	yearStr := fmt.Sprintf("%d", year)

	// Check if it's an embedded session or main session
	if IsEmbeddedSession(sessionNum) {
		// Embedded session - just get that specific session
		filter := fmt.Sprintf("year = %s && session_type = 'embedded' && name ~ '%s'", yearStr, sessionNum)
		sessions, err := r.app.FindRecordsByFilter("camp_sessions", filter, "", 1, 0)
		if err != nil {
			return nil, fmt.Errorf("querying sessions: %w", err)
		}
		for _, s := range sessions {
			if cmID, ok := s.Get("cm_id").(float64); ok {
				cmIDs = append(cmIDs, int(cmID))
			}
		}
	} else {
		// Main session - get main + AG children
		namePattern := GetSessionNamePattern(sessionNum)
		filter := fmt.Sprintf("year = %s && session_type = 'main' && name ~ '%s'", yearStr, namePattern)
		sessions, err := r.app.FindRecordsByFilter("camp_sessions", filter, "", 1, 0)
		if err != nil {
			return nil, fmt.Errorf("querying main session: %w", err)
		}

		if len(sessions) > 0 {
			mainSession := sessions[0]
			if mainCMID, ok := mainSession.Get("cm_id").(float64); ok {
				cmIDs = append(cmIDs, int(mainCMID))

				// Find AG children (parent_id matches main session's cm_id)
				agFilter := fmt.Sprintf("year = %s && session_type = 'ag' && parent_id = %d", yearStr, int(mainCMID))
				agSessions, err := r.app.FindRecordsByFilter("camp_sessions", agFilter, "", 0, 0)
				if err != nil {
					slog.Warn("Failed to find AG sessions", "error", err)
				} else {
					for _, ag := range agSessions {
						if agCMID, ok := ag.Get("cm_id").(float64); ok {
							cmIDs = append(cmIDs, int(agCMID))
						}
					}
				}
			}
		}
	}

	if len(cmIDs) == 0 {
		return nil, fmt.Errorf("session %s not found for year %d", session, year)
	}

	return cmIDs, nil
}

// GetPersonIDsForSession returns CampMinder person IDs for persons enrolled in the specified session.
// For "all" or empty session, returns nil (caller should handle all persons case).
func (r *SessionResolver) GetPersonIDsForSession(session string, year int) ([]int, error) {
	cmIDs, err := r.ResolveSessionCMIDs(session, year)
	if err != nil {
		return nil, err
	}

	if len(cmIDs) == 0 {
		return nil, nil // No session filter
	}

	// Build session filter for attendees query
	sessionConditions := make([]string, len(cmIDs))
	for i, cmID := range cmIDs {
		sessionConditions[i] = fmt.Sprintf("session.cm_id = %d", cmID)
	}
	sessionFilter := "(" + strings.Join(sessionConditions, " || ") + ")"

	// Query attendees for persons in target sessions
	filter := fmt.Sprintf("year = %d && status = 'enrolled' && %s", year, sessionFilter)
	attendees, err := r.app.FindRecordsByFilter("attendees", filter, "", 0, 0)
	if err != nil {
		return nil, fmt.Errorf("querying attendees: %w", err)
	}

	// Extract unique person CampMinder IDs
	personIDSet := make(map[int]bool)
	for _, attendee := range attendees {
		if personID, ok := attendee.Get("person_id").(float64); ok && personID > 0 {
			personIDSet[int(personID)] = true
		}
	}

	personIDs := make([]int, 0, len(personIDSet))
	for id := range personIDSet {
		personIDs = append(personIDs, id)
	}

	return personIDs, nil
}

// GetHouseholdIDsForSession returns CampMinder household IDs for households with persons enrolled in the specified session.
// For "all" or empty session, returns nil (caller should handle all households case).
func (r *SessionResolver) GetHouseholdIDsForSession(session string, year int) ([]int, error) {
	cmIDs, err := r.ResolveSessionCMIDs(session, year)
	if err != nil {
		return nil, err
	}

	if len(cmIDs) == 0 {
		return nil, nil // No session filter
	}

	// Build session filter for attendees query
	sessionConditions := make([]string, len(cmIDs))
	for i, cmID := range cmIDs {
		sessionConditions[i] = fmt.Sprintf("session.cm_id = %d", cmID)
	}
	sessionFilter := "(" + strings.Join(sessionConditions, " || ") + ")"

	// Query attendees for persons in target sessions, then get their households
	filter := fmt.Sprintf("year = %d && status = 'enrolled' && %s", year, sessionFilter)
	attendees, err := r.app.FindRecordsByFilter("attendees", filter, "", 0, 0)
	if err != nil {
		return nil, fmt.Errorf("querying attendees: %w", err)
	}

	// Collect unique person PB IDs
	personPBIDs := make([]string, 0, len(attendees))
	personPBIDSet := make(map[string]bool)
	for _, attendee := range attendees {
		personPBID := attendee.GetString("person")
		if personPBID != "" && !personPBIDSet[personPBID] {
			personPBIDSet[personPBID] = true
			personPBIDs = append(personPBIDs, personPBID)
		}
	}

	if len(personPBIDs) == 0 {
		return nil, nil
	}

	// Query persons to get their household IDs
	householdIDSet := make(map[int]bool)
	// Process in batches to avoid long queries
	batchSize := 50
	for i := 0; i < len(personPBIDs); i += batchSize {
		end := i + batchSize
		if end > len(personPBIDs) {
			end = len(personPBIDs)
		}
		batch := personPBIDs[i:end]

		// Build ID filter
		idConditions := make([]string, len(batch))
		for j, id := range batch {
			idConditions[j] = fmt.Sprintf("id = '%s'", id)
		}
		idFilter := "(" + strings.Join(idConditions, " || ") + ")"

		persons, err := r.app.FindRecordsByFilter("persons", idFilter, "", 0, 0)
		if err != nil {
			slog.Warn("Failed to query persons batch", "error", err)
			continue
		}

		for _, person := range persons {
			if householdID, ok := person.Get("household_id").(float64); ok && householdID > 0 {
				householdIDSet[int(householdID)] = true
			}
		}
	}

	householdIDs := make([]int, 0, len(householdIDSet))
	for id := range householdIDSet {
		householdIDs = append(householdIDs, id)
	}

	return householdIDs, nil
}
