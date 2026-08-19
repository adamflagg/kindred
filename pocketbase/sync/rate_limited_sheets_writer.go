package sync

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	"strings"
	"time"

	"golang.org/x/time/rate"
	"google.golang.org/api/googleapi"
)

// SheetsRateLimitConfig configures rate limiting and retry behavior for Google Sheets API calls.
type SheetsRateLimitConfig struct {
	ReadsPerMinute    int
	WritesPerMinute   int
	MaxRetries        int
	InitialBackoff    time.Duration
	BackoffMultiplier float64
	MaxBackoff        time.Duration
	JitterFraction    float64 // 0.0-1.0, fraction of backoff to add as random jitter
}

// DefaultSheetsRateLimitConfig returns safe defaults below Google's 60/60 per-minute limits.
func DefaultSheetsRateLimitConfig() *SheetsRateLimitConfig {
	return &SheetsRateLimitConfig{
		ReadsPerMinute:    50,
		WritesPerMinute:   50,
		MaxRetries:        5,
		InitialBackoff:    2 * time.Second,
		BackoffMultiplier: 2.0,
		MaxBackoff:        60 * time.Second,
		JitterFraction:    0.25,
	}
}

// RateLimitedSheetsWriter wraps a SheetsWriter with token-bucket rate limiting
// and exponential backoff retry on 429 (rate limit exceeded) errors.
type RateLimitedSheetsWriter struct {
	inner        SheetsWriter
	readLimiter  *rate.Limiter
	writeLimiter *rate.Limiter
	config       *SheetsRateLimitConfig
}

// NewRateLimitedSheetsWriter creates a rate-limited decorator around any SheetsWriter.
// Pass nil for config to use DefaultSheetsRateLimitConfig.
func NewRateLimitedSheetsWriter(inner SheetsWriter, config *SheetsRateLimitConfig) SheetsWriter {
	if config == nil {
		config = DefaultSheetsRateLimitConfig()
	}

	// Token bucket: rate = requests/second, burst = 1 (one at a time through the limiter)
	readRate := rate.Limit(float64(config.ReadsPerMinute) / 60.0)
	writeRate := rate.Limit(float64(config.WritesPerMinute) / 60.0)

	return &RateLimitedSheetsWriter{
		inner:        inner,
		readLimiter:  rate.NewLimiter(readRate, 1),
		writeLimiter: rate.NewLimiter(writeRate, 1),
		config:       config,
	}
}

// WriteToSheet delegates to inner writer with rate limiting and 429 retry.
func (w *RateLimitedSheetsWriter) WriteToSheet(
	ctx context.Context, spreadsheetID, sheetTab string, data [][]any,
) error {
	return w.executeWithRetry(ctx, "WriteToSheet", []*rate.Limiter{w.writeLimiter}, func() error {
		return w.inner.WriteToSheet(ctx, spreadsheetID, sheetTab, data)
	})
}

// ClearSheet delegates to inner writer with rate limiting and 429 retry.
func (w *RateLimitedSheetsWriter) ClearSheet(
	ctx context.Context, spreadsheetID, sheetTab string,
) error {
	return w.executeWithRetry(ctx, "ClearSheet", []*rate.Limiter{w.writeLimiter}, func() error {
		return w.inner.ClearSheet(ctx, spreadsheetID, sheetTab)
	})
}

// EnsureSheet delegates to inner writer with rate limiting and 429 retry.
func (w *RateLimitedSheetsWriter) EnsureSheet(
	ctx context.Context, spreadsheetID, sheetTab string,
) error {
	return w.executeWithRetry(ctx, "EnsureSheet",
		[]*rate.Limiter{w.readLimiter, w.writeLimiter}, func() error {
			return w.inner.EnsureSheet(ctx, spreadsheetID, sheetTab)
		})
}

// SetTabColor delegates to inner writer with rate limiting and 429 retry.
func (w *RateLimitedSheetsWriter) SetTabColor(
	ctx context.Context, spreadsheetID, sheetTab string, color TabColor,
) error {
	return w.executeWithRetry(ctx, "SetTabColor",
		[]*rate.Limiter{w.readLimiter, w.writeLimiter}, func() error {
			return w.inner.SetTabColor(ctx, spreadsheetID, sheetTab, color)
		})
}

// SetTabIndex delegates to inner writer with rate limiting and 429 retry.
func (w *RateLimitedSheetsWriter) SetTabIndex(
	ctx context.Context, spreadsheetID, sheetTab string, index int,
) error {
	return w.executeWithRetry(ctx, "SetTabIndex",
		[]*rate.Limiter{w.readLimiter, w.writeLimiter}, func() error {
			return w.inner.SetTabIndex(ctx, spreadsheetID, sheetTab, index)
		})
}

// GetSheetMetadata delegates to inner writer with rate limiting and 429 retry.
func (w *RateLimitedSheetsWriter) GetSheetMetadata(
	ctx context.Context, spreadsheetID string,
) ([]SheetInfo, error) {
	var result []SheetInfo
	err := w.executeWithRetry(ctx, "GetSheetMetadata",
		[]*rate.Limiter{w.readLimiter}, func() error {
			var innerErr error
			result, innerErr = w.inner.GetSheetMetadata(ctx, spreadsheetID)
			if innerErr != nil {
				return fmt.Errorf("getting sheet metadata: %w", innerErr)
			}
			return nil
		})
	return result, err
}

// BatchUpdateTabProperties delegates to inner writer with rate limiting and 429 retry.
func (w *RateLimitedSheetsWriter) BatchUpdateTabProperties(
	ctx context.Context, spreadsheetID string, updates []TabPropertyUpdate,
) error {
	return w.executeWithRetry(ctx, "BatchUpdateTabProperties",
		[]*rate.Limiter{w.writeLimiter}, func() error {
			return w.inner.BatchUpdateTabProperties(ctx, spreadsheetID, updates)
		})
}

// DeleteSheet delegates to inner writer with rate limiting and 429 retry.
func (w *RateLimitedSheetsWriter) DeleteSheet(
	ctx context.Context, spreadsheetID, sheetTab string,
) error {
	return w.executeWithRetry(ctx, "DeleteSheet",
		[]*rate.Limiter{w.readLimiter, w.writeLimiter}, func() error {
			return w.inner.DeleteSheet(ctx, spreadsheetID, sheetTab)
		})
}

// ApplyFormatting delegates to inner writer with rate limiting and 429 retry.
func (w *RateLimitedSheetsWriter) ApplyFormatting(
	ctx context.Context, spreadsheetID string, format *SheetFormat,
) error {
	return w.executeWithRetry(ctx, "ApplyFormatting",
		[]*rate.Limiter{w.writeLimiter}, func() error {
			return w.inner.ApplyFormatting(ctx, spreadsheetID, format)
		})
}

// executeWithRetry waits on the applicable rate limiters, executes fn, and retries on 429 errors
// with exponential backoff.
func (w *RateLimitedSheetsWriter) executeWithRetry(
	ctx context.Context,
	opName string,
	limiters []*rate.Limiter,
	fn func() error,
) error {
	// Wait on all applicable rate limiters before the initial attempt
	for _, limiter := range limiters {
		if err := limiter.Wait(ctx); err != nil {
			return fmt.Errorf("%s rate limit wait: %w", opName, err)
		}
	}

	lastErr := fn()
	if lastErr == nil || !is429Error(lastErr) {
		return lastErr
	}

	// Retry loop with exponential backoff
	backoff := w.config.InitialBackoff
	for attempt := range w.config.MaxRetries {
		slog.Warn("Google Sheets 429 rate limit, retrying",
			"operation", opName,
			"attempt", attempt+1,
			"maxRetries", w.config.MaxRetries,
			"backoff", backoff,
		)

		// Apply jitter: backoff + random fraction
		sleepDuration := backoff
		if w.config.JitterFraction > 0 {
			sleepDuration = backoff + cryptoJitter(backoff, w.config.JitterFraction)
		}

		// Sleep with context awareness; NewTimer avoids goroutine leak on cancellation.
		timer := time.NewTimer(sleepDuration)
		select {
		case <-ctx.Done():
			timer.Stop()
			return fmt.Errorf("%s retry cancelled: %w", opName, ctx.Err())
		case <-timer.C:
		}

		// Wait on rate limiters again before retry
		for _, limiter := range limiters {
			if err := limiter.Wait(ctx); err != nil {
				return fmt.Errorf("%s retry rate limit wait: %w", opName, err)
			}
		}

		lastErr = fn()
		if lastErr == nil || !is429Error(lastErr) {
			return lastErr
		}

		// Exponential backoff with cap
		backoff = time.Duration(float64(backoff) * w.config.BackoffMultiplier)
		backoff = min(backoff, w.config.MaxBackoff)
	}

	slog.Error("Google Sheets rate limit retries exhausted",
		"operation", opName,
		"maxRetries", w.config.MaxRetries,
	)
	return lastErr
}

// cryptoJitter returns a random duration up to backoff * fraction using crypto/rand.
func cryptoJitter(backoff time.Duration, fraction float64) time.Duration {
	maxJitterNs := int64(float64(backoff.Nanoseconds()) * fraction)
	if maxJitterNs <= 0 {
		return 0
	}
	n, err := rand.Int(rand.Reader, big.NewInt(maxJitterNs))
	if err != nil {
		return 0
	}
	return time.Duration(n.Int64())
}

// is429Error checks if an error is a Google API 429 (rate limit exceeded) error.
// Uses errors.As for direct googleapi.Error, with string fallback for wrapped errors.
func is429Error(err error) bool {
	var apiErr *googleapi.Error
	if errors.As(err, &apiErr) {
		return apiErr.Code == 429
	}
	// Fallback: check for "429" in wrapped error string
	return strings.Contains(err.Error(), "googleapi: Error 429")
}
