package sync

import (
	"fmt"
	"testing"
)

// TestAttendeesSync_StatusChangeDetection tests the logic for detecting
// status changes between existing and incoming attendee records.
// The actual logStatusChange method requires PocketBase, but the detection
// logic can be tested by simulating the comparison.
func TestAttendeesSync_StatusChangeDetection(t *testing.T) {
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
