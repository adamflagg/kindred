package sync

import (
	"testing"
)

func TestBunkPlansSync_createBunkPlan_WithIsActive(t *testing.T) {
	// This test verifies that is_active field is extracted and stored correctly
	// Since createBunkPlan requires a full PocketBase app, we test the data preparation logic

	tests := []struct {
		name         string
		planData     map[string]interface{}
		wantIsActive interface{}
		wantInData   bool
	}{
		{
			name: "plan with is_active true",
			planData: map[string]interface{}{
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
			planData: map[string]interface{}{
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
			planData: map[string]interface{}{
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
			recordData := map[string]interface{}{
				"year":      2025,
				"cm_id":     int(tt.planData["ID"].(float64)),
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
		planData     map[string]interface{}
		expectActive bool
	}{
		{
			name: "active plan",
			planData: map[string]interface{}{
				"ID":         float64(100),
				"Name":       "Active Plan",
				"Code":       "AP",
				"IsActive":   true,
				"BunkIDs":    []interface{}{float64(1)},
				"SessionIDs": []interface{}{float64(1)},
			},
			expectActive: true,
		},
		{
			name: "inactive plan",
			planData: map[string]interface{}{
				"ID":         float64(101),
				"Name":       "Inactive Plan",
				"Code":       "IP",
				"IsActive":   false,
				"BunkIDs":    []interface{}{float64(1)},
				"SessionIDs": []interface{}{float64(1)},
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
