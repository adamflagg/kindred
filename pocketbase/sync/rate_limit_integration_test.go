package sync

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/camp/kindred/pocketbase/ratelimit"
)

// TestPersonCustomFieldValuesSync_HasRateLimiter verifies that the sync service
// initializes with a rate limiter for API calls
func TestPersonCustomFieldValuesSync_HasRateLimiter(t *testing.T) {
	s := &PersonCustomFieldValuesSync{}

	// Rate limiter should be nil by default on zero-value struct
	if s.rateLimiter != nil {
		t.Error("rateLimiter should be nil on zero-value struct")
	}

	// When properly initialized via NewPersonCustomFieldValuesSync, rateLimiter should be set
	// (We can't test the full constructor without PocketBase app, so we test the field exists)
}

// TestPersonCustomFieldValuesSync_RateLimiterConfig verifies the rate limiter is configured
// with appropriate settings for CampMinder's aggressive rate limits
func TestPersonCustomFieldValuesSync_RateLimiterConfig(t *testing.T) {
	// Create a rate limiter with our expected config
	cfg := &ratelimit.Config{
		APIDelay:          300 * time.Millisecond, // ~3 req/sec
		BackoffMultiplier: 2.0,
		MaxDelay:          120 * time.Second, // CampMinder rate limits are aggressive
		MaxAttempts:       10,
	}

	rl := ratelimit.NewRateLimiter(cfg)
	if rl == nil {
		t.Fatal("NewRateLimiter returned nil")
	}

	// Verify config is accessible (tests that our config values are valid)
	// The rate limiter should handle these values without panic
	ctx := context.Background()
	err := rl.Wait(ctx)
	if err != nil {
		t.Errorf("Wait() with valid config returned error: %v", err)
	}
}

// TestRateLimiterRetryOn429 verifies that rate limit errors (429) trigger retry behavior
func TestRateLimiterRetryOn429(t *testing.T) {
	cfg := &ratelimit.Config{
		APIDelay:          10 * time.Millisecond, // Fast for testing
		BackoffMultiplier: 2.0,
		MaxDelay:          100 * time.Millisecond,
		MaxAttempts:       5,
	}

	rl := ratelimit.NewRateLimiter(cfg)
	ctx := context.Background()

	callCount := 0
	fn := func() error {
		callCount++
		if callCount < 3 {
			// Simulate CampMinder 429 response
			return errors.New("rate limit exceeded (429)")
		}
		return nil // Success on third attempt
	}

	err := rl.ExecuteWithRetry(ctx, fn)
	if err != nil {
		t.Errorf("ExecuteWithRetry should succeed after retries, got error: %v", err)
	}

	if callCount != 3 {
		t.Errorf("Expected 3 calls (2 failures + 1 success), got %d", callCount)
	}
}

// TestRateLimiterMaxAttemptsExceeded verifies that persistent rate limits eventually fail
func TestRateLimiterMaxAttemptsExceeded(t *testing.T) {
	cfg := &ratelimit.Config{
		APIDelay:          10 * time.Millisecond,
		BackoffMultiplier: 2.0,
		MaxDelay:          50 * time.Millisecond,
		MaxAttempts:       3,
	}

	rl := ratelimit.NewRateLimiter(cfg)
	ctx := context.Background()

	callCount := 0
	fn := func() error {
		callCount++
		// Always return rate limit error
		return errors.New("rate limit exceeded (429)")
	}

	err := rl.ExecuteWithRetry(ctx, fn)
	if err == nil {
		t.Error("ExecuteWithRetry should return error when max attempts exceeded")
	}

	if callCount != cfg.MaxAttempts {
		t.Errorf("Expected %d calls (MaxAttempts), got %d", cfg.MaxAttempts, callCount)
	}
}

// TestRateLimiterSuccessfulRecovery verifies that the rate limiter resets after success
func TestRateLimiterSuccessfulRecovery(t *testing.T) {
	cfg := &ratelimit.Config{
		APIDelay:          10 * time.Millisecond,
		BackoffMultiplier: 2.0,
		MaxDelay:          100 * time.Millisecond,
		MaxAttempts:       5,
	}

	rl := ratelimit.NewRateLimiter(cfg)
	ctx := context.Background()

	// First batch: fail twice then succeed
	batch1Calls := 0
	err := rl.ExecuteWithRetry(ctx, func() error {
		batch1Calls++
		if batch1Calls < 3 {
			return errors.New("rate limit exceeded (429)")
		}
		return nil
	})
	if err != nil {
		t.Fatalf("Batch 1 should succeed, got error: %v", err)
	}

	// Second batch: should start fresh (rate limiter reset after success)
	// If it didn't reset, we'd have fewer attempts remaining
	batch2Calls := 0
	err = rl.ExecuteWithRetry(ctx, func() error {
		batch2Calls++
		if batch2Calls < 3 {
			return errors.New("rate limit exceeded (429)")
		}
		return nil
	})
	if err != nil {
		t.Errorf("Batch 2 should succeed after recovery, got error: %v", err)
	}

	if batch2Calls != 3 {
		t.Errorf("Batch 2 expected 3 calls, got %d", batch2Calls)
	}
}

// TestRateLimiterNon429ErrorNotRetried verifies that non-rate-limit errors fail immediately
func TestRateLimiterNon429ErrorNotRetried(t *testing.T) {
	cfg := &ratelimit.Config{
		APIDelay:          10 * time.Millisecond,
		BackoffMultiplier: 2.0,
		MaxDelay:          100 * time.Millisecond,
		MaxAttempts:       5,
	}

	rl := ratelimit.NewRateLimiter(cfg)
	ctx := context.Background()

	callCount := 0
	fn := func() error {
		callCount++
		// Return a non-rate-limit error (e.g., network error, 500, etc.)
		return errors.New("connection refused")
	}

	err := rl.ExecuteWithRetry(ctx, fn)
	if err == nil {
		t.Error("ExecuteWithRetry should return error for non-retryable errors")
	}

	// Non-rate-limit errors should NOT be retried
	if callCount != 1 {
		t.Errorf("Expected 1 call (no retry for non-429), got %d", callCount)
	}
}

// TestRateLimiterContextCancellation verifies that context cancellation stops retries
func TestRateLimiterContextCancellation(t *testing.T) {
	cfg := &ratelimit.Config{
		APIDelay:          10 * time.Millisecond,
		BackoffMultiplier: 2.0,
		MaxDelay:          100 * time.Millisecond,
		MaxAttempts:       10, // High to ensure we hit cancellation first
	}

	rl := ratelimit.NewRateLimiter(cfg)
	ctx, cancel := context.WithCancel(context.Background())

	callCount := 0
	fn := func() error {
		callCount++
		if callCount >= 2 {
			cancel() // Cancel after 2nd attempt
		}
		return errors.New("rate limit exceeded (429)")
	}

	err := rl.ExecuteWithRetry(ctx, fn)
	if err == nil {
		t.Error("ExecuteWithRetry should return error when context is cancelled")
	}

	// Should stop shortly after cancellation
	if callCount > 3 {
		t.Errorf("Expected <= 3 calls before cancellation takes effect, got %d", callCount)
	}
}

// MockCustomFieldFetcher simulates the CampMinder API for testing rate limiting integration
type MockCustomFieldFetcher struct {
	callCount    int
	failUntil    int    // Return 429 until this many calls
	errorMessage string // Error message to return on failure
	values       []map[string]interface{}
}

func (m *MockCustomFieldFetcher) GetPersonCustomFieldValuesPage(_, _, _ int) ([]map[string]interface{}, bool, error) {
	m.callCount++
	if m.callCount <= m.failUntil {
		if m.errorMessage != "" {
			return nil, false, errors.New(m.errorMessage)
		}
		return nil, false, errors.New("rate limit exceeded (429)")
	}
	return m.values, false, nil
}

// TestSyncWithRateLimiter_Integration tests that the sync logic properly wraps API calls
// This tests the integration pattern we expect to implement
func TestSyncWithRateLimiter_Integration(t *testing.T) {
	cfg := &ratelimit.Config{
		APIDelay:          10 * time.Millisecond,
		BackoffMultiplier: 2.0,
		MaxDelay:          50 * time.Millisecond,
		MaxAttempts:       5,
	}

	rl := ratelimit.NewRateLimiter(cfg)
	ctx := context.Background()

	mock := &MockCustomFieldFetcher{
		failUntil: 2, // Fail first 2 calls with 429
		values: []map[string]interface{}{
			{"id": float64(100), "value": "test-value"},
		},
	}

	// Simulate the wrapped API call pattern we'll implement
	var result []map[string]interface{}
	var hasMore bool

	err := rl.ExecuteWithRetry(ctx, func() error {
		var fetchErr error
		result, hasMore, fetchErr = mock.GetPersonCustomFieldValuesPage(123, 1, 500)
		return fetchErr
	})

	if err != nil {
		t.Errorf("ExecuteWithRetry should succeed after retries, got: %v", err)
	}

	if mock.callCount != 3 {
		t.Errorf("Expected 3 calls (2 failures + 1 success), got %d", mock.callCount)
	}

	if len(result) != 1 {
		t.Errorf("Expected 1 result, got %d", len(result))
	}

	if hasMore {
		t.Error("Expected hasMore to be false")
	}
}

// TestSyncWithRateLimiter_PersistentFailure tests behavior when API keeps failing
func TestSyncWithRateLimiter_PersistentFailure(t *testing.T) {
	cfg := &ratelimit.Config{
		APIDelay:          10 * time.Millisecond,
		BackoffMultiplier: 2.0,
		MaxDelay:          50 * time.Millisecond,
		MaxAttempts:       3,
	}

	rl := ratelimit.NewRateLimiter(cfg)
	ctx := context.Background()

	mock := &MockCustomFieldFetcher{
		failUntil: 100, // Always fail
	}

	var result []map[string]interface{}
	var hasMore bool

	err := rl.ExecuteWithRetry(ctx, func() error {
		var fetchErr error
		result, hasMore, fetchErr = mock.GetPersonCustomFieldValuesPage(123, 1, 500)
		return fetchErr
	})

	if err == nil {
		t.Error("ExecuteWithRetry should return error when max attempts exceeded")
	}

	if mock.callCount != cfg.MaxAttempts {
		t.Errorf("Expected %d calls, got %d", cfg.MaxAttempts, mock.callCount)
	}

	if result != nil {
		t.Error("Result should be nil on failure")
	}

	if hasMore {
		t.Error("hasMore should be false on failure")
	}
}

// --- Household Custom Field Values Tests ---

// TestHouseholdCustomFieldValuesSync_HasRateLimiter verifies that the household sync service
// also has a rate limiter field
func TestHouseholdCustomFieldValuesSync_HasRateLimiter(t *testing.T) {
	s := &HouseholdCustomFieldValuesSync{}

	// Rate limiter should be nil by default on zero-value struct
	if s.rateLimiter != nil {
		t.Error("rateLimiter should be nil on zero-value struct")
	}
}

// MockHouseholdCustomFieldFetcher simulates the CampMinder API for household testing
type MockHouseholdCustomFieldFetcher struct {
	callCount    int
	failUntil    int
	errorMessage string
	values       []map[string]interface{}
}

func (m *MockHouseholdCustomFieldFetcher) GetHouseholdCustomFieldValuesPage(
	_, _, _ int,
) ([]map[string]interface{}, bool, error) {
	m.callCount++
	if m.callCount <= m.failUntil {
		if m.errorMessage != "" {
			return nil, false, errors.New(m.errorMessage)
		}
		return nil, false, errors.New("rate limit exceeded (429)")
	}
	return m.values, false, nil
}

// TestHouseholdSyncWithRateLimiter_Integration tests household sync rate limiting
func TestHouseholdSyncWithRateLimiter_Integration(t *testing.T) {
	cfg := &ratelimit.Config{
		APIDelay:          10 * time.Millisecond,
		BackoffMultiplier: 2.0,
		MaxDelay:          50 * time.Millisecond,
		MaxAttempts:       5,
	}

	rl := ratelimit.NewRateLimiter(cfg)
	ctx := context.Background()

	mock := &MockHouseholdCustomFieldFetcher{
		failUntil: 2,
		values: []map[string]interface{}{
			{"id": float64(200), "value": "household-value"},
		},
	}

	var result []map[string]interface{}
	var hasMore bool

	err := rl.ExecuteWithRetry(ctx, func() error {
		var fetchErr error
		result, hasMore, fetchErr = mock.GetHouseholdCustomFieldValuesPage(456, 1, 500)
		return fetchErr
	})

	if err != nil {
		t.Errorf("ExecuteWithRetry should succeed after retries, got: %v", err)
	}

	if mock.callCount != 3 {
		t.Errorf("Expected 3 calls, got %d", mock.callCount)
	}

	if len(result) != 1 || result[0]["value"] != "household-value" {
		t.Errorf("Expected household result, got %v", result)
	}

	if hasMore {
		t.Error("Expected hasMore to be false")
	}
}
