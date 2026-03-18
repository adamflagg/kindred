package rbac

import (
	"testing"
	"time"
)

func TestBuildLastLoginTimestamp(t *testing.T) {
	str := buildLastLoginTimestamp()
	if str == "" {
		t.Fatal("expected non-empty timestamp string")
	}

	// Verify the timestamp is valid and in expected PocketBase format
	_, err := time.Parse("2006-01-02 15:04:05.000Z", str)
	if err != nil {
		t.Fatalf("last_login timestamp %q does not match PocketBase format: %v", str, err)
	}
}

func TestHasGroup(t *testing.T) {
	tests := []struct {
		name     string
		rawUser  map[string]any
		group    string
		expected bool
	}{
		{
			name:     "group present in string slice",
			rawUser:  map[string]any{"groups": []any{"users", "admin"}},
			group:    "admin",
			expected: true,
		},
		{
			name:     "group not present",
			rawUser:  map[string]any{"groups": []any{"users", "editors"}},
			group:    "admin",
			expected: false,
		},
		{
			name:     "no groups claim",
			rawUser:  map[string]any{"email": "test@example.com"},
			group:    "admin",
			expected: false,
		},
		{
			name:     "groups is nil",
			rawUser:  map[string]any{"groups": nil},
			group:    "admin",
			expected: false,
		},
		{
			name:     "groups is empty",
			rawUser:  map[string]any{"groups": []any{}},
			group:    "admin",
			expected: false,
		},
		{
			name:     "groups is non-slice type",
			rawUser:  map[string]any{"groups": "admin"},
			group:    "admin",
			expected: false,
		},
		{
			name:     "nil rawUser",
			rawUser:  nil,
			group:    "admin",
			expected: false,
		},
		{
			name:     "empty group name skips check",
			rawUser:  map[string]any{"groups": []any{"admin"}},
			group:    "",
			expected: false,
		},
		{
			name:     "case sensitive match",
			rawUser:  map[string]any{"groups": []any{"Admin"}},
			group:    "admin",
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := hasGroup(tt.rawUser, tt.group)
			if result != tt.expected {
				t.Errorf("hasGroup() = %v, want %v", result, tt.expected)
			}
		})
	}
}
