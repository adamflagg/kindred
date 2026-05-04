// Package campminder provides a client for interacting with the CampMinder API
package campminder

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
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

// TestGetDivisions_MethodSignature verifies the GetDivisions method exists and has correct signature
// Full integration testing requires CampMinder API credentials
func TestGetDivisions_MethodSignature(t *testing.T) {
	t.Helper() // Mark as test helper to satisfy linter
	client := &Client{
		clientID: "test-client",
		seasonID: 2025,
	}

	// Verify the method exists with correct signature
	// This will fail at compile time if signature is wrong
	// Assigning to a variable confirms the method exists and has the expected type
	var _ = client.GetDivisions
}

// ---------------------------------------------------------------------------
// #1078 — authenticate() retry cap
// ---------------------------------------------------------------------------

// TestAuthenticate_RetryCapOnPersistent429 verifies that authenticate()
// returns an error after maxRequestRetries attempts rather than recursing
// indefinitely when CampMinder sustains a 429 storm on the auth endpoint.
func TestAuthenticate_RetryCapOnPersistent429(t *testing.T) {
	t.Setenv("CAMPMINDER_PRIMARY_KEY", "test-subscription-key")

	var callCount atomic.Int32

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount.Add(1)
		w.WriteHeader(http.StatusTooManyRequests)
		// Return a short wait time (1 second) so the test completes quickly.
		_, _ = fmt.Fprint(w, "Rate limit is exceeded. Try again in 1 seconds.")
	}))
	defer srv.Close()

	client := &Client{
		apiKey:     "test-key",
		clientID:   "test-client",
		seasonID:   2025,
		httpClient: &http.Client{Timeout: 5 * time.Second},
	}

	// authenticateAtURL is the internal helper that accepts a configurable
	// auth URL. Without it we cannot inject a test server.
	err := client.authenticateAtURL(srv.URL + "/auth/apikey")
	if err == nil {
		t.Fatal("expected an error after exhausting retries, got nil")
	}

	// The cap is maxRequestRetries+1 total attempts (1 initial + maxRequestRetries retries).
	// Must be finite and well below an infinite-recursion depth.
	maxExpectedCalls := int32(maxRequestRetries + 2)
	got := callCount.Load()
	if got > maxExpectedCalls {
		t.Errorf("authenticate() made %d HTTP calls, want at most %d (cap not enforced)",
			got, maxExpectedCalls)
	}
	if got == 0 {
		t.Error("authenticate() made no HTTP calls at all")
	}
}

// TestAuthenticate_SucceedsOnFirstAttempt verifies authenticate() succeeds
// and returns nil when the server responds 200 on the first try.
func TestAuthenticate_SucceedsOnFirstAttempt(t *testing.T) {
	t.Setenv("CAMPMINDER_PRIMARY_KEY", "test-subscription-key")

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		// Minimal JWT: header.payload.signature where payload is base64({}).
		// The fallback path sets a 1-hour expiry when exp claim is missing.
		_, _ = fmt.Fprint(w, `{"Token":"header.e30K.sig"}`)
	}))
	defer srv.Close()

	client := &Client{
		apiKey:     "test-key",
		clientID:   "test-client",
		seasonID:   2025,
		httpClient: &http.Client{Timeout: 5 * time.Second},
	}

	err := client.authenticateAtURL(srv.URL + "/auth/apikey")
	if err != nil {
		t.Fatalf("expected nil error on 200 response, got: %v", err)
	}
	if client.accessToken == "" {
		t.Error("expected accessToken to be set after successful auth")
	}
}
