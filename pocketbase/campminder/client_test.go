// Package campminder provides a client for interacting with the CampMinder API
package campminder

import (
	"testing"
)

func TestParseRateLimitSeconds_StandardFormat(t *testing.T) {
	client := &Client{}

	testCases := []struct {
		name     string
		body     string
		expected int
	}{
		{
			name:     "standard rate limit message",
			body:     "Rate limit is exceeded. Try again in 60 seconds.",
			expected: 65, // 60 + 5 buffer
		},
		{
			name:     "short wait time",
			body:     "Rate limit is exceeded. Try again in 5 seconds.",
			expected: 10, // 5 + 5 buffer
		},
		{
			name:     "longer wait time",
			body:     "Rate limit is exceeded. Try again in 120 seconds.",
			expected: 125, // 120 + 5 buffer
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			result := client.parseRateLimitSeconds(tc.body)
			if result != tc.expected {
				t.Errorf("parseRateLimitSeconds(%q) = %d, want %d", tc.body, result, tc.expected)
			}
		})
	}
}

func TestParseRateLimitSeconds_JSONFormat(t *testing.T) {
	client := &Client{}

	testCases := []struct {
		name     string
		body     string
		expected int
	}{
		{
			name:     "JSON wrapped message",
			body:     `{"message": "Rate limit is exceeded. Try again in 30 seconds."}`,
			expected: 35, // 30 + 5 buffer
		},
		{
			name:     "JSON with other fields",
			body:     `{"error": "rate_limited", "message": "Rate limit is exceeded. Try again in 45 seconds.", "code": 429}`,
			expected: 50, // 45 + 5 buffer
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			result := client.parseRateLimitSeconds(tc.body)
			if result != tc.expected {
				t.Errorf("parseRateLimitSeconds(%q) = %d, want %d", tc.body, result, tc.expected)
			}
		})
	}
}

func TestParseRateLimitSeconds_DefaultFallback(t *testing.T) {
	client := &Client{}

	testCases := []struct {
		name     string
		body     string
		expected int
	}{
		{
			name:     "unparseable message",
			body:     "Some random error message",
			expected: 60, // Default fallback
		},
		{
			name:     "empty string",
			body:     "",
			expected: 60, // Default fallback
		},
		{
			name:     "partial match",
			body:     "Rate limit exceeded",
			expected: 60, // Default fallback (missing exact format)
		},
		{
			name:     "invalid JSON",
			body:     `{"message": `,
			expected: 60, // Default fallback
		},
		{
			name:     "JSON without message field",
			body:     `{"error": "rate_limited", "code": 429}`,
			expected: 60, // Default fallback
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			result := client.parseRateLimitSeconds(tc.body)
			if result != tc.expected {
				t.Errorf("parseRateLimitSeconds(%q) = %d, want %d", tc.body, result, tc.expected)
			}
		})
	}
}

func TestNewClient_MissingConfig(t *testing.T) {
	testCases := []struct {
		name   string
		config *Config
	}{
		{
			name:   "missing API key",
			config: &Config{ClientID: "test", SeasonID: 2025},
		},
		{
			name:   "missing client ID",
			config: &Config{APIKey: "test", SeasonID: 2025},
		},
		{
			name:   "missing season ID",
			config: &Config{APIKey: "test", ClientID: "test"},
		},
		{
			name:   "all missing",
			config: &Config{},
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := NewClient(tc.config)
			if err == nil {
				t.Errorf("NewClient() with %s should return error", tc.name)
			}
		})
	}
}

func TestCloneWithYear(t *testing.T) {
	// Create a mock client (without actually connecting)
	original := &Client{
		apiKey:          "test-api-key",
		subscriptionKey: "test-sub-key",
		clientID:        "test-client",
		seasonID:        2025,
		accessToken:     "test-token",
	}

	// Clone with different year
	cloned := original.CloneWithYear(2024)

	// Verify cloned fields
	if cloned.apiKey != original.apiKey {
		t.Errorf("apiKey = %s, want %s", cloned.apiKey, original.apiKey)
	}

	if cloned.subscriptionKey != original.subscriptionKey {
		t.Errorf("subscriptionKey = %s, want %s", cloned.subscriptionKey, original.subscriptionKey)
	}

	if cloned.clientID != original.clientID {
		t.Errorf("clientID = %s, want %s", cloned.clientID, original.clientID)
	}

	if cloned.accessToken != original.accessToken {
		t.Errorf("accessToken = %s, want %s", cloned.accessToken, original.accessToken)
	}

	// Verify year was changed
	if cloned.seasonID != 2024 {
		t.Errorf("seasonID = %d, want 2024", cloned.seasonID)
	}

	// Verify original wasn't modified
	if original.seasonID != 2025 {
		t.Errorf("original seasonID was modified: %d, want 2025", original.seasonID)
	}
}

func TestGetSeasonID(t *testing.T) {
	client := &Client{seasonID: 2025}

	if client.GetSeasonID() != 2025 {
		t.Errorf("GetSeasonID() = %d, want 2025", client.GetSeasonID())
	}
}

func TestGetClientID(t *testing.T) {
	client := &Client{clientID: "test-client-123"}

	if client.GetClientID() != "test-client-123" {
		t.Errorf("GetClientID() = %s, want test-client-123", client.GetClientID())
	}
}
