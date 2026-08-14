package sync

import (
	"fmt"
	"testing"
)

// --- Staff inclusion tests (v3 — session-level staff in bunk_assignments) ---

func TestBunkAssignmentsSync_findMatchingSession(t *testing.T) {
	t.Parallel()
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

// TestBunkAssignmentsSync_StaffSessionLookup exercises the PRODUCTION
// resolveStaffSession method against the PRODUCTION s.bunkPlanBunkToSession
// field -- not a locally reimplemented map -- so a change to either one
// makes this test fail. kindred#2264: (bunkPlanCMID, bunkCMID) does NOT map
// to exactly one session; bunk_plans can legitimately list a bunk under
// several sessions of the same plan (e.g. the family plan's 12 bunks, each
// present in all 8 of its sessions), and the old code silently kept
// whichever bunk_plans row PaginateRecords visited last. The field is
// therefore map[string][]int: every candidate session survives, and
// resolveStaffSession reports ambiguity instead of guessing.
func TestBunkAssignmentsSync_StaffSessionLookup(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name          string
		bpBunkToSess  map[string][]int
		bunkPlanCMID  int
		bunkCMID      int
		wantSession   int
		wantAmbiguous bool
	}{
		{
			name: "regular bunk resolves to main session",
			bpBunkToSess: map[string][]int{
				"12424:200": {5001}, // B-3 in plan 12424 → Session 2
				"12424:300": {5002}, // AG-8 in plan 12424 → AG-Session 2
			},
			bunkPlanCMID: 12424,
			bunkCMID:     200,
			wantSession:  5001,
		},
		{
			name: "AG bunk resolves to AG session from same plan",
			bpBunkToSess: map[string][]int{
				"12424:200": {5001},
				"12424:300": {5002},
			},
			bunkPlanCMID: 12424,
			bunkCMID:     300,
			wantSession:  5002,
		},
		{
			name: "embedded session bunk resolves correctly",
			bpBunkToSess: map[string][]int{
				"12500:200": {5010}, // B-3 in plan 12500 → Session 2a (embedded)
			},
			bunkPlanCMID: 12500,
			bunkCMID:     200,
			wantSession:  5010,
		},
		{
			name: "unknown bunk plan returns not found, not ambiguous",
			bpBunkToSess: map[string][]int{
				"12424:200": {5001},
			},
			bunkPlanCMID: 99999,
			bunkCMID:     200,
			wantSession:  0,
		},
		{
			name: "unknown bunk in known plan returns not found, not ambiguous",
			bpBunkToSess: map[string][]int{
				"12424:200": {5001},
			},
			bunkPlanCMID: 12424,
			bunkCMID:     999,
			wantSession:  0,
		},
		{
			name: "bunk shared across several sessions of one plan is ambiguous",
			bpBunkToSess: map[string][]int{
				// The family plan pattern (kindred#2264): one bunk, every
				// session of the plan.
				"20001:200": {5001, 5002, 5003},
			},
			bunkPlanCMID:  20001,
			bunkCMID:      200,
			wantSession:   0,
			wantAmbiguous: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := &BunkAssignmentsSync{bunkPlanBunkToSession: tt.bpBunkToSess}
			sessionCMID, ambiguous := s.resolveStaffSession(tt.bunkPlanCMID, tt.bunkCMID)

			if ambiguous != tt.wantAmbiguous {
				t.Errorf("ambiguous = %v, want %v", ambiguous, tt.wantAmbiguous)
			}
			if sessionCMID != tt.wantSession {
				t.Errorf("sessionCMID = %d, want %d", sessionCMID, tt.wantSession)
			}
		})
	}
}

// TestBunkAssignmentsSync_resolveViaBunk exercises the PRODUCTION
// resolveViaBunk method, which narrows a camper's session candidates to the
// ones the SPECIFIC bunk on this assignment is used for under the plan,
// intersected with the sessions the person is actually enrolled in
// (kindred#2259). It is precise exactly when the bunk pins to fewer
// sessions than the whole plan -- e.g. a main+AG plan where main and AG
// bunks are disjoint sets. When a bunk is shared across every session of
// its plan (the family plan), narrowing by bunk alone still leaves as many
// candidates as the person has weekends, and resolveViaBunk deliberately
// reports no match so the caller falls back to the plan-wide
// findMatchingSession instead of guessing.
func TestBunkAssignmentsSync_resolveViaBunk(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name           string
		bpBunkToSess   map[string][]int
		personSessions []int
		bunkPlanCMID   int
		bunkCMID       int
		wantSession    int
		wantOK         bool
	}{
		{
			name: "bunk pins to a single session the person is enrolled in",
			bpBunkToSess: map[string][]int{
				"12424:200": {5001}, // a main-only bunk
			},
			personSessions: []int{5001, 5002},
			bunkPlanCMID:   12424,
			bunkCMID:       200,
			wantSession:    5001,
			wantOK:         true,
		},
		{
			name: "second bunk of the same plan pins to the other session",
			bpBunkToSess: map[string][]int{
				"12424:300": {5002}, // an AG-only bunk
			},
			personSessions: []int{5001, 5002},
			bunkPlanCMID:   12424,
			bunkCMID:       300,
			wantSession:    5002,
			wantOK:         true,
		},
		{
			name: "bunk shared across every session of the plan is not narrowed",
			bpBunkToSess: map[string][]int{
				// family-plan shape: one bunk, all 3 (of the plan's) sessions
				"20001:200": {5001, 5002, 5003},
			},
			personSessions: []int{5001, 5002}, // enrolled in two family weekends
			bunkPlanCMID:   20001,
			bunkCMID:       200,
			wantOK:         false,
		},
		{
			name:           "bunk not present in the map at all",
			bpBunkToSess:   map[string][]int{},
			personSessions: []int{5001},
			bunkPlanCMID:   99999,
			bunkCMID:       200,
			wantOK:         false,
		},
		{
			name: "candidate session the person is not enrolled in",
			bpBunkToSess: map[string][]int{
				"12424:200": {5001},
			},
			personSessions: []int{5002},
			bunkPlanCMID:   12424,
			bunkCMID:       200,
			wantOK:         false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := &BunkAssignmentsSync{bunkPlanBunkToSession: tt.bpBunkToSess}
			sessionCMID, ok := s.resolveViaBunk(tt.personSessions, tt.bunkPlanCMID, tt.bunkCMID)

			if ok != tt.wantOK {
				t.Errorf("ok = %v, want %v", ok, tt.wantOK)
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
//
// NOTE: this only replicates the tracking logic inline -- it never calls
// protectNonActiveStaffAssignments, so it could not have caught kindred#2287
// (the real function's bunk_assignments filter named a nonexistent column
// and errored on every iteration). For a test that exercises the actual
// function against a live PocketBase app, see
// TestProtectNonActiveStaffAssignments_ProtectsDismissedStaff in
// bunk_assignments_protection_test.go.
func TestBunkAssignmentsSync_NonActiveStaffOrphanProtection(t *testing.T) {
	t.Parallel()
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
	t.Parallel()
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

// TestBunkAssignmentsSync_StaffSkipLogicIntegration exercises the
// PRODUCTION resolution ladder, resolveAssignmentSession, end to end --
// against the production personEnrollments, bunkPlanBunkToSession and
// staffPersonCMIDs fields, not a locally reimplemented copy. Two tests in
// this file used to rebuild the lookup inline (kindred#2264's Traps: "the
// false invariant is not pinned... changing the production map's type
// leaves both compiling and green while testing nothing"); this drives the
// real method so a change to the resolution rule fails this test.
func TestBunkAssignmentsSync_StaffSkipLogicIntegration(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name                  string
		personCMID            int
		bunkPlanID            int
		bunkID                int
		personEnrollments     map[int][]int
		staffPersonCMIDs      map[int]bool
		bunkPlanBunkToSession map[string][]int
		bpSessionsList        map[int][]int
		wantSessionID         int
		wantSkipped           bool
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
			staffPersonCMIDs:  map[int]bool{3000001: true},
			bunkPlanBunkToSession: map[string][]int{
				"12424:200": {5001}, // Plan 12424 + Bunk 200 → Session 5001
			},
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
			staffPersonCMIDs:  map[int]bool{3000001: true},
			bpSessionsList: map[int][]int{
				99999: {5001},
			},
			wantSessionID: 0,
			wantSkipped:   true,
		},
		{
			name:              "staff on an ambiguous bunk+plan combo is skipped, not guessed",
			personCMID:        3000001,
			bunkPlanID:        20001,
			bunkID:            200,
			personEnrollments: map[int][]int{},
			staffPersonCMIDs:  map[int]bool{3000001: true},
			bunkPlanBunkToSession: map[string][]int{
				"20001:200": {5001, 5002, 5003}, // family-plan shape: shared across every session
			},
			bpSessionsList: map[int][]int{
				20001: {5001, 5002, 5003},
			},
			wantSessionID: 0,
			wantSkipped:   true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := &BunkAssignmentsSync{
				personEnrollments:     tt.personEnrollments,
				staffPersonCMIDs:      tt.staffPersonCMIDs,
				bunkPlanBunkToSession: tt.bunkPlanBunkToSession,
			}
			bunkPlanSessions := tt.bpSessionsList[tt.bunkPlanID]

			sessionID, ambiguous := s.resolveAssignmentSession(tt.personCMID, tt.bunkPlanID, tt.bunkID, bunkPlanSessions)
			skipped := sessionID == 0 || ambiguous

			if sessionID != tt.wantSessionID {
				t.Errorf("sessionID = %d, want %d", sessionID, tt.wantSessionID)
			}
			if skipped != tt.wantSkipped {
				t.Errorf("skipped = %v, want %v", skipped, tt.wantSkipped)
			}
		})
	}
}
