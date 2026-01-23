package sync

import (
	"testing"
	"time"
)

// TestCompositeKey tests the CompositeKey function
func TestCompositeKey(t *testing.T) {
	tests := []struct {
		name     string
		id       interface{}
		year     int
		expected string
	}{
		{"integer ID", 12345, 2024, "12345|2024"},
		{"string ID", "abc123", 2025, "abc123|2025"},
		{"zero ID", 0, 2024, "0|2024"},
		{"negative year", 100, -1, "100|-1"},
		{"large ID", 12345678901234, 2024, "12345678901234|2024"},
		{"float ID", 123.456, 2024, "123.456|2024"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := CompositeKey(tt.id, tt.year)
			if result != tt.expected {
				t.Errorf("CompositeKey(%v, %d) = %q, want %q",
					tt.id, tt.year, result, tt.expected)
			}
		})
	}
}

// TestFieldEquals tests field value comparison
func TestFieldEquals(t *testing.T) {
	b := &BaseSyncService{}

	tests := []struct {
		name     string
		existing interface{}
		newVal   interface{}
		expected bool
	}{
		// Nil and empty equivalence
		{"nil vs empty string", nil, "", true},
		{"empty string vs nil", "", nil, true},
		{"nil vs zero int", nil, 0, true},
		{"zero int vs nil", 0, nil, true},

		// String comparison
		{"same strings", "hello", "hello", true},
		{"different strings", "hello", "world", false},

		// Integer comparison
		{"same ints", 42, 42, true},
		{"different ints", 42, 43, false},

		// Float vs int comparison
		{"float64 vs int", float64(42), 42, true},
		{"int vs float64", 42, float64(42), true},
		{"float64 vs different int", float64(42), 43, false},

		// Boolean comparison
		{"same bools true", true, true, true},
		{"same bools false", false, false, true},
		{"different bools", true, false, false},

		// Boolean vs float (SQLite stores as 0/1)
		{"float 1 vs true", float64(1), true, true},
		{"float 0 vs false", float64(0), false, true},
		{"true vs float 1", true, float64(1), true},
		{"false vs float 0", false, float64(0), true},
		{"float 1 vs false", float64(1), false, false},

		// Date normalization
		{"date with Z vs without", "2024-01-15T10:00:00Z", "2024-01-15 10:00:00", true},
		{"date with milliseconds", "2024-01-15T10:00:00.123Z", "2024-01-15 10:00:00", true},
		{"date with timezone", "2024-01-15T10:00:00+00:00", "2024-01-15 10:00:00", true},
		{"different dates", "2024-01-15T10:00:00Z", "2024-01-16 10:00:00", false},

		// JSON comparison
		{"same JSON objects", `{"a":1,"b":2}`, `{"b":2,"a":1}`, true},
		{"different JSON", `{"a":1}`, `{"a":2}`, false},
		{"same JSON arrays", `[1,2,3]`, `[1,2,3]`, true},
		{"different JSON arrays", `[1,2,3]`, `[1,2,4]`, false},

		// Direct comparison
		{"same interface values", interface{}(42), interface{}(42), true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := b.FieldEquals(tt.existing, tt.newVal)
			if result != tt.expected {
				t.Errorf("FieldEquals(%v, %v) = %v, want %v",
					tt.existing, tt.newVal, result, tt.expected)
			}
		})
	}
}

// TestParseRateLimitWait tests rate limit message parsing
func TestParseRateLimitWait(t *testing.T) {
	b := &BaseSyncService{}

	tests := []struct {
		name     string
		message  string
		expected time.Duration
	}{
		{
			"standard 60 second wait",
			"Rate limit is exceeded. Try again in 60 seconds.",
			65 * time.Second, // 60 + 5 buffer
		},
		{
			"30 second wait",
			"Rate limit is exceeded. Try again in 30 seconds.",
			35 * time.Second, // 30 + 5 buffer
		},
		{
			"120 second wait",
			"Rate limit is exceeded. Try again in 120 seconds.",
			125 * time.Second, // 120 + 5 buffer
		},
		{
			"unparseable message",
			"Some other error message",
			60 * time.Second, // default
		},
		{
			"empty message",
			"",
			60 * time.Second, // default
		},
		{
			"malformed rate limit",
			"Rate limit exceeded",
			60 * time.Second, // default
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := b.ParseRateLimitWait(tt.message)
			if result != tt.expected {
				t.Errorf("ParseRateLimitWait(%q) = %v, want %v",
					tt.message, result, tt.expected)
			}
		})
	}
}

// TestNormalizeDateString tests date normalization indirectly via FieldEquals
func TestNormalizeDateString(t *testing.T) {
	b := &BaseSyncService{}

	// These test cases verify date normalization through FieldEquals
	dateFormats := []struct {
		name string
		date string
	}{
		{"ISO with Z", "2024-06-15T14:30:00Z"},
		{"ISO with milliseconds", "2024-06-15T14:30:00.123Z"},
		{"ISO with microseconds", "2024-06-15T14:30:00.123456Z"},
		{"ISO with timezone", "2024-06-15T14:30:00+00:00"},
		{"ISO with negative tz", "2024-06-15T14:30:00-05:00"},
		{"Space separator", "2024-06-15 14:30:00"},
	}

	// All should be considered equal (ignoring milliseconds/timezone)
	canonical := "2024-06-15 14:30:00"
	for _, tt := range dateFormats {
		t.Run(tt.name, func(t *testing.T) {
			if !b.FieldEquals(tt.date, canonical) {
				t.Errorf("FieldEquals(%q, %q) should be true", tt.date, canonical)
			}
		})
	}
}

// TestByteSliceHandling tests FieldEquals with byte slices (types.JSONRaw)
func TestByteSliceHandling(t *testing.T) {
	b := &BaseSyncService{}

	tests := []struct {
		name     string
		existing interface{}
		newVal   interface{}
		expected bool
	}{
		{
			"byte slice JSON vs string JSON",
			[]byte(`{"key":"value"}`),
			`{"key":"value"}`,
			true,
		},
		{
			"byte slice JSON vs different string",
			[]byte(`{"key":"value1"}`),
			`{"key":"value2"}`,
			false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := b.FieldEquals(tt.existing, tt.newVal)
			if result != tt.expected {
				t.Errorf("FieldEquals(%v, %v) = %v, want %v",
					tt.existing, tt.newVal, result, tt.expected)
			}
		})
	}
}

// TestNormalizeToStringSlice tests the normalizeToStringSlice helper function
func TestNormalizeToStringSlice(t *testing.T) {
	tests := []struct {
		name     string
		input    any
		expected []string
	}{
		{"nil input", nil, nil},
		{"empty []string", []string{}, []string{}},
		{"[]string with values", []string{"a", "b", "c"}, []string{"a", "b", "c"}},
		{"empty []interface{}", []interface{}{}, []string{}},
		{"[]interface{} with strings", []interface{}{"x", "y", "z"}, []string{"x", "y", "z"}},
		{"[]interface{} with non-strings", []interface{}{"a", 123}, nil},
		{"[]any with strings", []any{"p", "q"}, []string{"p", "q"}},
		{"[]any with mixed types", []any{"a", true}, nil},
		// Single string is intentionally converted to []string{str} because
		// PocketBase returns single-value relations as string, not []string
		{"single string", "not a slice", []string{"not a slice"}},
		{"empty string", "", []string{}},
		{"int type", 42, nil},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := normalizeToStringSlice(tt.input)
			if tt.expected == nil {
				if result != nil {
					t.Errorf("normalizeToStringSlice(%v) = %v, want nil", tt.input, result)
				}
			} else {
				switch {
				case result == nil:
					t.Errorf("normalizeToStringSlice(%v) = nil, want %v", tt.input, tt.expected)
				case len(result) != len(tt.expected):
					t.Errorf("normalizeToStringSlice(%v) len = %d, want %d", tt.input, len(result), len(tt.expected))
				default:
					for i, v := range result {
						if v != tt.expected[i] {
							t.Errorf("normalizeToStringSlice(%v)[%d] = %q, want %q", tt.input, i, v, tt.expected[i])
						}
					}
				}
			}
		})
	}
}

// TestFieldEqualsSliceComparison tests FieldEquals with slice types (multi-select relation fields)
func TestFieldEqualsSliceComparison(t *testing.T) {
	b := &BaseSyncService{}

	tests := []struct {
		name     string
		existing interface{}
		newVal   interface{}
		expected bool
	}{
		// Same type comparisons
		{"same []string", []string{"a", "b", "c"}, []string{"a", "b", "c"}, true},
		{"different []string", []string{"a", "b"}, []string{"a", "c"}, false},
		{"different length []string", []string{"a", "b"}, []string{"a", "b", "c"}, false},

		// Cross-type comparisons (PocketBase returns []interface{}, we set []string)
		{"[]interface{} vs []string same", []interface{}{"id1", "id2"}, []string{"id1", "id2"}, true},
		{"[]string vs []interface{} same", []string{"id1", "id2"}, []interface{}{"id1", "id2"}, true},
		{"[]interface{} vs []string different", []interface{}{"id1", "id2"}, []string{"id1", "id3"}, false},

		// Order-independent comparison (sorted before compare)
		{"same values different order", []string{"c", "a", "b"}, []string{"a", "b", "c"}, true},
		{"[]interface{} vs []string different order", []interface{}{"z", "x", "y"}, []string{"x", "y", "z"}, true},

		// Empty slices
		{"both empty []string", []string{}, []string{}, true},
		{"empty []interface{} vs empty []string", []interface{}{}, []string{}, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := b.FieldEquals(tt.existing, tt.newVal)
			if result != tt.expected {
				t.Errorf("FieldEquals(%v, %v) = %v, want %v",
					tt.existing, tt.newVal, result, tt.expected)
			}
		})
	}
}
