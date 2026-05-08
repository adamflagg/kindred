package sync

import (
	"fmt"
	"testing"
)

// --- Staff inclusion tests (v3 — session-level staff in bunk_assignments) ---

func TestBunkAssignmentsSync_findMatchingSession(t *testing.T) {
	s := &BunkAssignmentsSync{}

	tests := []struct {
		name             string
		personSessions   []int
		bunkPlanSessions []int
		want             int
	}{
		{
			name:             "single matching session",
			personSessions:   []int{5001, 5002},
			bunkPlanSessions: []int{5001},
			want:             5001,
		},
		{
			name:             "multiple bunk plan sessions, person enrolled in one",
			personSessions:   []int{5002},
			bunkPlanSessions: []int{5001, 5002},
			want:             5002,
		},
		{
			name:             "no overlap returns zero",
			personSessions:   []int{5001},
			bunkPlanSessions: []int{5002},
			want:             0,
		},
		{
			name:             "nil person sessions returns zero",
			personSessions:   nil,
			bunkPlanSessions: []int{5001},
			want:             0,
		},
		{
			name:             "nil bunk plan sessions returns zero",
			personSessions:   []int{5001},
			bunkPlanSessions: nil,
			want:             0,
		},
		{
			name:             "both nil returns zero",
			personSessions:   nil,
			bunkPlanSessions: nil,
			want:             0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := s.findMatchingSession(tt.personSessions, tt.bunkPlanSessions)
			if got != tt.want {
				t.Errorf("findMatchingSession() = %d, want %d", got, tt.want)
			}
		})
	}
}

func TestBunkAssignmentsSync_StaffSessionLookup(t *testing.T) {
	// Tests the (bunkPlanCMID, bunkCMID) → sessionCMID lookup pattern
	// used to resolve staff assignments to exact sessions.
	//
	// Key insight: A bunk plan can span main+AG sessions (e.g., plan 12424 = Session 2 + AG-Session 2),
	// but each individual bunk disambiguates: AG-8 → AG-Session 2, B-3 → Session 2.

	tests := []struct {
		name         string
		bpBunkToSess map[string]int
		bunkPlanCMID int
		bunkCMID     int
		wantSession  int
		wantOK       bool
	}{
		{
			name: "regular bunk resolves to main session",
			bpBunkToSess: map[string]int{
				"12424:200": 5001, // B-3 in plan 12424 → Session 2
				"12424:300": 5002, // AG-8 in plan 12424 → AG-Session 2
			},
			bunkPlanCMID: 12424,
			bunkCMID:     200,
			wantSession:  5001,
			wantOK:       true,
		},
		{
			name: "AG bunk resolves to AG session from same plan",
			bpBunkToSess: map[string]int{
				"12424:200": 5001,
				"12424:300": 5002,
			},
			bunkPlanCMID: 12424,
			bunkCMID:     300,
			wantSession:  5002,
			wantOK:       true,
		},
		{
			name: "embedded session bunk resolves correctly",
			bpBunkToSess: map[string]int{
				"12500:200": 5010, // B-3 in plan 12500 → Session 2a (embedded)
			},
			bunkPlanCMID: 12500,
			bunkCMID:     200,
			wantSession:  5010,
			wantOK:       true,
		},
		{
			name: "unknown bunk plan returns not found",
			bpBunkToSess: map[string]int{
				"12424:200": 5001,
			},
			bunkPlanCMID: 99999,
			bunkCMID:     200,
			wantSession:  0,
			wantOK:       false,
		},
		{
			name: "unknown bunk in known plan returns not found",
			bpBunkToSess: map[string]int{
				"12424:200": 5001,
			},
			bunkPlanCMID: 12424,
			bunkCMID:     999,
			wantSession:  0,
			wantOK:       false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			key := fmt.Sprintf("%d:%d", tt.bunkPlanCMID, tt.bunkCMID)
			sessionCMID, ok := tt.bpBunkToSess[key]

			if ok != tt.wantOK {
				t.Errorf("lookup ok = %v, want %v", ok, tt.wantOK)
			}
			if sessionCMID != tt.wantSession {
				t.Errorf("sessionCMID = %d, want %d", sessionCMID, tt.wantSession)
			}
		})
	}
}

// TestBunkAssignmentsSync_NonActiveStaffOrphanProtection verifies that existing
// bunk_assignments for non-active bunk staff are pre-tracked as processed,
// so DeleteOrphans won't remove them. CampMinder strips assignments from
// dismissed/resigned staff, but we preserve them in PocketBase.
func TestBunkAssignmentsSync_NonActiveStaffOrphanProtection(t *testing.T) {
	tests := []struct {
		name             string
		staffStatus      string
		bunkStaff        bool
		personCMID       int
		sessionCMIDs     []int // sessions this person has assignments for
		year             int
		wantTrackedCount int // number of keys expected in ProcessedKeys
	}{
		{
			name:             "dismissed bunk_staff — assignments protected",
			staffStatus:      "dismissed",
			bunkStaff:        true,
			personCMID:       3000001,
			sessionCMIDs:     []int{5001, 5002},
			year:             2025,
			wantTrackedCount: 2,
		},
		{
			name:             "resigned bunk_staff — assignments protected",
			staffStatus:      "resigned",
			bunkStaff:        true,
			personCMID:       3000002,
			sessionCMIDs:     []int{5001},
			year:             2025,
			wantTrackedCount: 1,
		},
		{
			name:             "active bunk_staff — NOT pre-tracked (comes from API)",
			staffStatus:      "active",
			bunkStaff:        true,
			personCMID:       3000003,
			sessionCMIDs:     []int{5001},
			year:             2025,
			wantTrackedCount: 0,
		},
		{
			name:             "dismissed non-bunk-staff — NOT protected",
			staffStatus:      "dismissed",
			bunkStaff:        false,
			personCMID:       3000004,
			sessionCMIDs:     []int{5001},
			year:             2025,
			wantTrackedCount: 0,
		},
		{
			name:             "dismissed bunk_staff with no assignments — nothing to protect",
			staffStatus:      "dismissed",
			bunkStaff:        true,
			personCMID:       3000005,
			sessionCMIDs:     []int{},
			year:             2025,
			wantTrackedCount: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			service := BaseSyncService{
				ProcessedKeys: make(map[string]bool),
			}

			// Simulate the protection logic: only protect non-active bunk_staff
			if tt.staffStatus != "active" && tt.bunkStaff {
				for _, sessionCMID := range tt.sessionCMIDs {
					key := fmt.Sprintf("%d:%d", tt.personCMID, sessionCMID)
					service.TrackProcessedCompositeKey(key, tt.year)
				}
			}

			if len(service.ProcessedKeys) != tt.wantTrackedCount {
				t.Errorf("ProcessedKeys count = %d, want %d", len(service.ProcessedKeys), tt.wantTrackedCount)
			}

			// Verify the key format matches what deleteOrphans expects
			for _, sessionCMID := range tt.sessionCMIDs {
				if tt.staffStatus != "active" && tt.bunkStaff {
					expectedKey := fmt.Sprintf("%d:%d|%d", tt.personCMID, sessionCMID, tt.year)
					if !service.ProcessedKeys[expectedKey] {
						t.Errorf("expected key %q to be tracked, but it wasn't", expectedKey)
					}
				}
			}
		})
	}
}

// TestBunkAssignmentsSync_OrphanProtectionKeyFormat verifies that the composite
// key format used for orphan protection matches the format used by deleteOrphans.
func TestBunkAssignmentsSync_OrphanProtectionKeyFormat(t *testing.T) {
	// The protection code uses TrackProcessedCompositeKey("personCMID:sessionCMID", year)
	// which produces "personCMID:sessionCMID|year".
	// The deleteOrphans code produces keys as "personCMID:sessionCMID|year".
	// These must match for the protection to work.

	service := BaseSyncService{
		ProcessedKeys: make(map[string]bool),
	}

	personCMID := 3000001
	sessionCMID := 5001
	year := 2025

	// Track as protection code would
	protectionKey := fmt.Sprintf("%d:%d", personCMID, sessionCMID)
	service.TrackProcessedCompositeKey(protectionKey, year)

	// Build as deleteOrphans would (from bunk_assignments_test.go pattern)
	orphanKey := fmt.Sprintf("%d:%d|%d", personCMID, sessionCMID, year)

	if !service.ProcessedKeys[orphanKey] {
		t.Errorf("protection key doesn't match orphan detection key format\n  protection: %q\n  orphan:     %q",
			protectionKey+fmt.Sprintf("|%d", year), orphanKey)
	}
}

func TestBunkAssignmentsSync_StaffSkipLogicIntegration(t *testing.T) {
	// Integration test: verifies the complete staff assignment resolution flow.
	//
	// When findMatchingSession returns 0 (person not in attendees),
	// the staff fallback path should use bunkPlanBunkToSession to resolve the session.
	// Non-staff, non-enrolled persons should be skipped.

	staffPersonCMIDs := map[int]bool{
		3000001: true, // Bunk staff (fictional)
	}
	bunkPlanBunkToSession := map[string]int{
		"12424:200": 5001, // Plan 12424 + Bunk 200 → Session 5001
	}

	s := &BunkAssignmentsSync{}

	tests := []struct {
		name              string
		personCMID        int
		bunkPlanID        int
		bunkID            int
		personEnrollments map[int][]int
		bpSessionsList    map[int][]int
		wantSessionID     int
		wantSkipped       bool
	}{
		{
			name:       "camper resolved via enrollment intersection",
			personCMID: 1000001,
			bunkPlanID: 12424,
			bunkID:     200,
			personEnrollments: map[int][]int{
				1000001: {5001, 5002},
			},
			bpSessionsList: map[int][]int{
				12424: {5001, 5003},
			},
			wantSessionID: 5001,
			wantSkipped:   false,
		},
		{
			name:              "staff resolved via bunkPlanBunkToSession fallback",
			personCMID:        3000001,
			bunkPlanID:        12424,
			bunkID:            200,
			personEnrollments: map[int][]int{}, // Staff not in attendees
			bpSessionsList: map[int][]int{
				12424: {5001, 5003},
			},
			wantSessionID: 5001,
			wantSkipped:   false,
		},
		{
			name:              "non-staff non-camper is skipped",
			personCMID:        9999999,
			bunkPlanID:        12424,
			bunkID:            200,
			personEnrollments: map[int][]int{},
			bpSessionsList: map[int][]int{
				12424: {5001},
			},
			wantSessionID: 0,
			wantSkipped:   true,
		},
		{
			name:              "staff with unknown bunk+plan combo is skipped",
			personCMID:        3000001,
			bunkPlanID:        99999,
			bunkID:            999,
			personEnrollments: map[int][]int{},
			bpSessionsList: map[int][]int{
				99999: {5001},
			},
			wantSessionID: 0,
			wantSkipped:   true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Replicate the resolution logic from the Sync loop
			personSessions := tt.personEnrollments[tt.personCMID]
			bunkPlanSessions := tt.bpSessionsList[tt.bunkPlanID]

			// Step 1: Camper path (enrollment intersection)
			sessionID := s.findMatchingSession(personSessions, bunkPlanSessions)

			// Step 2: Staff fallback via (bunkPlan, bunk) → session
			if sessionID == 0 && staffPersonCMIDs[tt.personCMID] {
				key := fmt.Sprintf("%d:%d", tt.bunkPlanID, tt.bunkID)
				if sid, ok := bunkPlanBunkToSession[key]; ok {
					sessionID = sid
				}
			}

			skipped := sessionID == 0

			if sessionID != tt.wantSessionID {
				t.Errorf("sessionID = %d, want %d", sessionID, tt.wantSessionID)
			}
			if skipped != tt.wantSkipped {
				t.Errorf("skipped = %v, want %v", skipped, tt.wantSkipped)
			}
		})
	}
}
