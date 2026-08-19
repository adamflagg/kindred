package sync

import (
	"context"
	"errors"
	"fmt"
	"sync/atomic"
	"testing"
	"testing/synctest"
	"time"

	"google.golang.org/api/googleapi"
)

// failNTimes returns an error function that returns a 429 error for the first n calls,
// then succeeds. The counter is shared across all calls.
func failNTimes(n int) func() error {
	var count atomic.Int32
	return func() error {
		if int(count.Add(1)) <= n {
			return &googleapi.Error{Code: 429, Message: "rate limit exceeded"}
		}
		return nil
	}
}

// trackingMock wraps MockSheetsWriter to inject errors per-method via error functions
type trackingMock struct {
	*MockSheetsWriter
	writeErrFn         func() error
	clearErrFn         func() error
	ensureErrFn        func() error
	setColorErrFn      func() error
	setIndexErrFn      func() error
	getMetadataErrFn   func() error
	batchUpdateErrFn   func() error
	deleteErrFn        func() error
	applyFormatErrFn   func() error
	writeCalls         atomic.Int32
	clearCalls         atomic.Int32
	ensureCalls        atomic.Int32
	setColorCallCount  atomic.Int32
	setIndexCallCount  atomic.Int32
	getMetadataCallCnt atomic.Int32
	batchUpdateCallCnt atomic.Int32
	deleteCallCount    atomic.Int32
	applyFormatCallCnt atomic.Int32
}

func newTrackingMock() *trackingMock {
	return &trackingMock{
		MockSheetsWriter: NewMockSheetsWriter(),
	}
}

func (t *trackingMock) WriteToSheet(ctx context.Context, spreadsheetID, sheetTab string, data [][]any) error {
	t.writeCalls.Add(1)
	if t.writeErrFn != nil {
		if err := t.writeErrFn(); err != nil {
			return err
		}
	}
	return t.MockSheetsWriter.WriteToSheet(ctx, spreadsheetID, sheetTab, data)
}

func (t *trackingMock) ClearSheet(ctx context.Context, spreadsheetID, sheetTab string) error {
	t.clearCalls.Add(1)
	if t.clearErrFn != nil {
		if err := t.clearErrFn(); err != nil {
			return err
		}
	}
	return t.MockSheetsWriter.ClearSheet(ctx, spreadsheetID, sheetTab)
}

func (t *trackingMock) EnsureSheet(ctx context.Context, spreadsheetID, sheetTab string) error {
	t.ensureCalls.Add(1)
	if t.ensureErrFn != nil {
		if err := t.ensureErrFn(); err != nil {
			return err
		}
	}
	return t.MockSheetsWriter.EnsureSheet(ctx, spreadsheetID, sheetTab)
}

func (t *trackingMock) SetTabColor(ctx context.Context, spreadsheetID, sheetTab string, color TabColor) error {
	t.setColorCallCount.Add(1)
	if t.setColorErrFn != nil {
		if err := t.setColorErrFn(); err != nil {
			return err
		}
	}
	return t.MockSheetsWriter.SetTabColor(ctx, spreadsheetID, sheetTab, color)
}

func (t *trackingMock) SetTabIndex(ctx context.Context, spreadsheetID, sheetTab string, index int) error {
	t.setIndexCallCount.Add(1)
	if t.setIndexErrFn != nil {
		if err := t.setIndexErrFn(); err != nil {
			return err
		}
	}
	return t.MockSheetsWriter.SetTabIndex(ctx, spreadsheetID, sheetTab, index)
}

func (t *trackingMock) GetSheetMetadata(ctx context.Context, spreadsheetID string) ([]SheetInfo, error) {
	t.getMetadataCallCnt.Add(1)
	if t.getMetadataErrFn != nil {
		if err := t.getMetadataErrFn(); err != nil {
			return nil, err
		}
	}
	return t.MockSheetsWriter.GetSheetMetadata(ctx, spreadsheetID)
}

func (t *trackingMock) BatchUpdateTabProperties(
	ctx context.Context, spreadsheetID string, updates []TabPropertyUpdate,
) error {
	t.batchUpdateCallCnt.Add(1)
	if t.batchUpdateErrFn != nil {
		if err := t.batchUpdateErrFn(); err != nil {
			return err
		}
	}
	return t.MockSheetsWriter.BatchUpdateTabProperties(ctx, spreadsheetID, updates)
}

func (t *trackingMock) DeleteSheet(ctx context.Context, spreadsheetID, sheetTab string) error {
	t.deleteCallCount.Add(1)
	if t.deleteErrFn != nil {
		if err := t.deleteErrFn(); err != nil {
			return err
		}
	}
	return t.MockSheetsWriter.DeleteSheet(ctx, spreadsheetID, sheetTab)
}

func (t *trackingMock) ApplyFormatting(ctx context.Context, spreadsheetID string, format *SheetFormat) error {
	t.applyFormatCallCnt.Add(1)
	if t.applyFormatErrFn != nil {
		if err := t.applyFormatErrFn(); err != nil {
			return err
		}
	}
	return t.MockSheetsWriter.ApplyFormatting(ctx, spreadsheetID, format)
}

// testConfig returns a config with very fast backoff for testing
func testConfig() *SheetsRateLimitConfig {
	return &SheetsRateLimitConfig{
		ReadsPerMinute:    600, // effectively unlimited for tests
		WritesPerMinute:   600,
		MaxRetries:        3,
		InitialBackoff:    time.Millisecond, // fast for tests
		BackoffMultiplier: 2.0,
		MaxBackoff:        10 * time.Millisecond,
		JitterFraction:    0.0, // no jitter for deterministic tests
	}
}

// =============================================================================
// Interface Delegation Tests
// =============================================================================

func TestRateLimitedWriter_DelegatesAllMethods(t *testing.T) {
	t.Parallel()
	mock := newTrackingMock()
	writer := NewRateLimitedSheetsWriter(mock, testConfig())
	ctx := context.Background()

	// WriteToSheet
	data := [][]any{{"a", "b"}}
	if err := writer.WriteToSheet(ctx, "s1", "tab", data); err != nil {
		t.Fatalf("WriteToSheet: %v", err)
	}
	if mock.writeCalls.Load() != 1 {
		t.Errorf("WriteToSheet: inner called %d times, want 1", mock.writeCalls.Load())
	}

	// ClearSheet
	if err := writer.ClearSheet(ctx, "s1", "tab"); err != nil {
		t.Fatalf("ClearSheet: %v", err)
	}
	if mock.clearCalls.Load() != 1 {
		t.Errorf("ClearSheet: inner called %d times, want 1", mock.clearCalls.Load())
	}

	// EnsureSheet
	if err := writer.EnsureSheet(ctx, "s1", "tab"); err != nil {
		t.Fatalf("EnsureSheet: %v", err)
	}
	if mock.ensureCalls.Load() != 1 {
		t.Errorf("EnsureSheet: inner called %d times, want 1", mock.ensureCalls.Load())
	}

	// SetTabColor
	if err := writer.SetTabColor(ctx, "s1", "tab", TabColorGlobal); err != nil {
		t.Fatalf("SetTabColor: %v", err)
	}
	if mock.setColorCallCount.Load() != 1 {
		t.Errorf("SetTabColor: inner called %d times, want 1", mock.setColorCallCount.Load())
	}

	// SetTabIndex
	if err := writer.SetTabIndex(ctx, "s1", "tab", 0); err != nil {
		t.Fatalf("SetTabIndex: %v", err)
	}
	if mock.setIndexCallCount.Load() != 1 {
		t.Errorf("SetTabIndex: inner called %d times, want 1", mock.setIndexCallCount.Load())
	}

	// GetSheetMetadata
	if _, err := writer.GetSheetMetadata(ctx, "s1"); err != nil {
		t.Fatalf("GetSheetMetadata: %v", err)
	}
	if mock.getMetadataCallCnt.Load() != 1 {
		t.Errorf("GetSheetMetadata: inner called %d times, want 1", mock.getMetadataCallCnt.Load())
	}

	// BatchUpdateTabProperties
	if err := writer.BatchUpdateTabProperties(ctx, "s1", nil); err != nil {
		t.Fatalf("BatchUpdateTabProperties: %v", err)
	}
	if mock.batchUpdateCallCnt.Load() != 1 {
		t.Errorf("BatchUpdateTabProperties: inner called %d times, want 1", mock.batchUpdateCallCnt.Load())
	}

	// DeleteSheet
	if err := writer.DeleteSheet(ctx, "s1", "tab"); err != nil {
		t.Fatalf("DeleteSheet: %v", err)
	}
	if mock.deleteCallCount.Load() != 1 {
		t.Errorf("DeleteSheet: inner called %d times, want 1", mock.deleteCallCount.Load())
	}

	// ApplyFormatting
	if err := writer.ApplyFormatting(ctx, "s1", &SheetFormat{SheetID: 1, FrozenRows: 3}); err != nil {
		t.Fatalf("ApplyFormatting: %v", err)
	}
	if mock.applyFormatCallCnt.Load() != 1 {
		t.Errorf("ApplyFormatting: inner called %d times, want 1", mock.applyFormatCallCnt.Load())
	}
}

// =============================================================================
// 429 Retry Tests - Write Methods
// =============================================================================

func TestRateLimitedWriter_RetriesWriteOn429(t *testing.T) {
	t.Parallel()
	mock := newTrackingMock()
	mock.writeErrFn = failNTimes(2) // fail twice then succeed
	writer := NewRateLimitedSheetsWriter(mock, testConfig())

	err := writer.WriteToSheet(context.Background(), "s1", "tab", [][]any{{"x"}})
	if err != nil {
		t.Fatalf("WriteToSheet should succeed after retries, got: %v", err)
	}
	if mock.writeCalls.Load() != 3 {
		t.Errorf("WriteToSheet: inner called %d times, want 3 (2 failures + 1 success)", mock.writeCalls.Load())
	}
}

func TestRateLimitedWriter_RetriesClearOn429(t *testing.T) {
	t.Parallel()
	mock := newTrackingMock()
	mock.clearErrFn = failNTimes(1)
	writer := NewRateLimitedSheetsWriter(mock, testConfig())

	err := writer.ClearSheet(context.Background(), "s1", "tab")
	if err != nil {
		t.Fatalf("ClearSheet should succeed after retry, got: %v", err)
	}
	if mock.clearCalls.Load() != 2 {
		t.Errorf("ClearSheet: inner called %d times, want 2", mock.clearCalls.Load())
	}
}

func TestRateLimitedWriter_RetriesBatchUpdateOn429(t *testing.T) {
	t.Parallel()
	mock := newTrackingMock()
	mock.batchUpdateErrFn = failNTimes(1)
	writer := NewRateLimitedSheetsWriter(mock, testConfig())

	err := writer.BatchUpdateTabProperties(context.Background(), "s1", []TabPropertyUpdate{})
	if err != nil {
		t.Fatalf("BatchUpdateTabProperties should succeed after retry, got: %v", err)
	}
	if mock.batchUpdateCallCnt.Load() != 2 {
		t.Errorf("BatchUpdateTabProperties: inner called %d times, want 2", mock.batchUpdateCallCnt.Load())
	}
}

// =============================================================================
// 429 Retry Tests - Read Methods
// =============================================================================

func TestRateLimitedWriter_RetriesGetMetadataOn429(t *testing.T) {
	t.Parallel()
	mock := newTrackingMock()
	mock.getMetadataErrFn = failNTimes(2)
	writer := NewRateLimitedSheetsWriter(mock, testConfig())

	_, err := writer.GetSheetMetadata(context.Background(), "s1")
	if err != nil {
		t.Fatalf("GetSheetMetadata should succeed after retries, got: %v", err)
	}
	if mock.getMetadataCallCnt.Load() != 3 {
		t.Errorf("GetSheetMetadata: inner called %d times, want 3", mock.getMetadataCallCnt.Load())
	}
}

func TestRateLimitedWriter_RetriesEnsureSheetOn429(t *testing.T) {
	t.Parallel()
	mock := newTrackingMock()
	mock.ensureErrFn = failNTimes(1)
	writer := NewRateLimitedSheetsWriter(mock, testConfig())

	err := writer.EnsureSheet(context.Background(), "s1", "tab")
	if err != nil {
		t.Fatalf("EnsureSheet should succeed after retry, got: %v", err)
	}
	if mock.ensureCalls.Load() != 2 {
		t.Errorf("EnsureSheet: inner called %d times, want 2", mock.ensureCalls.Load())
	}
}

// =============================================================================
// Max Retries Exhaustion
// =============================================================================

func TestRateLimitedWriter_GivesUpAfterMaxRetries(t *testing.T) {
	t.Parallel()
	mock := newTrackingMock()
	// fail more times than max retries (config has MaxRetries=3)
	mock.writeErrFn = failNTimes(10)
	writer := NewRateLimitedSheetsWriter(mock, testConfig())

	err := writer.WriteToSheet(context.Background(), "s1", "tab", [][]any{{"x"}})
	if err == nil {
		t.Fatal("WriteToSheet should return error after max retries")
		return
	}

	// Should have been called: 1 initial + 3 retries = 4
	if mock.writeCalls.Load() != 4 {
		t.Errorf("WriteToSheet: inner called %d times, want 4 (1 initial + 3 retries)", mock.writeCalls.Load())
	}

	// Error should be the 429 error
	var apiErr *googleapi.Error
	if !errors.As(err, &apiErr) || apiErr.Code != 429 {
		t.Errorf("Expected googleapi.Error with code 429, got: %v", err)
	}
}

// =============================================================================
// Non-429 Error Passthrough
// =============================================================================

func TestRateLimitedWriter_DoesNotRetryNon429Errors(t *testing.T) {
	t.Parallel()
	mock := newTrackingMock()
	permErr := fmt.Errorf("permission denied")
	mock.writeErrFn = func() error { return permErr }
	writer := NewRateLimitedSheetsWriter(mock, testConfig())

	err := writer.WriteToSheet(context.Background(), "s1", "tab", [][]any{{"x"}})
	if err == nil {
		t.Fatal("WriteToSheet should return non-429 error immediately")
		return
	}
	if !errors.Is(err, permErr) {
		t.Errorf("Expected permission denied error, got: %v", err)
	}

	// Should only be called once (no retries)
	if mock.writeCalls.Load() != 1 {
		t.Errorf("WriteToSheet: inner called %d times, want 1 (no retry for non-429)", mock.writeCalls.Load())
	}
}

func TestRateLimitedWriter_DoesNotRetryGoogleAPINon429(t *testing.T) {
	t.Parallel()
	mock := newTrackingMock()
	mock.writeErrFn = func() error {
		return &googleapi.Error{Code: 403, Message: "forbidden"}
	}
	writer := NewRateLimitedSheetsWriter(mock, testConfig())

	err := writer.WriteToSheet(context.Background(), "s1", "tab", [][]any{{"x"}})
	if err == nil {
		t.Fatal("WriteToSheet should return 403 error immediately")
		return
	}

	if mock.writeCalls.Load() != 1 {
		t.Errorf("WriteToSheet: inner called %d times, want 1 (no retry for 403)", mock.writeCalls.Load())
	}
}

// =============================================================================
// Context Cancellation
// =============================================================================

func TestRateLimitedWriter_RespectsContextCancellation(t *testing.T) {
	t.Parallel()
	synctest.Test(t, func(t *testing.T) {
		mock := newTrackingMock()
		mock.writeErrFn = failNTimes(10) // always fail
		cfg := testConfig()
		cfg.InitialBackoff = 100 * time.Millisecond // slow enough that we can cancel
		writer := NewRateLimitedSheetsWriter(mock, cfg)

		ctx, cancel := context.WithCancel(context.Background())

		// Cancel after a short delay
		go func() {
			time.Sleep(50 * time.Millisecond)
			cancel()
		}()

		err := writer.WriteToSheet(ctx, "s1", "tab", [][]any{{"x"}})
		if err == nil {
			t.Fatal("WriteToSheet should return error when context is canceled")
			return
		}

		// Should have been called fewer times than max retries because context was canceled
		if mock.writeCalls.Load() >= 4 {
			t.Errorf("WriteToSheet: inner called %d times, should be < 4 due to context cancellation", mock.writeCalls.Load())
		}
	})
}

// =============================================================================
// Rate Limiter Assignment
// =============================================================================

func TestRateLimitedWriter_UsesSeparateReadWriteLimiters(t *testing.T) {
	t.Parallel()
	// Verify that the rate limited writer has separate read and write limiters
	// by checking it's structurally different (not nil, not same pointer)
	mock := newTrackingMock()
	writer := NewRateLimitedSheetsWriter(mock, testConfig())

	rlw, ok := writer.(*RateLimitedSheetsWriter)
	if !ok {
		t.Fatal("NewRateLimitedSheetsWriter should return *RateLimitedSheetsWriter")
		return
	}

	if rlw.readLimiter == nil {
		t.Fatal("readLimiter should not be nil")
		return
	}
	if rlw.writeLimiter == nil {
		t.Fatal("writeLimiter should not be nil")
		return
	}
	if rlw.readLimiter == rlw.writeLimiter {
		t.Error("readLimiter and writeLimiter should be separate instances")
	}
}

// =============================================================================
// Default Config
// =============================================================================

func TestDefaultSheetsRateLimitConfig(t *testing.T) {
	t.Parallel()
	cfg := DefaultSheetsRateLimitConfig()

	if cfg.ReadsPerMinute != 50 {
		t.Errorf("ReadsPerMinute = %d, want 50", cfg.ReadsPerMinute)
	}
	if cfg.WritesPerMinute != 50 {
		t.Errorf("WritesPerMinute = %d, want 50", cfg.WritesPerMinute)
	}
	if cfg.MaxRetries != 5 {
		t.Errorf("MaxRetries = %d, want 5", cfg.MaxRetries)
	}
	if cfg.InitialBackoff != 2*time.Second {
		t.Errorf("InitialBackoff = %v, want 2s", cfg.InitialBackoff)
	}
	if cfg.BackoffMultiplier != 2.0 {
		t.Errorf("BackoffMultiplier = %f, want 2.0", cfg.BackoffMultiplier)
	}
	if cfg.MaxBackoff != 60*time.Second {
		t.Errorf("MaxBackoff = %v, want 60s", cfg.MaxBackoff)
	}
	if cfg.JitterFraction != 0.25 {
		t.Errorf("JitterFraction = %f, want 0.25", cfg.JitterFraction)
	}
}

// =============================================================================
// Nil Config Uses Defaults
// =============================================================================

func TestRateLimitedWriter_NilConfigUsesDefaults(t *testing.T) {
	t.Parallel()
	mock := newTrackingMock()
	writer := NewRateLimitedSheetsWriter(mock, nil)

	rlw, ok := writer.(*RateLimitedSheetsWriter)
	if !ok {
		t.Fatal("NewRateLimitedSheetsWriter should return *RateLimitedSheetsWriter")
		return
	}

	if rlw.config.MaxRetries != 5 {
		t.Errorf("nil config should use default MaxRetries=5, got %d", rlw.config.MaxRetries)
	}
}

// =============================================================================
// Wrapped 429 Errors (string matching fallback)
// =============================================================================

func TestRateLimitedWriter_Retries429WrappedInFmtErrorf(t *testing.T) {
	t.Parallel()
	mock := newTrackingMock()
	var count atomic.Int32
	mock.writeErrFn = func() error {
		if int(count.Add(1)) <= 1 {
			inner := &googleapi.Error{Code: 429, Message: "rate limit"}
			return fmt.Errorf("writing sheet: %w", inner)
		}
		return nil
	}
	writer := NewRateLimitedSheetsWriter(mock, testConfig())

	err := writer.WriteToSheet(context.Background(), "s1", "tab", [][]any{{"x"}})
	if err != nil {
		t.Fatalf("WriteToSheet should succeed after retrying wrapped 429, got: %v", err)
	}
	if mock.writeCalls.Load() != 2 {
		t.Errorf("WriteToSheet: inner called %d times, want 2", mock.writeCalls.Load())
	}
}

// =============================================================================
// SetTabColor and SetTabIndex retry (read+write methods)
// =============================================================================

func TestRateLimitedWriter_RetriesSetTabColorOn429(t *testing.T) {
	t.Parallel()
	mock := newTrackingMock()
	mock.setColorErrFn = failNTimes(1)
	writer := NewRateLimitedSheetsWriter(mock, testConfig())

	err := writer.SetTabColor(context.Background(), "s1", "tab", TabColorGlobal)
	if err != nil {
		t.Fatalf("SetTabColor should succeed after retry, got: %v", err)
	}
	if mock.setColorCallCount.Load() != 2 {
		t.Errorf("SetTabColor: inner called %d times, want 2", mock.setColorCallCount.Load())
	}
}

func TestRateLimitedWriter_RetriesSetTabIndexOn429(t *testing.T) {
	t.Parallel()
	mock := newTrackingMock()
	mock.setIndexErrFn = failNTimes(1)
	writer := NewRateLimitedSheetsWriter(mock, testConfig())

	err := writer.SetTabIndex(context.Background(), "s1", "tab", 0)
	if err != nil {
		t.Fatalf("SetTabIndex should succeed after retry, got: %v", err)
	}
	if mock.setIndexCallCount.Load() != 2 {
		t.Errorf("SetTabIndex: inner called %d times, want 2", mock.setIndexCallCount.Load())
	}
}

func TestRateLimitedWriter_RetriesDeleteSheetOn429(t *testing.T) {
	t.Parallel()
	mock := newTrackingMock()
	mock.deleteErrFn = failNTimes(1)
	writer := NewRateLimitedSheetsWriter(mock, testConfig())

	err := writer.DeleteSheet(context.Background(), "s1", "tab")
	if err != nil {
		t.Fatalf("DeleteSheet should succeed after retry, got: %v", err)
	}
	if mock.deleteCallCount.Load() != 2 {
		t.Errorf("DeleteSheet: inner called %d times, want 2", mock.deleteCallCount.Load())
	}
}

func TestRateLimitedWriter_RetriesApplyFormattingOn429(t *testing.T) {
	t.Parallel()
	mock := newTrackingMock()
	mock.applyFormatErrFn = failNTimes(1)
	writer := NewRateLimitedSheetsWriter(mock, testConfig())

	err := writer.ApplyFormatting(context.Background(), "s1", &SheetFormat{SheetID: 1, FrozenRows: 3})
	if err != nil {
		t.Fatalf("ApplyFormatting should succeed after retry, got: %v", err)
	}
	if mock.applyFormatCallCnt.Load() != 2 {
		t.Errorf("ApplyFormatting: inner called %d times, want 2", mock.applyFormatCallCnt.Load())
	}
}
