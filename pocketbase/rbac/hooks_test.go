package rbac

import (
	"testing"
)

func TestFlattenPermissions(t *testing.T) {
	tests := []struct {
		name     string
		roles    [][]string
		expected []string
	}{
		{
			name:     "single role single permission",
			roles:    [][]string{{"bunking.view"}},
			expected: []string{"bunking.view"},
		},
		{
			name:     "multiple roles with overlap",
			roles:    [][]string{{"bunking.view", "bunking.manage"}, {"bunking.view", "metrics.view"}},
			expected: []string{"bunking.manage", "bunking.view", "metrics.view"},
		},
		{
			name:     "empty roles",
			roles:    [][]string{},
			expected: []string{},
		},
		{
			name:     "role with empty permissions",
			roles:    [][]string{{}},
			expected: []string{},
		},
		{
			name:     "all permissions from multiple roles",
			roles:    [][]string{{"sync.run", "solver.configure"}, {"metrics.view", "metrics.financial"}, {"bunking.view"}},
			expected: []string{"bunking.view", "metrics.financial", "metrics.view", "solver.configure", "sync.run"},
		},
		{
			name:     "completely duplicate roles",
			roles:    [][]string{{"bunking.view", "bunking.manage"}, {"bunking.view", "bunking.manage"}},
			expected: []string{"bunking.manage", "bunking.view"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := flattenPermissions(tt.roles)
			if len(result) != len(tt.expected) {
				t.Errorf("expected %d permissions, got %d: %v", len(tt.expected), len(result), result)
				return
			}
			for i, perm := range result {
				if perm != tt.expected[i] {
					t.Errorf("at index %d: expected %q, got %q", i, tt.expected[i], perm)
				}
			}
		})
	}
}
