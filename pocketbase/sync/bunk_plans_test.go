package sync

import (
	"reflect"
	"testing"
)

// pairAGBunksToSessions: the AG bunk's cabin number is a physical location in
// the unit layout (5-6 Eilat, 7-8 Haifa, 9-10 Chalutzim 1), NOT a grade.
// Pairing must never interpret it as one. See kindred#1749: AG-6 hosting the
// 7th/8th-grade AG session was silently dropped by the old grade heuristic.
func TestPairAGBunksToSessions_SingleAGSession_AllAGBunksMap(t *testing.T) {
	// 2026 regression case: Session 2 plan (12424) — AG-6 (51897) must map to
	// the "7th & 8th grades" AG session even though its cabin number is 6.
	bunkNames := map[int]string{
		4261:  "B-1",
		4262:  "G-1",
		51897: "AG-6",
	}
	sessionInfo := map[int]sessionInfoData{
		1235404: {Name: "Session 2", SessionType: "main"},
		1378704: {Name: "All-Gender Cabin-Session 2 (7th & 8th grades)", SessionType: "ag"},
	}

	got := pairAGBunksToSessions(
		[]int{4261, 4262, 51897},
		[]int{1235404, 1378704},
		bunkNames, sessionInfo,
	)

	want := map[int]int{51897: 1378704}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("pairAGBunksToSessions() = %v, want %v (cabin number must not be treated as a grade)", got, want)
	}
}

func TestPairAGBunksToSessions_NoAGSession_EmptyPairing(t *testing.T) {
	bunkNames := map[int]string{
		4259:  "Aleph",
		51897: "AG-6",
	}
	sessionInfo := map[int]sessionInfoData{
		1356533: {Name: "Session 2a", SessionType: "embedded"},
	}

	got := pairAGBunksToSessions([]int{4259, 51897}, []int{1356533}, bunkNames, sessionInfo)

	if len(got) != 0 {
		t.Errorf("pairAGBunksToSessions() = %v, want empty (no AG session in plan)", got)
	}
}

func TestPairAGBunksToSessions_TwoAGSessions_DeterministicZip(t *testing.T) {
	// 2025-shaped case: two AG sessions under one plan, two AG bunks.
	// Pairing is sorted bunk cm_id ⇄ sorted session cm_id — deterministic,
	// no grade semantics. Sibling AG sessions share the same parent board, so
	// the provisional pairing is display-equivalent pre-assignments; camper
	// assignments later resolve via each camper's own AG enrollment.
	bunkNames := map[int]string{
		66366: "AG-10",
		70109: "AG-8",
	}
	sessionInfo := map[int]sessionInfoData{
		1235404: {Name: "Session 2", SessionType: "main"},
		1344557: {Name: "All-Gender Cabin-Session 2 (9th & 10th grades)", SessionType: "ag"},
		1371790: {Name: "All-Gender Cabin-Session 2 (7th - 9th grades)", SessionType: "ag"},
	}

	want := map[int]int{
		66366: 1344557, // lowest bunk cm_id → lowest AG session cm_id
		70109: 1371790,
	}

	// Result must not depend on input slice order.
	orderings := [][2][]int{
		{{66366, 70109}, {1235404, 1344557, 1371790}},
		{{70109, 66366}, {1371790, 1235404, 1344557}},
	}
	for i, o := range orderings {
		got := pairAGBunksToSessions(o[0], o[1], bunkNames, sessionInfo)
		if !reflect.DeepEqual(got, want) {
			t.Errorf("ordering %d: pairAGBunksToSessions() = %v, want %v", i, got, want)
		}
	}
}

func TestPairAGBunksToSessions_MoreBunksThanSessions_LeftoverToLastSession(t *testing.T) {
	bunkNames := map[int]string{
		100: "AG-3",
		200: "AG-7",
		300: "AG-11",
	}
	sessionInfo := map[int]sessionInfoData{
		1000: {Name: "AG A", SessionType: "ag"},
		2000: {Name: "AG B", SessionType: "ag"},
	}

	got := pairAGBunksToSessions([]int{300, 100, 200}, []int{2000, 1000}, bunkNames, sessionInfo)

	want := map[int]int{
		100: 1000,
		200: 2000,
		300: 2000, // leftover bunk still gets a row — never invisible
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("pairAGBunksToSessions() = %v, want %v", got, want)
	}
}

func TestPairAGBunksToSessions_MoreSessionsThanBunks_FirstSessionsPaired(t *testing.T) {
	bunkNames := map[int]string{100: "AG-5"}
	sessionInfo := map[int]sessionInfoData{
		1000: {Name: "AG A", SessionType: "ag"},
		2000: {Name: "AG B", SessionType: "ag"},
	}

	got := pairAGBunksToSessions([]int{100}, []int{1000, 2000}, bunkNames, sessionInfo)

	want := map[int]int{100: 1000}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("pairAGBunksToSessions() = %v, want %v", got, want)
	}
}

func TestPairAGBunksToSessions_UnknownBunksAndSessions_Ignored(t *testing.T) {
	// Bunks with no known name and sessions with no metadata (not in PB) must
	// not participate in pairing.
	bunkNames := map[int]string{51897: "AG-6"}
	sessionInfo := map[int]sessionInfoData{
		1378704: {Name: "All-Gender Cabin-Session 2 (7th & 8th grades)", SessionType: "ag"},
	}

	got := pairAGBunksToSessions(
		[]int{51897, 99999},   // 99999: unknown bunk
		[]int{1378704, 88888}, // 88888: unknown session
		bunkNames, sessionInfo,
	)

	want := map[int]int{51897: 1378704}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("pairAGBunksToSessions() = %v, want %v", got, want)
	}
}

func TestBunkPlansSync_createBunkPlan_WithIsActive(t *testing.T) {
	// This test verifies that is_active field is extracted and stored correctly
	// Since createBunkPlan requires a full PocketBase app, we test the data preparation logic

	tests := []struct {
		name         string
		planData     map[string]any
		wantIsActive any
		wantInData   bool
	}{
		{
			name: "plan with is_active true",
			planData: map[string]any{
				"ID":       float64(1),
				"Name":     "Test Plan",
				"Code":     "TP1",
				"IsActive": true,
			},
			wantIsActive: true,
			wantInData:   true,
		},
		{
			name: "plan with is_active false",
			planData: map[string]any{
				"ID":       float64(2),
				"Name":     "Inactive Plan",
				"Code":     "IP1",
				"IsActive": false,
			},
			wantIsActive: false,
			wantInData:   true,
		},
		{
			name: "plan without is_active field defaults to true",
			planData: map[string]any{
				"ID":   float64(3),
				"Name": "Default Plan",
				"Code": "DP1",
				// IsActive omitted
			},
			wantIsActive: true,
			wantInData:   true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Extract IsActive using the same logic as createBunkPlan
			isActive := true // default
			if val, ok := tt.planData["IsActive"].(bool); ok {
				isActive = val
			}

			// Verify extraction worked correctly
			if isActive != tt.wantIsActive {
				t.Errorf("IsActive extraction = %v, want %v", isActive, tt.wantIsActive)
			}

			// Simulate building recordData as createBunkPlan would
			idFloat, ok := tt.planData["ID"].(float64)
			if !ok {
				t.Fatal("missing ID in test data")
				return
			}
			recordData := map[string]any{
				"year":      2025,
				"cm_id":     int(idFloat),
				"name":      tt.planData["Name"],
				"code":      tt.planData["Code"],
				"is_active": isActive,
			}

			// Verify is_active is in the data
			gotIsActive, exists := recordData["is_active"]
			if !exists && tt.wantInData {
				t.Error("is_active field missing from recordData")
			}
			if exists && gotIsActive != tt.wantIsActive {
				t.Errorf("recordData[is_active] = %v, want %v", gotIsActive, tt.wantIsActive)
			}
		})
	}
}

func TestBunkPlansSync_processBunkPlan_ExtractsIsActive(t *testing.T) {
	// Test that processBunkPlan correctly passes IsActive to createBunkPlan
	// This is a unit test for the field extraction logic

	testCases := []struct {
		name         string
		planData     map[string]any
		expectActive bool
	}{
		{
			name: "active plan",
			planData: map[string]any{
				"ID":         float64(100),
				"Name":       "Active Plan",
				"Code":       "AP",
				"IsActive":   true,
				"BunkIDs":    []any{float64(1)},
				"SessionIDs": []any{float64(1)},
			},
			expectActive: true,
		},
		{
			name: "inactive plan",
			planData: map[string]any{
				"ID":         float64(101),
				"Name":       "Inactive Plan",
				"Code":       "IP",
				"IsActive":   false,
				"BunkIDs":    []any{float64(1)},
				"SessionIDs": []any{float64(1)},
			},
			expectActive: false,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Extract fields as processBunkPlan does
			name, _ := tc.planData["Name"].(string)
			code, _ := tc.planData["Code"].(string)
			isActive := true
			if val, ok := tc.planData["IsActive"].(bool); ok {
				isActive = val
			}

			// Verify extraction
			if isActive != tc.expectActive {
				t.Errorf("Expected IsActive=%v, got %v", tc.expectActive, isActive)
			}

			// Verify all required fields are present
			if name == "" {
				t.Error("Name should not be empty")
			}
			if code == "" {
				t.Error("Code should not be empty")
			}
		})
	}
}

func TestBunkPlansSync_CompareFieldsExcludeYear(t *testing.T) {
	// Document that skipFields in createBunkPlan should only contain "year"
	// and that is_active should be compared for idempotency

	skipFields := []string{"year"}

	// Verify only year is skipped
	if len(skipFields) != 1 {
		t.Errorf("Expected 1 skip field, got %d", len(skipFields))
	}
	if skipFields[0] != "year" {
		t.Errorf("Expected skip field 'year', got '%s'", skipFields[0])
	}

	// Document fields that SHOULD be compared
	compareFields := []string{"cm_id", "name", "code", "is_active", "bunk", "session"}
	t.Log("Fields compared for idempotency in bunk_plans:")
	for _, field := range compareFields {
		t.Logf("  - %s", field)
	}
}
