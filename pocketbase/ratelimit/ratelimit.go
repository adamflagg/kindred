// Package ratelimit provides rate limiting functionality for API calls
package ratelimit

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// RateLimiter handles rate limiting with exponential backoff for API calls
type RateLimiter struct {
	limiter           *rate.Limiter
	mu                sync.Mutex
	consecutiveErrors int
	currentDelay      time.Duration
	config            *Config
}

// Config holds rate limiter configuration
type Config struct {
	APIDelay          time.Duration
	BackoffMultiplier float64
	MaxDelay          time.Duration
	MaxAttempts       int
}

// DefaultConfig returns default rate limiter configuration
func DefaultConfig() *Config {
	return &Config{
		APIDelay:          200 * time.Millisecond, // Default 200ms between API calls
		BackoffMultiplier: 2.0,
		MaxDelay:          30 * time.Second,
		MaxAttempts:       5,
	}
}

// NewRateLimiter creates a new rate limiter
func NewRateLimiter(cfg *Config) *RateLimiter {
	if cfg == nil {
		cfg = DefaultConfig()
	}

	// Calculate requests per second from delay
	rps := float64(time.Second) / float64(cfg.APIDelay)

	return &RateLimiter{
		limiter:      rate.NewLimiter(rate.Limit(rps), 1),
		currentDelay: cfg.APIDelay,
		config:       cfg,
	}
}

// Wait blocks until the rate limiter allows the request
func (r *RateLimiter) Wait(ctx context.Context) error {
	if err := r.limiter.Wait(ctx); err != nil {
		return fmt.Errorf("rate limiter wait: %w", err)
	}
	return nil
}

// retryAfterer is a rate-limit error that carries the server's own wait (campminder's
// RateLimitError). The error's producer bounds the value; MaxAttempts bounds the retries.
type retryAfterer interface {
	RetryAfter() time.Duration
}

// HandleError processes an error and returns whether to retry and how long to wait. Only a
// typed rate-limit error is treated as one: anything satisfying retryAfterer via errors.As
// (campminder.RateLimitError is the sole producer). A hint floors this one wait but does not
// become the limiter's pacing, which stays backoff-driven. Text alone ("429", "rate limit")
// no longer qualifies -- an untyped error, however it reads, is not retried here.
func (r *RateLimiter) HandleError(err error) (shouldRetry bool, waitTime time.Duration) {
	r.mu.Lock()
	defer r.mu.Unlock()

	var hinted retryAfterer
	if !errors.As(err, &hinted) {
		return false, 0
	}

	r.consecutiveErrors++

	// Calculate exponential backoff
	waitTime = time.Duration(min(
		float64(r.currentDelay)*math.Pow(r.config.BackoffMultiplier, float64(r.consecutiveErrors-1)),
		float64(r.config.MaxDelay),
	))

	// Update rate limiter to slow down
	newDelay := waitTime
	if newDelay > r.currentDelay {
		r.currentDelay = newDelay
		// Update rate limiter with new delay
		rps := float64(time.Second) / float64(newDelay)
		r.limiter.SetLimit(rate.Limit(rps))
	}

	waitTime = max(waitTime, hinted.RetryAfter())
	return r.consecutiveErrors < r.config.MaxAttempts, waitTime
}

// Success resets the error counter
func (r *RateLimiter) Success() {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.consecutiveErrors > 0 {
		r.consecutiveErrors = 0
		// Reset to original delay
		r.currentDelay = r.config.APIDelay
		rps := float64(time.Second) / float64(r.config.APIDelay)
		r.limiter.SetLimit(rate.Limit(rps))
	}
}

// ExecuteWithRetry executes a function with rate limiting and retry logic
func (r *RateLimiter) ExecuteWithRetry(ctx context.Context, fn func() error) error {
	for range r.config.MaxAttempts {
		// Wait for rate limiter
		if err := r.Wait(ctx); err != nil {
			return fmt.Errorf("rate limiter wait: %w", err)
		}

		// Execute function
		err := fn()
		if err == nil {
			r.Success()
			return nil
		}

		// Check if we should retry
		shouldRetry, waitTime := r.HandleError(err)
		if !shouldRetry {
			return err
		}

		// Wait before retry
		select {
		case <-ctx.Done():
			return fmt.Errorf("retry wait cancelled: %w", ctx.Err())
		case <-time.After(waitTime):
			// Continue to next attempt
		}
	}

	return fmt.Errorf("max retry attempts (%d) exceeded", r.config.MaxAttempts)
}
