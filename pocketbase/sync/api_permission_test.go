package sync

import (
	"encoding/json"
	"slices"
	"testing"
)

func TestPermissionCheckExactMatch(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name      string
		perms     any
		check     string
		wantFound bool
	}{
		{
			name:      "exact match found",
			perms:     []any{"sync.run", "bunking.view"},
			check:     "sync.run",
			wantFound: true,
		},
		{
			name:      "no substring false positive",
			perms:     []any{"sync.run_extended"},
			check:     "sync.run",
			wantFound: false,
		},
		{
			name:      "empty permissions",
			perms:     []any{},
			check:     "sync.run",
			wantFound: false,
		},
		{
			name:      "nil permissions",
			perms:     nil,
			check:     "sync.run",
			wantFound: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			data, _ := json.Marshal(tt.perms)
			var permSlice []string
			_ = json.Unmarshal(data, &permSlice)
			got := slices.Contains(permSlice, tt.check)
			if got != tt.wantFound {
				t.Errorf("slices.Contains() = %v, want %v", got, tt.wantFound)
			}
		})
	}
}
