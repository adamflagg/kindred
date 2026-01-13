// Package ratelimit provides rate limiting functionality for API calls
package ratelimit

import (
	"context"
	"fmt"
	"math"
	"strings"
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
	return r.limiter.Wait(ctx)
}

// HandleError processes an error and returns whether to retry and how long to wait
func (r *RateLimiter) HandleError(err error) (shouldRetry bool, waitTime time.Duration) {
	r.mu.Lock()
	defer r.mu.Unlock()

	errStr := strings.ToLower(err.Error())

	// Check if it's a rate limit error
	if strings.Contains(errStr, "429") || strings.Contains(errStr, "rate limit") {
		r.consecutiveErrors++

		// Calculate exponential backoff
		waitTime = time.Duration(math.Min(
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

		return r.consecutiveErrors < r.config.MaxAttempts, waitTime
	}

	// Not a rate limit error
	return false, 0
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
	for attempt := 0; attempt < r.config.MaxAttempts; attempt++ {
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
			return ctx.Err()
		case <-time.After(waitTime):
			// Continue to next attempt
		}
	}

	return fmt.Errorf("max retry attempts (%d) exceeded", r.config.MaxAttempts)
}
