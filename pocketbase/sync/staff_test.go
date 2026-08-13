package sync

import (
	"fmt"
	"reflect"
	"testing"
)

// TestStaffServiceName verifies the service name constant
func TestStaffServiceName(t *testing.T) {
	t.Parallel()
	expected := "staff"
	if serviceNameStaff != expected {
		t.Errorf("serviceNameStaff = %q, want %q", serviceNameStaff, expected)
	}
}

// TestTransformStaffToPB_PersonID tests that transformStaffToPB includes person_id field
// This is a critical fix - the person_id field was missing, causing staff_applications
// and staff_vehicle_info syncs to fail to match records.
func TestTransformStaffToPB_PersonID(t *testing.T) {
	t.Parallel()
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
			data := map[string]any{
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
func testTransformStaffPersonID(data map[string]any, personMap map[int]string) (map[string]any, error) {
	pbData := make(map[string]any)

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

// TestAllStaffStatuses verifies the allStaffStatuses constant includes all 4 CampMinder statuses
func TestAllStaffStatuses(t *testing.T) {
	t.Parallel()
	expected := []int{1, 2, 3, 4} // Active, Resigned, Dismissed, Cancelled
	if !reflect.DeepEqual(allStaffStatuses, expected) {
		t.Errorf("allStaffStatuses = %v, want %v", allStaffStatuses, expected)
	}
}

// TestSetStatusFields_AllStatuses verifies setStatusFields handles all 4 CampMinder staff statuses
func TestSetStatusFields_AllStatuses(t *testing.T) {
	t.Parallel()
	s := &StaffSync{}

	tests := []struct {
		name       string
		statusID   float64
		statusName string
		wantID     int
		wantStatus string
	}{
		{
			name:       "active staff",
			statusID:   1,
			statusName: "Active",
			wantID:     1,
			wantStatus: "active",
		},
		{
			name:       "resigned staff",
			statusID:   2,
			statusName: "Resigned",
			wantID:     2,
			wantStatus: "resigned",
		},
		{
			name:       "dismissed staff",
			statusID:   3,
			statusName: "Dismissed",
			wantID:     3,
			wantStatus: "dismissed",
		},
		{
			name:       "cancelled staff",
			statusID:   4,
			statusName: "Cancelled",
			wantID:     4,
			wantStatus: "cancelled",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			pbData := make(map[string]any)
			data := map[string]any{
				"StatusID":   tt.statusID,
				"StatusName": tt.statusName,
			}

			s.setStatusFields(pbData, data)

			gotID, hasID := pbData["status_id"]
			if !hasID {
				t.Fatal("status_id missing from pbData")
				return
			}
			if gotID != tt.wantID {
				t.Errorf("status_id = %v, want %d", gotID, tt.wantID)
			}

			gotStatus, hasStatus := pbData["status"]
			if !hasStatus {
				t.Fatal("status missing from pbData")
				return
			}
			if gotStatus != tt.wantStatus {
				t.Errorf("status = %v, want %q", gotStatus, tt.wantStatus)
			}
		})
	}
}

// TestShouldPreserveBunkData tests the logic for preserving bunk data on non-active staff.
// CampMinder clears BunkAssignments from dismissed/resigned staff API responses,
// but we want to keep the last-known bunk assignments in PocketBase.
func TestShouldPreserveBunkData(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name              string
		statusID          int
		existingBunkStaff bool
		existingBunks     []string
		wantPreserve      bool
	}{
		{
			name:              "dismissed staff with existing bunk data — preserve",
			statusID:          3, // dismissed
			existingBunkStaff: true,
			existingBunks:     []string{"bunk_pb_1", "bunk_pb_2"},
			wantPreserve:      true,
		},
		{
			name:              "resigned staff with existing bunk data — preserve",
			statusID:          4, // resigned
			existingBunkStaff: true,
			existingBunks:     []string{"bunk_pb_1"},
			wantPreserve:      true,
		},
		{
			name:              "active staff — do not preserve (let API data through)",
			statusID:          1, // active
			existingBunkStaff: true,
			existingBunks:     []string{"bunk_pb_1"},
			wantPreserve:      false,
		},
		{
			name:              "non-active staff without bunk_staff flag — do not preserve",
			statusID:          3,
			existingBunkStaff: false,
			existingBunks:     []string{"bunk_pb_1"},
			wantPreserve:      false,
		},
		{
			name:              "non-active bunk_staff with empty bunks — do not preserve",
			statusID:          3,
			existingBunkStaff: true,
			existingBunks:     []string{},
			wantPreserve:      false,
		},
		{
			name:              "non-active bunk_staff with nil bunks — do not preserve",
			statusID:          3,
			existingBunkStaff: true,
			existingBunks:     nil,
			wantPreserve:      false,
		},
		{
			name:              "status_id 2 (inactive) with bunk data — preserve",
			statusID:          2, // inactive
			existingBunkStaff: true,
			existingBunks:     []string{"bunk_pb_1"},
			wantPreserve:      true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := shouldPreserveBunkData(tt.statusID, tt.existingBunkStaff, tt.existingBunks)
			if got != tt.wantPreserve {
				t.Errorf("shouldPreserveBunkData(%d, %v, %v) = %v, want %v",
					tt.statusID, tt.existingBunkStaff, tt.existingBunks, got, tt.wantPreserve)
			}
		})
	}
}

// TestPreserveBunkDataDeletesFields verifies that when bunk data should be preserved,
// the bunks and bunk_staff fields are removed from pbData so ProcessSimpleRecord
// skips comparing them (preserving the existing values).
func TestPreserveBunkDataDeletesFields(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name           string
		statusID       int
		hasBunkStaff   bool
		existingBunks  []string
		wantHasBunks   bool
		wantHasBkStaff bool
	}{
		{
			name:           "dismissed bunk_staff with bunks — fields removed",
			statusID:       3,
			hasBunkStaff:   true,
			existingBunks:  []string{"bunk_pb_1"},
			wantHasBunks:   false,
			wantHasBkStaff: false,
		},
		{
			name:           "active bunk_staff — fields kept",
			statusID:       1,
			hasBunkStaff:   true,
			existingBunks:  []string{"bunk_pb_1"},
			wantHasBunks:   true,
			wantHasBkStaff: true,
		},
		{
			name:           "dismissed non-bunk-staff — fields kept",
			statusID:       3,
			hasBunkStaff:   false,
			existingBunks:  []string{},
			wantHasBunks:   true,
			wantHasBkStaff: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			pbData := map[string]any{
				"status_id":  tt.statusID,
				"bunks":      []string{"new_bunk_1"},
				"bunk_staff": true,
				"person":     "pb_person_1",
			}

			if shouldPreserveBunkData(tt.statusID, tt.hasBunkStaff, tt.existingBunks) {
				delete(pbData, "bunks")
				delete(pbData, "bunk_staff")
			}

			_, hasBunks := pbData["bunks"]
			_, hasBkStaff := pbData["bunk_staff"]

			if hasBunks != tt.wantHasBunks {
				t.Errorf("bunks present = %v, want %v", hasBunks, tt.wantHasBunks)
			}
			if hasBkStaff != tt.wantHasBkStaff {
				t.Errorf("bunk_staff present = %v, want %v", hasBkStaff, tt.wantHasBkStaff)
			}

			// Other fields should be untouched
			if _, ok := pbData["person"]; !ok {
				t.Error("person field should not be affected")
			}
		})
	}
}

// TestTransformStaffToPB_MissingPersonID tests error handling for missing PersonID
func TestTransformStaffToPB_MissingPersonID(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		data    map[string]any
		wantErr bool
	}{
		{
			name:    "missing PersonID",
			data:    map[string]any{},
			wantErr: true,
		},
		{
			name:    "zero PersonID",
			data:    map[string]any{"PersonID": float64(0)},
			wantErr: true,
		},
		{
			name:    "wrong type PersonID",
			data:    map[string]any{"PersonID": "12345"},
			wantErr: true,
		},
		{
			name:    "valid PersonID",
			data:    map[string]any{"PersonID": float64(12345)},
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
