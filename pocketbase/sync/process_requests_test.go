package sync

import (
	"fmt"
	"reflect"
	"testing"
)

// TestGetSessionNamePattern tests the session name pattern generation
// Session 1 is "Taste of Camp", not "Session 1"
func TestGetSessionNamePattern(t *testing.T) {
	tests := []struct {
		name        string
		sessionNum  string
		wantPattern string
	}{
		{
			name:        "session 1 should match Taste of Camp",
			sessionNum:  "1",
			wantPattern: "Taste of Camp",
		},
		{
			name:        "session 2 should match Session 2",
			sessionNum:  "2",
			wantPattern: "Session 2",
		},
		{
			name:        "session 3 should match Session 3",
			sessionNum:  "3",
			wantPattern: "Session 3",
		},
		{
			name:        "session 4 should match Session 4",
			sessionNum:  "4",
			wantPattern: "Session 4",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := getSessionNamePattern(tt.sessionNum)
			if got != tt.wantPattern {
				t.Errorf("getSessionNamePattern(%q) = %q, want %q", tt.sessionNum, got, tt.wantPattern)
			}
		})
	}
}

// TestIsEmbeddedSession tests detection of embedded sessions (2a, 2b, 3a, etc.)
func TestIsEmbeddedSession(t *testing.T) {
	tests := []struct {
		name       string
		sessionNum string
		want       bool
	}{
		// Main sessions - not embedded
		{"session 1 is main", "1", false},
		{"session 2 is main", "2", false},
		{"session 3 is main", "3", false},
		{"session 4 is main", "4", false},
		// Embedded sessions
		{"session 2a is embedded", "2a", true},
		{"session 2b is embedded", "2b", true},
		{"session 3a is embedded", "3a", true},
		{"session 3b is embedded", "3b", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := isEmbeddedSession(tt.sessionNum)
			if got != tt.want {
				t.Errorf("isEmbeddedSession(%q) = %v, want %v", tt.sessionNum, got, tt.want)
			}
		})
	}
}

// TestBatchStrings tests the helper function that splits slices into batches
func TestBatchStrings(t *testing.T) {
	tests := []struct {
		name      string
		items     []string
		batchSize int
		want      [][]string
	}{
		{
			name:      "empty slice returns empty",
			items:     []string{},
			batchSize: 25,
			want:      [][]string{},
		},
		{
			name:      "slice smaller than batch size returns single batch",
			items:     []string{"a", "b", "c"},
			batchSize: 25,
			want:      [][]string{{"a", "b", "c"}},
		},
		{
			name:      "slice equal to batch size returns single batch",
			items:     []string{"a", "b", "c"},
			batchSize: 3,
			want:      [][]string{{"a", "b", "c"}},
		},
		{
			name:      "slice larger than batch size returns multiple batches",
			items:     []string{"a", "b", "c", "d", "e"},
			batchSize: 2,
			want:      [][]string{{"a", "b"}, {"c", "d"}, {"e"}},
		},
		{
			name:      "78 items into batches of 25",
			items:     makeTestIDs(78),
			batchSize: 25,
			want:      [][]string{makeTestIDs(25), makeTestIDsFrom(25, 25), makeTestIDsFrom(50, 25), makeTestIDsFrom(75, 3)},
		},
		{
			name:      "batch size of 1 returns individual batches",
			items:     []string{"a", "b", "c"},
			batchSize: 1,
			want:      [][]string{{"a"}, {"b"}, {"c"}},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := batchStrings(tt.items, tt.batchSize)
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("batchStrings() = %v, want %v", got, tt.want)
			}
		})
	}
}

// TestBatchStrings_InvalidBatchSize tests edge cases with invalid batch sizes
func TestBatchStrings_InvalidBatchSize(t *testing.T) {
	items := []string{"a", "b", "c"}

	// Zero batch size should return empty (defensive)
	got := batchStrings(items, 0)
	if len(got) != 0 {
		t.Errorf("batchStrings with batchSize=0 should return empty, got %v", got)
	}

	// Negative batch size should return empty (defensive)
	got = batchStrings(items, -1)
	if len(got) != 0 {
		t.Errorf("batchStrings with batchSize=-1 should return empty, got %v", got)
	}
}

// makeTestIDs creates a slice of test IDs like ["id_000", "id_001", ...]
func makeTestIDs(count int) []string {
	return makeTestIDsFrom(0, count)
}

// makeTestIDsFrom creates a slice of test IDs starting from a given index
func makeTestIDsFrom(start, count int) []string {
	result := make([]string, count)
	for i := range count {
		n := start + i
		result[i] = "id_" + fmt.Sprintf("%03d", n)
	}
	return result
}

// TestBuildBatchedFilter tests building filters with batched person IDs
func TestBuildBatchedFilter(t *testing.T) {
	tests := []struct {
		name       string
		baseFilter string
		personIDs  []string
		wantFilter string
	}{
		{
			name:       "empty person IDs returns base filter unchanged",
			baseFilter: "year = 2025 && processed != ''",
			personIDs:  []string{},
			wantFilter: "year = 2025 && processed != ''",
		},
		{
			name:       "single person ID adds OR condition",
			baseFilter: "year = 2025 && processed != ''",
			personIDs:  []string{"abc123"},
			wantFilter: "year = 2025 && processed != '' && (requester = 'abc123')",
		},
		{
			name:       "multiple person IDs joined with OR",
			baseFilter: "year = 2025 && processed != ''",
			personIDs:  []string{"abc123", "def456", "ghi789"},
			wantFilter: "year = 2025 && processed != '' && (requester = 'abc123' || requester = 'def456' || requester = 'ghi789')",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := buildBatchedFilter(tt.baseFilter, tt.personIDs)
			if got != tt.wantFilter {
				t.Errorf("buildBatchedFilter() = %q, want %q", got, tt.wantFilter)
			}
		})
	}
}
