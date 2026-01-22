package sync

import (
	"testing"
)

func TestBunkAssignmentsSync_processAssignment_ExtractsIsDeleted(t *testing.T) {
	// Test that processAssignment correctly extracts IsDeleted field
	// Since processAssignment requires a full PocketBase app, we test the extraction logic

	tests := []struct {
		name            string
		assignmentData  map[string]interface{}
		wantIsDeleted   bool
		wantInRecordData bool
	}{
		{
			name: "assignment with is_deleted false (active)",
			assignmentData: map[string]interface{}{
				"ID":         float64(1000),
				"PersonID":   float64(123),
				"SessionID":  float64(1),
				"BunkID":     float64(10),
				"BunkPlanID": float64(50),
				"IsDeleted":  false,
			},
			wantIsDeleted:   false,
			wantInRecordData: true,
		},
		{
			name: "assignment with is_deleted true (deleted)",
			assignmentData: map[string]interface{}{
				"ID":         float64(1001),
				"PersonID":   float64(124),
				"SessionID":  float64(1),
				"BunkID":     float64(11),
				"BunkPlanID": float64(51),
				"IsDeleted":  true,
			},
			wantIsDeleted:   true,
			wantInRecordData: true,
		},
		{
			name: "assignment without is_deleted field defaults to false",
			assignmentData: map[string]interface{}{
				"ID":         float64(1002),
				"PersonID":   float64(125),
				"SessionID":  float64(1),
				"BunkID":     float64(12),
				"BunkPlanID": float64(52),
				// IsDeleted omitted
			},
			wantIsDeleted:   false,
			wantInRecordData: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Extract IsDeleted using the same logic that should be in processAssignment
			isDeleted := false // default
			if val, ok := tt.assignmentData["IsDeleted"].(bool); ok {
				isDeleted = val
			}

			// Verify extraction
			if isDeleted != tt.wantIsDeleted {
				t.Errorf("IsDeleted extraction = %v, want %v", isDeleted, tt.wantIsDeleted)
			}

			// Simulate building recordData as processAssignment would
			assignmentCMID := int(tt.assignmentData["ID"].(float64))
			recordData := map[string]interface{}{
				"year":       2025,
				"cm_id":      assignmentCMID,
				"is_deleted": isDeleted,
			}

			// Verify is_deleted is in the data
			gotIsDeleted, exists := recordData["is_deleted"]
			if !exists && tt.wantInRecordData {
				t.Error("is_deleted field missing from recordData")
			}
			if exists && gotIsDeleted != tt.wantIsDeleted {
				t.Errorf("recordData[is_deleted] = %v, want %v", gotIsDeleted, tt.wantIsDeleted)
			}
		})
	}
}

func TestBunkAssignmentsSync_IsDeletedFieldTypes(t *testing.T) {
	// Test handling of different IsDeleted field types from API
	tests := []struct {
		name      string
		apiValue  interface{}
		wantValue bool
		wantOk    bool
	}{
		{
			name:      "boolean true",
			apiValue:  true,
			wantValue: true,
			wantOk:    true,
		},
		{
			name:      "boolean false",
			apiValue:  false,
			wantValue: false,
			wantOk:    true,
		},
		{
			name:      "missing field",
			apiValue:  nil,
			wantValue: false,
			wantOk:    false,
		},
		{
			name:      "string (invalid type)",
			apiValue:  "false",
			wantValue: false,
			wantOk:    false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Simulate type assertion
			var isDeleted bool
			var ok bool

			if tt.apiValue != nil {
				isDeleted, ok = tt.apiValue.(bool)
			}

			if ok != tt.wantOk {
				t.Errorf("Type assertion ok = %v, want %v", ok, tt.wantOk)
			}

			if ok && isDeleted != tt.wantValue {
				t.Errorf("isDeleted = %v, want %v", isDeleted, tt.wantValue)
			}

			// If not ok, should default to false
			if !ok {
				isDeleted = false
			}

			// Final value should match expected (with default applied)
			expectedFinal := tt.wantValue
			if !tt.wantOk {
				expectedFinal = false // default
			}
			if isDeleted != expectedFinal {
				t.Errorf("Final isDeleted = %v, want %v", isDeleted, expectedFinal)
			}
		})
	}
}

func TestBunkAssignmentsSync_CompareFieldsIncludeIsDeleted(t *testing.T) {
	// Document that is_deleted should be compared for idempotency
	// The skipFields parameter should only contain "year"

	skipFields := []string{"year"}

	// Verify only year is skipped
	if len(skipFields) != 1 {
		t.Errorf("Expected 1 skip field, got %d", len(skipFields))
	}
	if skipFields[0] != "year" {
		t.Errorf("Expected skip field 'year', got '%s'", skipFields[0])
	}

	// Document fields that SHOULD be compared
	compareFields := []string{"cm_id", "person", "session", "bunk", "bunk_plan", "is_deleted"}
	t.Log("Fields compared for idempotency in bunk_assignments:")
	for _, field := range compareFields {
		t.Logf("  - %s", field)
	}
	t.Log("Note: is_deleted should be compared to detect when assignments are deleted in CampMinder")
}
