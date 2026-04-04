package sync

import (
	"fmt"
	"log/slog"
	"strconv"
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

// SessionResolver handles resolving session cm_ids to related CampMinder session IDs
type SessionResolver struct {
	app core.App
}

// NewSessionResolver creates a new session resolver
func NewSessionResolver(app core.App) *SessionResolver {
	return &SessionResolver{app: app}
}

// IsValidSession returns true if the session string is a valid session identifier.
// Accepts empty string, DefaultSession ("all"), or a positive numeric cm_id.
func IsValidSession(session string) bool {
	if session == "" || session == DefaultSession {
		return true
	}
	n, err := strconv.Atoi(session)
	return err == nil && n > 0
}

// ResolveSessionCMIDs resolves a session cm_id string to CampMinder session IDs.
// For main sessions, also includes related AG child sessions.
// For AG sessions, also includes the parent main session.
// For embedded sessions, returns just the session itself.
// Returns nil for "all" or empty session (caller handles the unfiltered case).
func (r *SessionResolver) ResolveSessionCMIDs(session string, year int) ([]int, error) {
	if session == "" || session == DefaultSession {
		return nil, nil
	}

	cmID, err := strconv.Atoi(session)
	if err != nil {
		return nil, fmt.Errorf("invalid session '%s': must be 'all' or a numeric cm_id", session)
	}

	yearStr := fmt.Sprintf("%d", year)

	// Look up the session by cm_id
	filter := fmt.Sprintf("cm_id = %d && year = %s", cmID, yearStr)
	sessions, err := r.app.FindRecordsByFilter("camp_sessions", filter, "", 1, 0)
	if err != nil {
		return nil, fmt.Errorf("querying session cm_id=%d: %w", cmID, err)
	}
	if len(sessions) == 0 {
		return nil, fmt.Errorf("session cm_id=%d not found for year %d", cmID, year)
	}

	mainRecord := sessions[0]
	sessionType := mainRecord.GetString("session_type")
	parentID := 0
	if pid, ok := mainRecord.Get("parent_id").(float64); ok {
		parentID = int(pid)
	}

	relatedIDs := []int{cmID}

	switch sessionType {
	case "main":
		// Main session -> find AG children (parent_id matches this session's cm_id)
		agFilter := fmt.Sprintf("year = %s && session_type = 'ag' && parent_id = %d", yearStr, cmID)
		agSessions, err := r.app.FindRecordsByFilter("camp_sessions", agFilter, "", 0, 0)
		if err != nil {
			slog.Warn("Failed to find AG sessions", "error", err)
		} else {
			for _, ag := range agSessions {
				if agCMID, ok := ag.Get("cm_id").(float64); ok {
					agIDInt := int(agCMID)
					if agIDInt != cmID {
						relatedIDs = append(relatedIDs, agIDInt)
					}
				}
			}
		}

	case "ag":
		// AG session -> add parent main session
		if parentID > 0 && parentID != cmID {
			relatedIDs = append(relatedIDs, parentID)
		}

	// "embedded" or anything else -> just self (independent)
	default:
		// No related sessions to add
	}

	return relatedIDs, nil
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

// GetHouseholdIDsForSession returns CampMinder household IDs for households
// with persons enrolled in the specified session.
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
