// Package ratelimit provides rate limiting functionality for API calls
package ratelimit

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestDefaultConfig(t *testing.T) {
	cfg := DefaultConfig()

	if cfg == nil {
		t.Fatal("DefaultConfig() returned nil")
	}

	if cfg.APIDelay != 200*time.Millisecond {
		t.Errorf("APIDelay = %v, want 200ms", cfg.APIDelay)
	}

	if cfg.BackoffMultiplier != 2.0 {
		t.Errorf("BackoffMultiplier = %v, want 2.0", cfg.BackoffMultiplier)
	}

	if cfg.MaxDelay != 30*time.Second {
		t.Errorf("MaxDelay = %v, want 30s", cfg.MaxDelay)
	}

	if cfg.MaxAttempts != 5 {
		t.Errorf("MaxAttempts = %v, want 5", cfg.MaxAttempts)
	}
}

func TestNewRateLimiter_WithNilConfig(t *testing.T) {
	rl := NewRateLimiter(nil)

	if rl == nil {
		t.Fatal("NewRateLimiter(nil) returned nil")
	}

	// Should use default config
	if rl.config.APIDelay != 200*time.Millisecond {
		t.Errorf("Default APIDelay = %v, want 200ms", rl.config.APIDelay)
	}
}

func TestNewRateLimiter_WithCustomConfig(t *testing.T) {
	cfg := &Config{
		APIDelay:          100 * time.Millisecond,
		BackoffMultiplier: 1.5,
		MaxDelay:          10 * time.Second,
		MaxAttempts:       3,
	}

	rl := NewRateLimiter(cfg)

	if rl.config.APIDelay != cfg.APIDelay {
		t.Errorf("APIDelay = %v, want %v", rl.config.APIDelay, cfg.APIDelay)
	}

	if rl.config.MaxAttempts != cfg.MaxAttempts {
		t.Errorf("MaxAttempts = %v, want %v", rl.config.MaxAttempts, cfg.MaxAttempts)
	}
}

func TestRateLimiter_Wait(t *testing.T) {
	cfg := &Config{
		APIDelay:          10 * time.Millisecond, // Short delay for testing
		BackoffMultiplier: 2.0,
		MaxDelay:          1 * time.Second,
		MaxAttempts:       3,
	}

	rl := NewRateLimiter(cfg)
	ctx := context.Background()

	start := time.Now()
	err := rl.Wait(ctx)
	elapsed := time.Since(start)

	if err != nil {
		t.Errorf("Wait() returned error: %v", err)
	}

	// First wait should be quick (rate limiter starts with burst of 1)
	if elapsed > 100*time.Millisecond {
		t.Errorf("First Wait() took %v, expected < 100ms", elapsed)
	}
}

func TestRateLimiter_Wait_CancelledContext(t *testing.T) {
	cfg := &Config{
		APIDelay:          1 * time.Second, // Long delay
		BackoffMultiplier: 2.0,
		MaxDelay:          30 * time.Second,
		MaxAttempts:       3,
	}

	rl := NewRateLimiter(cfg)

	// Use up the initial burst
	ctx := context.Background()
	_ = rl.Wait(ctx)

	// Now cancel a waiting request
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately

	err := rl.Wait(ctx)
	if err == nil {
		t.Error("Wait() with canceled context should return error")
	}
}

func TestRateLimiter_HandleError_RateLimitError(t *testing.T) {
	cfg := &Config{
		APIDelay:          100 * time.Millisecond,
		BackoffMultiplier: 2.0,
		MaxDelay:          1 * time.Second,
		MaxAttempts:       3,
	}

	rl := NewRateLimiter(cfg)

	testCases := []struct {
		name        string
		errMsg      string
		shouldRetry bool
		minWaitTime time.Duration
	}{
		{
			name:        "429 error",
			errMsg:      "status 429: Too Many Requests",
			shouldRetry: true,
			minWaitTime: 100 * time.Millisecond,
		},
		{
			name:        "rate limit text",
			errMsg:      "rate limit exceeded",
			shouldRetry: true,
			minWaitTime: 100 * time.Millisecond,
		},
		{
			name:        "not a rate limit error",
			errMsg:      "connection refused",
			shouldRetry: false,
			minWaitTime: 0,
		},
		{
			name:        "generic 500 error",
			errMsg:      "internal server error 500",
			shouldRetry: false,
			minWaitTime: 0,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Reset the rate limiter for each test
			rl = NewRateLimiter(cfg)

			err := errors.New(tc.errMsg)
			shouldRetry, waitTime := rl.HandleError(err)

			if shouldRetry != tc.shouldRetry {
				t.Errorf("HandleError(%q).shouldRetry = %v, want %v", tc.errMsg, shouldRetry, tc.shouldRetry)
			}

			if tc.shouldRetry && waitTime < tc.minWaitTime {
				t.Errorf("HandleError(%q).waitTime = %v, want >= %v", tc.errMsg, waitTime, tc.minWaitTime)
			}

			if !tc.shouldRetry && waitTime != 0 {
				t.Errorf("HandleError(%q).waitTime = %v, want 0 for non-retryable error", tc.errMsg, waitTime)
			}
		})
	}
}

func TestRateLimiter_HandleError_ExponentialBackoff(t *testing.T) {
	cfg := &Config{
		APIDelay:          100 * time.Millisecond,
		BackoffMultiplier: 2.0,
		MaxDelay:          10 * time.Second,
		MaxAttempts:       5,
	}

	rl := NewRateLimiter(cfg)
	rateLimitErr := errors.New("429 rate limit")

	// First error: should return initial delay
	shouldRetry, waitTime1 := rl.HandleError(rateLimitErr)
	if !shouldRetry {
		t.Error("First error should be retryable")
	}

	// Second error: should return increased delay (exponential backoff)
	shouldRetry, waitTime2 := rl.HandleError(rateLimitErr)
	if !shouldRetry {
		t.Error("Second error should be retryable")
	}

	if waitTime2 <= waitTime1 {
		t.Errorf("Second waitTime (%v) should be greater than first (%v)", waitTime2, waitTime1)
	}

	// Third error: continue backoff
	shouldRetry, waitTime3 := rl.HandleError(rateLimitErr)
	if !shouldRetry {
		t.Error("Third error should be retryable")
	}

	if waitTime3 <= waitTime2 {
		t.Errorf("Third waitTime (%v) should be greater than second (%v)", waitTime3, waitTime2)
	}
}

func TestRateLimiter_HandleError_MaxAttempts(t *testing.T) {
	cfg := &Config{
		APIDelay:          100 * time.Millisecond,
		BackoffMultiplier: 2.0,
		MaxDelay:          10 * time.Second,
		MaxAttempts:       3,
	}

	rl := NewRateLimiter(cfg)
	rateLimitErr := errors.New("429 rate limit")

	// First 2 errors should be retryable
	for i := 0; i < 2; i++ {
		shouldRetry, _ := rl.HandleError(rateLimitErr)
		if !shouldRetry {
			t.Errorf("Error %d should be retryable", i+1)
		}
	}

	// Third error should NOT be retryable (MaxAttempts = 3)
	shouldRetry, _ := rl.HandleError(rateLimitErr)
	if shouldRetry {
		t.Error("Error at MaxAttempts should not be retryable")
	}
}

func TestRateLimiter_HandleError_MaxDelay(t *testing.T) {
	cfg := &Config{
		APIDelay:          1 * time.Second,
		BackoffMultiplier: 10.0, // Aggressive multiplier
		MaxDelay:          5 * time.Second,
		MaxAttempts:       10,
	}

	rl := NewRateLimiter(cfg)
	rateLimitErr := errors.New("429 rate limit")

	// Multiple errors to trigger backoff beyond MaxDelay
	var lastWaitTime time.Duration
	for i := 0; i < 5; i++ {
		_, waitTime := rl.HandleError(rateLimitErr)
		lastWaitTime = waitTime
	}

	// Wait time should be capped at MaxDelay
	if lastWaitTime > cfg.MaxDelay {
		t.Errorf("waitTime (%v) exceeded MaxDelay (%v)", lastWaitTime, cfg.MaxDelay)
	}
}

func TestRateLimiter_Success(t *testing.T) {
	cfg := &Config{
		APIDelay:          100 * time.Millisecond,
		BackoffMultiplier: 2.0,
		MaxDelay:          10 * time.Second,
		MaxAttempts:       5,
	}

	rl := NewRateLimiter(cfg)
	rateLimitErr := errors.New("429 rate limit")

	// Trigger some errors to increase consecutive error count
	for i := 0; i < 3; i++ {
		rl.HandleError(rateLimitErr)
	}

	// Verify error count increased
	if rl.consecutiveErrors != 3 {
		t.Errorf("consecutiveErrors = %d, want 3", rl.consecutiveErrors)
	}

	// Call Success to reset
	rl.Success()

	// Verify reset
	if rl.consecutiveErrors != 0 {
		t.Errorf("After Success(), consecutiveErrors = %d, want 0", rl.consecutiveErrors)
	}

	if rl.currentDelay != cfg.APIDelay {
		t.Errorf("After Success(), currentDelay = %v, want %v", rl.currentDelay, cfg.APIDelay)
	}
}

func TestRateLimiter_Success_NoOp_WhenNoErrors(t *testing.T) {
	cfg := &Config{
		APIDelay:          100 * time.Millisecond,
		BackoffMultiplier: 2.0,
		MaxDelay:          10 * time.Second,
		MaxAttempts:       5,
	}

	rl := NewRateLimiter(cfg)
	initialDelay := rl.currentDelay

	// Call Success without any errors - should be no-op
	rl.Success()

	if rl.consecutiveErrors != 0 {
		t.Errorf("consecutiveErrors = %d, want 0", rl.consecutiveErrors)
	}

	if rl.currentDelay != initialDelay {
		t.Errorf("currentDelay changed unexpectedly from %v to %v", initialDelay, rl.currentDelay)
	}
}

func TestRateLimiter_ExecuteWithRetry_Success(t *testing.T) {
	cfg := &Config{
		APIDelay:          10 * time.Millisecond,
		BackoffMultiplier: 2.0,
		MaxDelay:          1 * time.Second,
		MaxAttempts:       3,
	}

	rl := NewRateLimiter(cfg)
	ctx := context.Background()

	callCount := 0
	fn := func() error {
		callCount++
		return nil // Success on first try
	}

	err := rl.ExecuteWithRetry(ctx, fn)
	if err != nil {
		t.Errorf("ExecuteWithRetry() returned error: %v", err)
	}

	if callCount != 1 {
		t.Errorf("Function called %d times, want 1", callCount)
	}
}

func TestRateLimiter_ExecuteWithRetry_EventualSuccess(t *testing.T) {
	cfg := &Config{
		APIDelay:          10 * time.Millisecond,
		BackoffMultiplier: 2.0,
		MaxDelay:          100 * time.Millisecond,
		MaxAttempts:       5,
	}

	rl := NewRateLimiter(cfg)
	ctx := context.Background()

	callCount := 0
	fn := func() error {
		callCount++
		if callCount < 3 {
			return errors.New("429 rate limit")
		}
		return nil // Success on third try
	}

	err := rl.ExecuteWithRetry(ctx, fn)
	if err != nil {
		t.Errorf("ExecuteWithRetry() returned error: %v", err)
	}

	if callCount != 3 {
		t.Errorf("Function called %d times, want 3", callCount)
	}
}

func TestRateLimiter_ExecuteWithRetry_NonRetryableError(t *testing.T) {
	cfg := &Config{
		APIDelay:          10 * time.Millisecond,
		BackoffMultiplier: 2.0,
		MaxDelay:          100 * time.Millisecond,
		MaxAttempts:       5,
	}

	rl := NewRateLimiter(cfg)
	ctx := context.Background()

	callCount := 0
	fn := func() error {
		callCount++
		return errors.New("connection refused") // Not a rate limit error
	}

	err := rl.ExecuteWithRetry(ctx, fn)
	if err == nil {
		t.Error("ExecuteWithRetry() should return error for non-retryable error")
	}

	if callCount != 1 {
		t.Errorf("Function called %d times, want 1 (non-retryable)", callCount)
	}
}

func TestRateLimiter_ExecuteWithRetry_MaxRetriesExceeded(t *testing.T) {
	cfg := &Config{
		APIDelay:          10 * time.Millisecond,
		BackoffMultiplier: 2.0,
		MaxDelay:          50 * time.Millisecond,
		MaxAttempts:       3,
	}

	rl := NewRateLimiter(cfg)
	ctx := context.Background()

	callCount := 0
	fn := func() error {
		callCount++
		return errors.New("429 rate limit") // Always fail with rate limit
	}

	err := rl.ExecuteWithRetry(ctx, fn)
	if err == nil {
		t.Error("ExecuteWithRetry() should return error when max retries exceeded")
	}

	if callCount != cfg.MaxAttempts {
		t.Errorf("Function called %d times, want %d", callCount, cfg.MaxAttempts)
	}
}

func TestRateLimiter_ExecuteWithRetry_ContextCancellation(t *testing.T) {
	cfg := &Config{
		APIDelay:          10 * time.Millisecond,
		BackoffMultiplier: 2.0,
		MaxDelay:          1 * time.Second,
		MaxAttempts:       10,
	}

	rl := NewRateLimiter(cfg)
	ctx, cancel := context.WithCancel(context.Background())

	callCount := 0
	fn := func() error {
		callCount++
		if callCount == 2 {
			cancel() // Cancel after second call
		}
		return errors.New("429 rate limit")
	}

	err := rl.ExecuteWithRetry(ctx, fn)
	if err == nil {
		t.Error("ExecuteWithRetry() should return error when context is canceled")
	}

	// Should have stopped after cancellation
	if callCount > 3 {
		t.Errorf("Function called %d times after cancellation, expected <= 3", callCount)
	}
}

func TestRateLimiter_ConcurrentAccess(_ *testing.T) {
	cfg := &Config{
		APIDelay:          10 * time.Millisecond,
		BackoffMultiplier: 2.0,
		MaxDelay:          100 * time.Millisecond,
		MaxAttempts:       5,
	}

	rl := NewRateLimiter(cfg)

	// Run concurrent operations to test thread safety
	done := make(chan bool)

	for i := 0; i < 10; i++ {
		go func() {
			ctx := context.Background()
			_ = rl.Wait(ctx)
			rl.HandleError(errors.New("429 rate limit"))
			rl.Success()
			done <- true
		}()
	}

	// Wait for all goroutines
	for i := 0; i < 10; i++ {
		<-done
	}

	// Test passed if no race conditions or panics occurred
}
