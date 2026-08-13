package sync

import (
	"testing"
)

func TestBunkRequestsSync_PurgeOrphanedRequests_Logic(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name               string
		csvPersonIDs       map[int]bool
		existingOBRPersons []int
		expectPurged       []int
	}{
		{
			name:               "no orphans — all OBR persons in CSV",
			csvPersonIDs:       map[int]bool{1001: true, 1002: true},
			existingOBRPersons: []int{1001, 1002},
			expectPurged:       []int{},
		},
		{
			name:               "one orphan — person 1003 not in CSV",
			csvPersonIDs:       map[int]bool{1001: true, 1002: true},
			existingOBRPersons: []int{1001, 1002, 1003},
			expectPurged:       []int{1003},
		},
		{
			name:               "multiple orphans",
			csvPersonIDs:       map[int]bool{1001: true},
			existingOBRPersons: []int{1001, 1002, 1003, 1004},
			expectPurged:       []int{1002, 1003, 1004},
		},
		{
			// Note: tests findOrphanedPersonIDs only. purgeOrphanedRequests has an
			// intentional safety guard that skips when csvPersonIDs is empty (protects
			// against wiping all OBRs on fresh deploy or missing CSV).
			name:               "empty CSV — all existing are orphans (pure function)",
			csvPersonIDs:       map[int]bool{},
			existingOBRPersons: []int{1001, 1002},
			expectPurged:       []int{1001, 1002},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			purged := findOrphanedPersonIDs(tt.csvPersonIDs, tt.existingOBRPersons)

			if len(purged) != len(tt.expectPurged) {
				t.Fatalf("got %d purged, want %d: %v", len(purged), len(tt.expectPurged), purged)
			}

			purgedSet := make(map[int]bool)
			for _, id := range purged {
				purgedSet[id] = true
			}
			for _, expected := range tt.expectPurged {
				if !purgedSet[expected] {
					t.Errorf("expected person %d to be purged, but wasn't", expected)
				}
			}
		})
	}
}

func TestFindZombieBRPersonIDs(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name           string
		csvPersonIDs   map[int]bool
		obrPersonIDs   map[int]bool
		brRequesterIDs []int
		expectZombies  []int
	}{
		{
			name:           "no zombies — all BR requesters in CSV",
			csvPersonIDs:   map[int]bool{1001: true, 1002: true},
			obrPersonIDs:   map[int]bool{1001: true, 1002: true},
			brRequesterIDs: []int{1001, 1002},
			expectZombies:  []int{},
		},
		{
			name:           "zombie — BR requester has no OBRs and not in CSV",
			csvPersonIDs:   map[int]bool{1001: true, 1002: true},
			obrPersonIDs:   map[int]bool{1001: true, 1002: true},
			brRequesterIDs: []int{1001, 1002, 1003},
			expectZombies:  []int{1003},
		},
		{
			name:           "not a zombie — BR requester still has OBRs (handled by OBR purge)",
			csvPersonIDs:   map[int]bool{1001: true},
			obrPersonIDs:   map[int]bool{1001: true, 1003: true},
			brRequesterIDs: []int{1001, 1003},
			expectZombies:  []int{},
		},
		{
			name:           "multiple zombies from cancelled families",
			csvPersonIDs:   map[int]bool{1001: true},
			obrPersonIDs:   map[int]bool{1001: true},
			brRequesterIDs: []int{1001, 1002, 1003, 1004},
			expectZombies:  []int{1002, 1003, 1004},
		},
		{
			name:           "BR requester in CSV but no OBRs — not a zombie (CSV is authoritative)",
			csvPersonIDs:   map[int]bool{1001: true, 1002: true},
			obrPersonIDs:   map[int]bool{1001: true},
			brRequesterIDs: []int{1001, 1002},
			expectZombies:  []int{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			zombies := findZombieBRPersonIDs(tt.csvPersonIDs, tt.obrPersonIDs, tt.brRequesterIDs)

			if len(zombies) != len(tt.expectZombies) {
				t.Fatalf("got %d zombies, want %d: %v", len(zombies), len(tt.expectZombies), zombies)
			}

			zombieSet := make(map[int]bool)
			for _, id := range zombies {
				zombieSet[id] = true
			}
			for _, expected := range tt.expectZombies {
				if !zombieSet[expected] {
					t.Errorf("expected person %d to be zombie, but wasn't", expected)
				}
			}
		})
	}
}

func TestBunkRequestsSync_TrackCSVPersonIDs(t *testing.T) {
	t.Parallel()
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
			expectTracked: map[int]bool{9999: false},
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
