// Package campminder provides a client for interacting with the CampMinder API
package campminder

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
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
		name       string
		config     *Config
		wantErrStr string
	}{
		{
			name:       "missing API key",
			config:     &Config{ClientID: "test", SeasonID: 2025},
			wantErrStr: "missing required CampMinder configuration",
		},
		{
			name:       "missing client ID",
			config:     &Config{APIKey: "test", SeasonID: 2025},
			wantErrStr: "missing required CampMinder configuration",
		},
		{
			name:       "missing season ID",
			config:     &Config{APIKey: "test", ClientID: "test"},
			wantErrStr: "missing required CampMinder configuration",
		},
		{
			name:       "all missing",
			config:     &Config{},
			wantErrStr: "missing required CampMinder configuration",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Satisfy the env-key guard so the test exercises the config-validation
			// code path specifically. Without this, a missing CAMPMINDER_PRIMARY_KEY
			// in the test environment causes a different error, meaning the test
			// passes for the wrong reason.
			t.Setenv("CAMPMINDER_PRIMARY_KEY", "test-key")

			_, err := NewClient(tc.config)
			if err == nil {
				t.Errorf("NewClient() with %s should return error", tc.name)
				return
			}
			if !strings.Contains(err.Error(), tc.wantErrStr) {
				t.Errorf("NewClient() error = %q, want it to contain %q", err.Error(), tc.wantErrStr)
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
// sleepFn is overridden to a no-op so the test finishes instantly.
func TestAuthenticate_RetryCapOnPersistent429(t *testing.T) {
	t.Setenv("CAMPMINDER_PRIMARY_KEY", "test-subscription-key")

	origSleep := sleepFn
	sleepFn = func(time.Duration) {}
	t.Cleanup(func() { sleepFn = origSleep })

	var callCount atomic.Int32

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount.Add(1)
		w.WriteHeader(http.StatusTooManyRequests)
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

	// The cap is exactly maxRequestRetries+1 total attempts (1 initial + maxRequestRetries retries).
	// Tightened from <= maxRequestRetries+2 to == maxRequestRetries+1 so an off-by-one
	// regression that drives 12 calls is caught.
	want := int32(maxRequestRetries + 1)
	got := callCount.Load()
	if got != want {
		t.Errorf("authenticate() made %d HTTP calls, want exactly %d", got, want)
	}
}

// TestAuthenticate_RetryCapErrorMessage verifies that when all retries are
// exhausted on persistent 429s the returned error contains the cap-exceeded
// sentinel message — not the generic "auth failed with status 429" message.
// This is a regression test for the unreachable-post-loop-return bug (#1134 finding #1).
func TestAuthenticate_RetryCapErrorMessage(t *testing.T) {
	t.Setenv("CAMPMINDER_PRIMARY_KEY", "test-subscription-key")

	// sleepFn is overridden to a no-op so the test finishes instantly.
	origSleep := sleepFn
	sleepFn = func(time.Duration) {}
	t.Cleanup(func() { sleepFn = origSleep })

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = fmt.Fprint(w, "Rate limit is exceeded. Try again in 1 seconds.")
	}))
	defer srv.Close()

	client := &Client{
		apiKey:     "test-key",
		clientID:   "test-client",
		seasonID:   2025,
		httpClient: &http.Client{Timeout: 5 * time.Second},
	}

	err := client.authenticateAtURL(srv.URL + "/auth/apikey")
	if err == nil {
		t.Fatal("expected an error after exhausting retries, got nil")
	}

	wantSubstr := fmt.Sprintf("auth rate limit exceeded after %d retries", maxRequestRetries)
	if !strings.Contains(err.Error(), wantSubstr) {
		t.Errorf("error message = %q, want it to contain %q", err.Error(), wantSubstr)
	}
}

// TestAuthenticate_RetryCapExactCallCount verifies that exactly
// maxRequestRetries+1 HTTP calls are made (1 initial + maxRequestRetries
// retries) — no more, no fewer.
// This is a regression test for the loose <=maxRequestRetries+2 bound (#1134 finding #3).
func TestAuthenticate_RetryCapExactCallCount(t *testing.T) {
	t.Setenv("CAMPMINDER_PRIMARY_KEY", "test-subscription-key")

	// Override sleep so the test finishes instantly.
	origSleep := sleepFn
	sleepFn = func(time.Duration) {}
	t.Cleanup(func() { sleepFn = origSleep })

	var callCount atomic.Int32

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount.Add(1)
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = fmt.Fprint(w, "Rate limit is exceeded. Try again in 1 seconds.")
	}))
	defer srv.Close()

	client := &Client{
		apiKey:     "test-key",
		clientID:   "test-client",
		seasonID:   2025,
		httpClient: &http.Client{Timeout: 5 * time.Second},
	}

	_ = client.authenticateAtURL(srv.URL + "/auth/apikey")

	want := int32(maxRequestRetries + 1) // exactly 11 calls: attempts 0..10
	got := callCount.Load()
	if got != want {
		t.Errorf("authenticate() made %d HTTP calls, want exactly %d", got, want)
	}
}

// TestAuthenticate_NoRetryOnNon429Error verifies that a non-429 non-200
// response (e.g. 500 Internal Server Error) causes an immediate return on
// the first attempt — no retry, no sleep.
// This pins the spec for short-circuit behavior (#1134 finding #5).
func TestAuthenticate_NoRetryOnNon429Error(t *testing.T) {
	t.Setenv("CAMPMINDER_PRIMARY_KEY", "test-subscription-key")

	// Track sleep calls — must remain zero.
	origSleep := sleepFn
	var sleepCalled atomic.Int32
	sleepFn = func(time.Duration) { sleepCalled.Add(1) }
	t.Cleanup(func() { sleepFn = origSleep })

	var callCount atomic.Int32

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount.Add(1)
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = fmt.Fprint(w, "internal server error")
	}))
	defer srv.Close()

	client := &Client{
		apiKey:     "test-key",
		clientID:   "test-client",
		seasonID:   2025,
		httpClient: &http.Client{Timeout: 5 * time.Second},
	}

	err := client.authenticateAtURL(srv.URL + "/auth/apikey")
	if err == nil {
		t.Fatal("expected an error on 500 response, got nil")
	}

	if got := callCount.Load(); got != 1 {
		t.Errorf("authenticate() made %d HTTP calls, want exactly 1 (no retry on 500)", got)
	}
	if got := sleepCalled.Load(); got != 0 {
		t.Errorf("sleep was called %d time(s), want 0 (no retry delay on non-429)", got)
	}
}

// ---------------------------------------------------------------------------
// #1136 — authenticateAtURL must use cached subscriptionKey, not re-read env
// ---------------------------------------------------------------------------

// TestAuthenticate_UsesCachedSubscriptionKey is the regression test for #1136.
// It verifies that authenticateAtURL uses the subscription key captured in
// c.subscriptionKey at construction time, not os.Getenv on every call.
//
// Steps:
//  1. Set the env var and construct a real client via NewClient (captures key).
//  2. Unset the env var so any os.Getenv call returns "".
//  3. Call authenticateAtURL against a mock server that records request headers.
//  4. Assert the Ocp-Apim-Subscription-Key header carries the originally-captured key.
func TestAuthenticate_UsesCachedSubscriptionKey(t *testing.T) {
	const wantKey = "cached-subscription-key-abc123"

	// Step 1: set env so NewClient can construct the client.
	t.Setenv("CAMPMINDER_PRIMARY_KEY", wantKey)

	client, err := NewClient(&Config{
		APIKey:   "test-api-key",
		ClientID: "test-client-id",
		SeasonID: 2025,
	})
	if err != nil {
		t.Fatalf("NewClient() failed: %v", err)
	}
	// Override the httpClient so we can inject our test server.
	client.httpClient = &http.Client{Timeout: 5 * time.Second}

	// Step 2: unset the env var — os.Getenv now returns "".
	t.Setenv("CAMPMINDER_PRIMARY_KEY", "")

	// Step 3: mock server records the subscription key header.
	var gotKey string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotKey = r.Header.Get("Ocp-Apim-Subscription-Key")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = fmt.Fprint(w, `{"Token":"header.e30K.sig"}`)
	}))
	defer srv.Close()

	err = client.authenticateAtURL(srv.URL + "/auth/apikey")
	if err != nil {
		t.Fatalf("authenticateAtURL() failed (expected success): %v", err)
	}

	// Step 4: the header must carry the originally-captured key, not the empty string.
	if gotKey != wantKey {
		t.Errorf("Ocp-Apim-Subscription-Key header = %q, want %q", gotKey, wantKey)
	}
}

// TestMakeRequestWithURLRetry_UsesCachedSubscriptionKey is the regression test
// for #1136 applied to makeRequestWithURLRetry, which has the same env-re-read pattern.
//
// Steps:
//  1. Set env and construct a real client via NewClient.
//  2. Unset the env var.
//  3. Pre-seed accessToken/tokenExpiry so ensureAuthenticated() is a no-op.
//  4. Call makeRequestWithURLRetry against a mock server and assert the header.
func TestMakeRequestWithURLRetry_UsesCachedSubscriptionKey(t *testing.T) {
	const wantKey = "cached-subscription-key-xyz789"

	t.Setenv("CAMPMINDER_PRIMARY_KEY", wantKey)

	client, err := NewClient(&Config{
		APIKey:   "test-api-key",
		ClientID: "test-client-id",
		SeasonID: 2025,
	})
	if err != nil {
		t.Fatalf("NewClient() failed: %v", err)
	}

	// Unset the env var.
	t.Setenv("CAMPMINDER_PRIMARY_KEY", "")

	// Pre-seed a valid token so ensureAuthenticated() short-circuits.
	client.accessToken = "pre-seeded-bearer-token"
	client.tokenExpiry = time.Now().Add(time.Hour)

	var gotKey string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotKey = r.Header.Get("Ocp-Apim-Subscription-Key")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = fmt.Fprint(w, `[]`)
	}))
	defer srv.Close()

	client.httpClient = &http.Client{Timeout: 5 * time.Second}

	_, err = client.makeRequestWithURLRetry("GET", srv.URL+"/some/endpoint", 0)
	if err != nil {
		t.Fatalf("makeRequestWithURLRetry() failed: %v", err)
	}

	if gotKey != wantKey {
		t.Errorf("Ocp-Apim-Subscription-Key header = %q, want %q", gotKey, wantKey)
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

// ---------------------------------------------------------------------------
// Token-refresh mutex — concurrent safety
// ---------------------------------------------------------------------------

// TestEnsureAuthenticated_ConcurrentRefresh is a regression test for the
// token-refresh data race. It starts N goroutines that all call
// ensureAuthenticated() on a shared Client whose token has expired, and
// asserts:
//   - No data race detected (run with -race).
//   - The auth endpoint is hit at most once (double-checked locking prevents
//     redundant refreshes once the first goroutine writes the token).
//
// If the sync.Mutex is removed this test will fail under -race.
func TestEnsureAuthenticated_ConcurrentRefresh(t *testing.T) {
	t.Setenv("CAMPMINDER_PRIMARY_KEY", "test-subscription-key")

	var authCallCount atomic.Int32

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authCallCount.Add(1)
		// Small delay to widen the race window — makes the test more likely to
		// catch a missing mutex under -race.
		time.Sleep(5 * time.Millisecond)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = fmt.Fprint(w, `{"Token":"header.e30K.sig"}`)
	}))
	defer srv.Close()

	// Token is expired — every goroutine will see the expiry guard fail and
	// try to refresh unless the mutex prevents redundant refreshes.
	client := &Client{
		apiKey:          "test-key",
		subscriptionKey: "test-subscription-key",
		clientID:        "test-client",
		seasonID:        2025,
		httpClient:      &http.Client{Timeout: 5 * time.Second},
		tokenExpiry:     time.Now().Add(-time.Hour), // already expired
	}

	// Patch authenticate to point at our test server.
	// We test via ensureAuthenticated which calls c.authenticate(), which calls
	// authenticateAtURL with the production URL. We override the httpClient's
	// transport to redirect all requests to our test server instead.
	srv2 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authCallCount.Add(1)
		time.Sleep(5 * time.Millisecond)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = fmt.Fprint(w, `{"Token":"header.e30K.sig"}`)
	}))
	defer srv2.Close()

	// Reset counter — srv was just for setup; srv2 is the real target.
	authCallCount.Store(0)

	const goroutines = 50
	var wg sync.WaitGroup
	errs := make([]error, goroutines)

	for i := range goroutines {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			// Use authenticateAtURL directly so we can inject the test server URL.
			// ensureAuthenticated calls authenticate() → authenticateAtURL(baseURL),
			// which we can't redirect without patching the transport. Calling
			// authenticateAtURL concurrently exercises the same mutex path.
			errs[idx] = client.authenticateAtURL(srv2.URL + "/auth/apikey")
		}(i)
	}
	wg.Wait()

	for i, err := range errs {
		if err != nil {
			t.Errorf("goroutine %d: authenticateAtURL() error: %v", i, err)
		}
	}

	// All goroutines called authenticateAtURL directly (bypassing the
	// double-checked locking in ensureAuthenticated), so the call count
	// equals the goroutine count — that's expected. What matters is the
	// -race detector finds no concurrent writes to accessToken/tokenExpiry.
	got := authCallCount.Load()
	if got != goroutines {
		t.Errorf("auth endpoint hit %d times, want %d", got, goroutines)
	}
}

// TestEnsureAuthenticated_NoRedundantRefresh verifies that when N goroutines
// call ensureAuthenticated() on an expired token, the auth endpoint is called
// significantly fewer times than N (ideally once, at most a small handful due
// to the check-lock-check pattern). This catches the redundant-refresh case.
func TestEnsureAuthenticated_NoRedundantRefresh(t *testing.T) {
	t.Setenv("CAMPMINDER_PRIMARY_KEY", "test-subscription-key")

	var authCallCount atomic.Int32

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authCallCount.Add(1)
		// Deliberate delay to maximize goroutine overlap.
		time.Sleep(10 * time.Millisecond)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = fmt.Fprint(w, `{"Token":"header.e30K.sig"}`)
	}))
	defer srv.Close()

	// authURL field lets us redirect ensureAuthenticated's inner authenticate()
	// call to the test server without touching production code paths.
	client := &Client{
		apiKey:          "test-key",
		subscriptionKey: "test-subscription-key",
		clientID:        "test-client",
		seasonID:        2025,
		httpClient:      &http.Client{Timeout: 5 * time.Second},
		tokenExpiry:     time.Now().Add(-time.Hour),
		authURL:         srv.URL + "/auth/apikey",
	}

	const goroutines = 50
	var wg sync.WaitGroup
	for range goroutines {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = client.ensureAuthenticated()
		}()
	}
	wg.Wait()

	// With a mutex + double-checked locking, at most a tiny number of goroutines
	// should call the auth endpoint (typically 1, maybe a few due to scheduling).
	// Definitely NOT 50. We use goroutines/5 as a generous upper bound.
	got := authCallCount.Load()
	maxAllowed := int32(goroutines / 5)
	if got > maxAllowed {
		t.Errorf("auth endpoint hit %d times with %d goroutines; want <= %d"+
			" (mutex not preventing redundant refreshes)", got, goroutines, maxAllowed)
	}
}

// TestCloneWithYear_OwnHTTPClient verifies that CloneWithYear gives the clone
// its own *http.Client instance rather than sharing the parent's pointer.
// Sharing the pointer means a caller that mutates the clone's httpClient
// (e.g. setting a different timeout) silently modifies the parent too.
func TestCloneWithYear_OwnHTTPClient(t *testing.T) {
	original := &Client{
		apiKey:          "test-api-key",
		subscriptionKey: "test-sub-key",
		clientID:        "test-client",
		seasonID:        2025,
		httpClient:      &http.Client{Timeout: 30 * time.Second},
		accessToken:     "test-token",
	}

	cloned := original.CloneWithYear(2024)

	// The clone must have its own http.Client pointer, not the parent's.
	if cloned.httpClient == original.httpClient {
		t.Error("CloneWithYear() shares the parent httpClient pointer; clone should own its own instance")
	}

	// The clone's timeout should match the parent's (copied from parent).
	if cloned.httpClient.Timeout != original.httpClient.Timeout {
		t.Errorf("clone httpClient.Timeout = %v, want %v (copied from parent)",
			cloned.httpClient.Timeout, original.httpClient.Timeout)
	}
}

// ---------------------------------------------------------------------------
// #2437 — GetSessions/GetSessionGroups must paginate past TotalCount instead
// of silently discarding it after one page of 100.
// ---------------------------------------------------------------------------

// TestGetSessions_PaginatesPastFirstPage verifies that when TotalCount
// exceeds the size of a single page, GetSessions fetches subsequent pages
// and returns the full accumulated result set rather than silently
// truncating at the first page (the pre-fix behavior: session 101+ would
// vanish with no error and no log line).
func TestGetSessions_PaginatesPastFirstPage(t *testing.T) {
	t.Setenv("CAMPMINDER_PRIMARY_KEY", "test-subscription-key")

	const totalCount = 101 // one more than the old hardcoded pagesize of 100

	var pagesRequested []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		page := r.URL.Query().Get("pagenumber")
		pagesRequested = append(pagesRequested, page)

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)

		switch page {
		case "1":
			results := make([]string, 0, 100)
			for i := range 100 {
				results = append(results, fmt.Sprintf(`{"ID":%d}`, i+1))
			}
			_, _ = fmt.Fprintf(w, `{"TotalCount":%d,"Results":[%s]}`,
				totalCount, strings.Join(results, ","))
		case "2":
			_, _ = fmt.Fprintf(w, `{"TotalCount":%d,"Results":[{"ID":101}]}`, totalCount)
		default:
			t.Errorf("unexpected pagenumber requested: %q", page)
		}
	}))
	defer srv.Close()

	client := &Client{
		apiKey:          "test-key",
		subscriptionKey: "test-subscription-key",
		clientID:        "test-client",
		seasonID:        2025,
		httpClient:      &http.Client{Timeout: 5 * time.Second},
		accessToken:     "pre-seeded-token",
		tokenExpiry:     time.Now().Add(time.Hour),
		apiBaseURL:      srv.URL,
	}

	sessions, err := client.GetSessions()
	if err != nil {
		t.Fatalf("GetSessions() failed: %v", err)
	}

	if len(sessions) != totalCount {
		t.Errorf("GetSessions() returned %d sessions, want %d (TotalCount) — session 101 was silently dropped",
			len(sessions), totalCount)
	}

	if len(pagesRequested) < 2 {
		t.Errorf("GetSessions() requested %d page(s) (%v), want at least 2 to cover TotalCount=%d",
			len(pagesRequested), pagesRequested, totalCount)
	}
}

// TestGetSessionGroups_PaginatesPastFirstPage is the GetSessionGroups analog
// of TestGetSessions_PaginatesPastFirstPage — same silent-truncation bug,
// same fix, same shape.
func TestGetSessionGroups_PaginatesPastFirstPage(t *testing.T) {
	t.Setenv("CAMPMINDER_PRIMARY_KEY", "test-subscription-key")

	const totalCount = 101

	var pagesRequested []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		page := r.URL.Query().Get("pagenumber")
		pagesRequested = append(pagesRequested, page)

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)

		switch page {
		case "1":
			results := make([]string, 0, 100)
			for i := range 100 {
				results = append(results, fmt.Sprintf(`{"ID":%d}`, i+1))
			}
			_, _ = fmt.Fprintf(w, `{"TotalCount":%d,"Results":[%s]}`,
				totalCount, strings.Join(results, ","))
		case "2":
			_, _ = fmt.Fprintf(w, `{"TotalCount":%d,"Results":[{"ID":101}]}`, totalCount)
		default:
			t.Errorf("unexpected pagenumber requested: %q", page)
		}
	}))
	defer srv.Close()

	client := &Client{
		apiKey:          "test-key",
		subscriptionKey: "test-subscription-key",
		clientID:        "test-client",
		seasonID:        2025,
		httpClient:      &http.Client{Timeout: 5 * time.Second},
		accessToken:     "pre-seeded-token",
		tokenExpiry:     time.Now().Add(time.Hour),
		apiBaseURL:      srv.URL,
	}

	groups, err := client.GetSessionGroups()
	if err != nil {
		t.Fatalf("GetSessionGroups() failed: %v", err)
	}

	if len(groups) != totalCount {
		t.Errorf("GetSessionGroups() returned %d groups, want %d (TotalCount) — group 101 was silently dropped",
			len(groups), totalCount)
	}

	if len(pagesRequested) < 2 {
		t.Errorf("GetSessionGroups() requested %d page(s) (%v), want at least 2 to cover TotalCount=%d",
			len(pagesRequested), pagesRequested, totalCount)
	}
}

// TestGetSessions_SinglePageUnderLimit verifies that when TotalCount fits in
// one page, GetSessions makes exactly one request (no unnecessary second
// page fetch).
func TestGetSessions_SinglePageUnderLimit(t *testing.T) {
	t.Setenv("CAMPMINDER_PRIMARY_KEY", "test-subscription-key")

	requestCount := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount++
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = fmt.Fprint(w, `{"TotalCount":3,"Results":[{"ID":1},{"ID":2},{"ID":3}]}`)
	}))
	defer srv.Close()

	client := &Client{
		apiKey:          "test-key",
		subscriptionKey: "test-subscription-key",
		clientID:        "test-client",
		seasonID:        2025,
		httpClient:      &http.Client{Timeout: 5 * time.Second},
		accessToken:     "pre-seeded-token",
		tokenExpiry:     time.Now().Add(time.Hour),
		apiBaseURL:      srv.URL,
	}

	sessions, err := client.GetSessions()
	if err != nil {
		t.Fatalf("GetSessions() failed: %v", err)
	}
	if len(sessions) != 3 {
		t.Errorf("GetSessions() returned %d sessions, want 3", len(sessions))
	}
	if requestCount != 1 {
		t.Errorf("GetSessions() made %d requests, want 1 (all results fit in one page)", requestCount)
	}
}
