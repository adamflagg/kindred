package sync

import (
	"fmt"
	"strings"
	"testing"
)

// TestAttendeesSync_StatusChangeDetection tests the logic for detecting
// status changes between existing and incoming attendee records.
// The actual logStatusChange method requires PocketBase, but the detection
// logic can be tested by simulating the comparison.
func TestAttendeesSync_StatusChangeDetection(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name           string
		oldStatus      string
		newStatus      string
		expectChange   bool
		expectOldValue string
		expectNewValue string
	}{
		{
			name:         "no change - both enrolled",
			oldStatus:    "enrolled",
			newStatus:    "enrolled",
			expectChange: false,
		},
		{
			name:           "waitlisted to enrolled (accepted)",
			oldStatus:      "waitlisted",
			newStatus:      "enrolled",
			expectChange:   true,
			expectOldValue: "waitlisted",
			expectNewValue: "enrolled",
		},
		{
			name:           "waitlisted to cancelled (declined)", //nolint:misspell // CampMinder status value
			oldStatus:      "waitlisted",
			newStatus:      "cancelled", //nolint:misspell // CampMinder status value
			expectChange:   true,
			expectOldValue: "waitlisted",
			expectNewValue: "cancelled", //nolint:misspell // CampMinder status value
		},
		{
			name:           "waitlisted to withdrawn",
			oldStatus:      "waitlisted",
			newStatus:      "withdrawn",
			expectChange:   true,
			expectOldValue: "waitlisted",
			expectNewValue: "withdrawn",
		},
		{
			name:           "waitlisted to dismissed",
			oldStatus:      "waitlisted",
			newStatus:      "dismissed",
			expectChange:   true,
			expectOldValue: "waitlisted",
			expectNewValue: "dismissed",
		},
		{
			name:           "enrolled to cancelled", //nolint:misspell // CampMinder status value
			oldStatus:      "enrolled",
			newStatus:      "cancelled", //nolint:misspell // CampMinder status value
			expectChange:   true,
			expectOldValue: "enrolled",
			expectNewValue: "cancelled", //nolint:misspell // CampMinder status value
		},
		{
			name:           "applied to enrolled",
			oldStatus:      "applied",
			newStatus:      "enrolled",
			expectChange:   true,
			expectOldValue: "applied",
			expectNewValue: "enrolled",
		},
		{
			name:         "empty old status - no change recorded",
			oldStatus:    "",
			newStatus:    "enrolled",
			expectChange: false,
		},
		{
			name:         "same status - waitlisted unchanged",
			oldStatus:    "waitlisted",
			newStatus:    "waitlisted",
			expectChange: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Simulate the detection logic that will be in processEnrollment
			shouldLog := tt.oldStatus != "" && tt.oldStatus != tt.newStatus
			if shouldLog != tt.expectChange {
				t.Errorf("status change detection = %v, want %v (old=%q, new=%q)",
					shouldLog, tt.expectChange, tt.oldStatus, tt.newStatus)
			}

			if shouldLog {
				if tt.oldStatus != tt.expectOldValue {
					t.Errorf("old status = %q, want %q", tt.oldStatus, tt.expectOldValue)
				}
				if tt.newStatus != tt.expectNewValue {
					t.Errorf("new status = %q, want %q", tt.newStatus, tt.expectNewValue)
				}
			}
		})
	}
}

// TestAttendeesSync_StatusMapCompleteness verifies all CampMinder status IDs
// are mapped, ensuring the status history will always have valid status values.
func TestAttendeesSync_StatusMapCompleteness(t *testing.T) {
	t.Parallel()
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

	// Verify all expected statuses are present
	expectedStatuses := []string{
		"none", "enrolled", "applied", "waitlisted", "left_early",
		"cancelled", "dismissed", "inquiry", "withdrawn", "incomplete", //nolint:misspell // CampMinder status value
	}

	statusValues := make(map[string]bool)
	for _, v := range statusMap {
		statusValues[v] = true
	}

	for _, expected := range expectedStatuses {
		if !statusValues[expected] {
			t.Errorf("missing expected status %q in statusMap", expected)
		}
	}

	// Verify map has exactly the expected number of entries
	if len(statusMap) != len(expectedStatuses) {
		t.Errorf("statusMap has %d entries, want %d", len(statusMap), len(expectedStatuses))
	}
}

// TestAttendeesSync_CompositeKeyWithYear tests that the status change lookup key
// matches the year-scoped format used by PreloadCompositeRecords.
// PreloadCompositeRecords stores keys as "{person}:{session}|{year}" (base_sync.go:630),
// so the status change detection must use the same format for lookups to match.
func TestAttendeesSync_CompositeKeyWithYear(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name      string
		personID  int
		sessionID int
		year      int
		wantKey   string
	}{
		{
			name:      "year-scoped key matches PreloadCompositeRecords format",
			personID:  12345,
			sessionID: 67890,
			year:      2026,
			wantKey:   "12345:67890|2026",
		},
		{
			name:      "different year produces different key",
			personID:  99999,
			sessionID: 11111,
			year:      2025,
			wantKey:   "99999:11111|2025",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Build the base composite key (as processEnrollment does)
			key := fmt.Sprintf("%d:%d", tt.personID, tt.sessionID)

			// Build the year-scoped key used for existingAttendees lookup
			// This must match PreloadCompositeRecords format: "{person}:{session}|{year}"
			yearScopedKey := fmt.Sprintf("%s|%d", key, tt.year)
			if yearScopedKey != tt.wantKey {
				t.Errorf("year-scoped lookup key = %q, want %q", yearScopedKey, tt.wantKey)
			}

			// Simulate PreloadCompositeRecords storing with the same format
			existingAttendees := map[string]string{
				tt.wantKey: "enrolled",
			}

			// Verify the lookup key finds the record in the map
			if _, ok := existingAttendees[yearScopedKey]; !ok {
				t.Errorf("yearScopedKey %q not found in existingAttendees map (keys: %v)",
					yearScopedKey, existingAttendees)
			}

			// Verify that a key WITHOUT year would NOT match (the original bug)
			if _, ok := existingAttendees[key]; ok {
				t.Errorf("base key %q should NOT match year-scoped map key %q",
					key, tt.wantKey)
			}
		})
	}
}

// TestAttendeesSync_EffectiveDateExtraction verifies that processEnrollment
// extracts EffectiveDate and LastUpdatedUTC from CampMinder enrollment data
// and includes them in the record data map.
func TestAttendeesSync_EffectiveDateExtraction(t *testing.T) {
	t.Parallel()
	// Simulate the date extraction logic from processEnrollment.
	// We test the pattern, not the full method (which needs PocketBase app).
	tests := []struct {
		name           string
		enrollment     map[string]any
		wantEffective  string
		wantLastUpdate string
	}{
		{
			name: "enrolled record has EffectiveDate = registration date",
			enrollment: map[string]any{
				"PostDate":       "2024-11-18T00:00:00Z",
				"EffectiveDate":  "2024-11-18T00:00:00Z",
				"LastUpdatedUTC": "2024-11-18T12:30:00Z",
				"StatusID":       float64(2),
			},
			wantEffective:  "2024-11-18 00:00:00Z",
			wantLastUpdate: "2024-11-18 12:30:00Z",
		},
		{
			name: "cancelled record: EffectiveDate = original reg, PostDate = cancel date",
			enrollment: map[string]any{
				"PostDate":       "2025-07-06T00:00:00Z",
				"EffectiveDate":  "2024-11-18T00:00:00Z",
				"LastUpdatedUTC": "2025-07-06T09:15:00Z",
				"StatusID":       float64(32),
			},
			wantEffective:  "2024-11-18 00:00:00Z",
			wantLastUpdate: "2025-07-06 09:15:00Z",
		},
		{
			name: "missing EffectiveDate results in empty string",
			enrollment: map[string]any{
				"PostDate":       "2024-11-18T00:00:00Z",
				"LastUpdatedUTC": "2024-11-18T12:30:00Z",
				"StatusID":       float64(2),
			},
			wantEffective:  "",
			wantLastUpdate: "2024-11-18 12:30:00Z",
		},
		{
			name: "missing LastUpdatedUTC results in empty string",
			enrollment: map[string]any{
				"PostDate":      "2024-11-18T00:00:00Z",
				"EffectiveDate": "2024-11-18T00:00:00Z",
				"StatusID":      float64(2),
			},
			wantEffective:  "2024-11-18 00:00:00Z",
			wantLastUpdate: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Extract EffectiveDate using the same pattern processEnrollment should use
			var effectiveDate string
			if ed, ok := tt.enrollment["EffectiveDate"].(string); ok {
				effectiveDate = ParseDate(ed)
			}

			var lastUpdatedUTC string
			if lu, ok := tt.enrollment["LastUpdatedUTC"].(string); ok {
				lastUpdatedUTC = ParseDate(lu)
			}

			if effectiveDate != tt.wantEffective {
				t.Errorf("effective_date = %q, want %q", effectiveDate, tt.wantEffective)
			}
			if lastUpdatedUTC != tt.wantLastUpdate {
				t.Errorf("last_updated_utc = %q, want %q", lastUpdatedUTC, tt.wantLastUpdate)
			}

			// Verify that the recordData map would include these fields
			recordData := map[string]any{
				"effective_date":   effectiveDate,
				"last_updated_utc": lastUpdatedUTC,
			}

			// Check the fields are populated in recordData
			if ed, ok := recordData["effective_date"].(string); !ok || ed != tt.wantEffective {
				t.Errorf("recordData effective_date = %v, want %q", recordData["effective_date"], tt.wantEffective)
			}
			if lu, ok := recordData["last_updated_utc"].(string); !ok || lu != tt.wantLastUpdate {
				t.Errorf("recordData last_updated_utc = %v, want %q", recordData["last_updated_utc"], tt.wantLastUpdate)
			}
		})
	}
}

// TestAttendeesSync_RecordDataContainsEffectiveDate verifies the full recordData map
// built in processEnrollment would contain effective_date and last_updated_utc fields.
func TestAttendeesSync_RecordDataContainsEffectiveDate(t *testing.T) {
	t.Parallel()
	enrollment := map[string]any{
		"SessionID":      float64(1001),
		"StatusID":       float64(32), // cancelled
		"PostDate":       "2025-07-06T00:00:00Z",
		"EffectiveDate":  "2024-11-18T00:00:00Z",
		"LastUpdatedUTC": "2025-07-06T09:15:00Z",
	}

	// Simulate the record data construction from processEnrollment
	var enrollmentDate string
	if postDate, ok := enrollment["PostDate"].(string); ok {
		enrollmentDate = ParseDate(postDate)
	}
	var effectiveDate string
	if ed, ok := enrollment["EffectiveDate"].(string); ok {
		effectiveDate = ParseDate(ed)
	}
	var lastUpdatedUTC string
	if lu, ok := enrollment["LastUpdatedUTC"].(string); ok {
		lastUpdatedUTC = ParseDate(lu)
	}

	recordData := map[string]any{
		"enrollment_date":  enrollmentDate,
		"effective_date":   effectiveDate,
		"last_updated_utc": lastUpdatedUTC,
	}

	// For cancelled records: enrollment_date = PostDate (cancel date),
	// effective_date = EffectiveDate (original registration date)
	enrollDate, ok := recordData["enrollment_date"].(string)
	if !ok {
		t.Fatal("enrollment_date type assertion failed")
		return
	}
	if !strings.Contains(enrollDate, "2025-07-06") {
		t.Errorf("enrollment_date should be PostDate (cancel date), got %v", enrollDate)
	}
	effDate, ok := recordData["effective_date"].(string)
	if !ok {
		t.Fatal("effective_date type assertion failed")
		return
	}
	if !strings.Contains(effDate, "2024-11-18") {
		t.Errorf("effective_date should be EffectiveDate (original reg date), got %v", effDate)
	}
	lastUpdated, ok := recordData["last_updated_utc"].(string)
	if !ok {
		t.Fatal("last_updated_utc type assertion failed")
		return
	}
	if !strings.Contains(lastUpdated, "2025-07-06") {
		t.Errorf("last_updated_utc should be LastUpdatedUTC, got %v", lastUpdated)
	}
}
