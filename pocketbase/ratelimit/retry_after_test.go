package ratelimit

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"
)

// hintedErr is a rate-limit error carrying the server's own wait, the shape
// campminder.RateLimitError has. Its message deliberately lacks "429" and "rate limit": the
// hint alone must mark it as a rate-limit error.
type hintedErr struct{ wait time.Duration }

func (e hintedErr) Error() string             { return "server asked us to back off" }
func (e hintedErr) RetryAfter() time.Duration { return e.wait }

func fastConfig(attempts int) *Config {
	return &Config{
		APIDelay: 10 * time.Millisecond, BackoffMultiplier: 2.0,
		MaxDelay: 100 * time.Millisecond, MaxAttempts: attempts,
	}
}

// TestHandleError_HonoursRetryAfterHint: the wait is the longer of the limiter's own backoff
// and the server's hint, and a wrapped hinted error still counts as a rate-limit error.
func TestHandleError_HonoursRetryAfterHint(t *testing.T) {
	rl := NewRateLimiter(fastConfig(5))

	retry, wait := rl.HandleError(fmt.Errorf("fetch page 1: %w", hintedErr{65 * time.Second}))

	if !retry {
		t.Fatal("HandleError(hinted) shouldRetry = false, want true")
	}
	if wait != 65*time.Second {
		t.Errorf("wait = %v, want the 65s hint (own backoff is 10ms)", wait)
	}
	// The hint floors this one wait; it does not become the limiter's pacing.
	if rl.currentDelay != 10*time.Millisecond {
		t.Errorf("currentDelay = %v, want 10ms (backoff-driven, not hint-driven)", rl.currentDelay)
	}
}

// TestHandleError_BackoffWinsOverShorterHint: a hint shorter than the backoff never shortens it.
func TestHandleError_BackoffWinsOverShorterHint(t *testing.T) {
	rl := NewRateLimiter(fastConfig(5))
	for range 3 {
		rl.HandleError(errors.New("429 rate limit"))
	}
	_, wait := rl.HandleError(hintedErr{time.Millisecond})
	if wait != 100*time.Millisecond {
		t.Errorf("wait = %v, want the 100ms backoff (MaxDelay), not the 1ms hint", wait)
	}
}

// TestExecuteWithRetry_CtxCancelDuringHintedWait: canceling ctx during a long hinted wait
// returns promptly, wraps ctx's error, and makes no further attempt.
func TestExecuteWithRetry_CtxCancelDuringHintedWait(t *testing.T) {
	rl := NewRateLimiter(fastConfig(10))
	ctx, cancel := context.WithCancel(context.Background())
	time.AfterFunc(50*time.Millisecond, cancel)
	defer cancel()

	calls := 0
	start := time.Now()
	err := rl.ExecuteWithRetry(ctx, func() error {
		calls++
		return hintedErr{5 * time.Minute}
	})

	if !errors.Is(err, context.Canceled) {
		t.Errorf("err = %v, want it to wrap context.Canceled", err)
	}
	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Errorf("returned after %v, want prompt return on cancel", elapsed)
	}
	if calls != 1 {
		t.Errorf("fn called %d times, want 1 (cancelled during the first hinted wait)", calls)
	}
}

// TestExecuteWithRetry_HintedErrorsAreBounded: a hint never makes the loop open-ended --
// MaxAttempts still caps it.
func TestExecuteWithRetry_HintedErrorsAreBounded(t *testing.T) {
	rl := NewRateLimiter(fastConfig(3))
	calls := 0
	err := rl.ExecuteWithRetry(context.Background(), func() error {
		calls++
		return hintedErr{time.Millisecond}
	})
	if err == nil {
		t.Fatal("ExecuteWithRetry returned nil on a persistent hinted error")
	}
	if calls != 3 {
		t.Errorf("fn called %d times, want MaxAttempts = 3", calls)
	}
}
