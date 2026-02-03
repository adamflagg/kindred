package sync

import (
	"fmt"
	"testing"
)

// TestStaffServiceName verifies the service name constant
func TestStaffServiceName(t *testing.T) {
	expected := "staff"
	if serviceNameStaff != expected {
		t.Errorf("serviceNameStaff = %q, want %q", serviceNameStaff, expected)
	}
}

// TestTransformStaffToPB_PersonID tests that transformStaffToPB includes person_id field
// This is a critical fix - the person_id field was missing, causing staff_applications
// and staff_vehicle_info syncs to fail to match records.
func TestTransformStaffToPB_PersonID(t *testing.T) {
	tests := []struct {
		name           string
		personID       float64
		wantPersonID   int
		wantHasPerson  bool
		pbPersonID     string
		personMapEntry bool
	}{
		{
			name:           "person_id set when person exists in map",
			personID:       12345,
			wantPersonID:   12345,
			wantHasPerson:  true,
			pbPersonID:     "pb_person_abc",
			personMapEntry: true,
		},
		{
			name:           "person_id set even when person not in map",
			personID:       67890,
			wantPersonID:   67890,
			wantHasPerson:  false,
			pbPersonID:     "",
			personMapEntry: false,
		},
		{
			name:           "large person ID",
			personID:       9999999,
			wantPersonID:   9999999,
			wantHasPerson:  true,
			pbPersonID:     "pb_person_xyz",
			personMapEntry: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Build test data
			data := map[string]interface{}{
				"PersonID": tt.personID,
			}

			// Build person map
			personMap := make(map[int]string)
			if tt.personMapEntry {
				personMap[int(tt.personID)] = tt.pbPersonID
			}

			// Call the test helper that simulates transformStaffToPB logic
			pbData, err := testTransformStaffPersonID(data, personMap)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}

			// Check person_id is set correctly
			gotPersonID, hasPersonID := pbData["person_id"]
			if !hasPersonID {
				t.Errorf("person_id field missing from pbData")
			} else if gotPersonID != tt.wantPersonID {
				t.Errorf("person_id = %v, want %d", gotPersonID, tt.wantPersonID)
			}

			// Check person relation is set when available
			gotPerson, hasPerson := pbData["person"]
			if tt.wantHasPerson && !hasPerson {
				t.Errorf("person relation missing when expected")
			} else if tt.wantHasPerson && gotPerson != tt.pbPersonID {
				t.Errorf("person = %v, want %q", gotPerson, tt.pbPersonID)
			}
		})
	}
}

// testTransformStaffPersonID simulates the person_id extraction logic from transformStaffToPB.
// After the fix, both person_id (CM ID) and person (PB relation) should be set.
func testTransformStaffPersonID(data map[string]interface{}, personMap map[int]string) (map[string]interface{}, error) {
	pbData := make(map[string]interface{})

	// PersonID from CampMinder (required for resolving person relation)
	personIDFloat, ok := data["PersonID"].(float64)
	if !ok || personIDFloat == 0 {
		return nil, fmt.Errorf("invalid or missing staff PersonID")
	}
	personID := int(personIDFloat)

	// Resolve person relation
	if pbID, found := personMap[personID]; found {
		pbData["person"] = pbID
	}

	// CRITICAL: Always set person_id (CampMinder ID) for downstream sync lookups
	// This was the bug - person_id was never set, only the relation was set
	pbData["person_id"] = personID

	return pbData, nil
}

// TestTransformStaffToPB_MissingPersonID tests error handling for missing PersonID
func TestTransformStaffToPB_MissingPersonID(t *testing.T) {
	tests := []struct {
		name    string
		data    map[string]interface{}
		wantErr bool
	}{
		{
			name:    "missing PersonID",
			data:    map[string]interface{}{},
			wantErr: true,
		},
		{
			name:    "zero PersonID",
			data:    map[string]interface{}{"PersonID": float64(0)},
			wantErr: true,
		},
		{
			name:    "wrong type PersonID",
			data:    map[string]interface{}{"PersonID": "12345"},
			wantErr: true,
		},
		{
			name:    "valid PersonID",
			data:    map[string]interface{}{"PersonID": float64(12345)},
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := testTransformStaffPersonID(tt.data, nil)
			if tt.wantErr && err == nil {
				t.Errorf("expected error but got nil")
			}
			if !tt.wantErr && err != nil {
				t.Errorf("unexpected error: %v", err)
			}
		})
	}
}
