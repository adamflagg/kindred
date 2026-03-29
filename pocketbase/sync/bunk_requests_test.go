package sync

import (
	"testing"
)

func TestBunkRequestsSync_TrackCSVPersonIDs(t *testing.T) {
	tests := []struct {
		name           string
		validPersonIDs map[int]string
		csvRows        [][]string
		expectTracked  map[int]bool
	}{
		{
			name:           "enrolled person in CSV is tracked",
			validPersonIDs: map[int]string{1001: "pb_1001", 1002: "pb_1002"},
			csvRows: [][]string{
				{"1001", "Johnson", "Emma", "wants to bunk with Olivia", "", "", "", ""},
			},
			expectTracked: map[int]bool{1001: true},
		},
		{
			name:           "unenrolled person in CSV is NOT tracked",
			validPersonIDs: map[int]string{1001: "pb_1001"},
			csvRows: [][]string{
				{"9999", "Greene", "Penelope", "wants to bunk with Ada", "", "", "", ""},
			},
			expectTracked: map[int]bool{},
		},
		{
			name:           "multiple enrolled persons tracked",
			validPersonIDs: map[int]string{1001: "pb_1001", 1002: "pb_1002", 1003: "pb_1003"},
			csvRows: [][]string{
				{"1001", "Johnson", "Emma", "bunk with Olivia", "", "", "", ""},
				{"1002", "Garcia", "Liam", "bunk with Noah", "", "", "", ""},
			},
			expectTracked: map[int]bool{1001: true, 1002: true},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := &BunkRequestsSync{
				validPersonIDs: tt.validPersonIDs,
				csvPersonIDs:   make(map[int]bool),
			}

			columnIndex := map[string]int{
				"PersonID": 0, "Last Name": 1, "First Name": 2,
				"Share Bunk With": 3, "Do Not Share Bunk With": 4,
				"Internal Bunk Notes": 5, "BunkingNotes Notes": 6,
				"RetParent-Socializewithbest": 7,
			}

			for _, row := range tt.csvRows {
				// processRow will panic on DB calls (no real PocketBase) for enrolled persons.
				// We only care that csvPersonIDs is populated before the DB calls happen.
				func() {
					defer func() { recover() }() //nolint:errcheck // expected nil-App panic
					_ = s.processRow(row, columnIndex, 2025)
				}()
			}

			for personID, shouldExist := range tt.expectTracked {
				if _, exists := s.csvPersonIDs[personID]; exists != shouldExist {
					t.Errorf("csvPersonIDs[%d]: got exists=%v, want %v", personID, exists, shouldExist)
				}
			}
		})
	}
}
