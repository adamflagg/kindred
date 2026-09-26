package campminder

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/camp/kindred/pocketbase/ratelimit"
)

// The two custom-field-values syncs wrap each page fetch in ratelimit.ExecuteWithRetry. These
// tests pin that the fetch itself does NOT also retry a 429 internally, so the retry layers do
// not nest (outer x inner requests, ~95-110 min under sustained 429s, not ctx-cancellable).

// customValuesFetch is one of the two custom-values page fetches, as the syncs call it.
type customValuesFetch struct {
	name  string
	fetch func(ctx context.Context, c *Client) error
}

func customValuesFetches() []customValuesFetch {
	return []customValuesFetch{
		{"person", func(ctx context.Context, c *Client) error {
			_, _, err := c.GetPersonCustomFieldValuesPage(ctx, 101, 1, 500)
			return err
		}},
		{"household", func(ctx context.Context, c *Client) error {
			_, _, err := c.GetHouseholdCustomFieldValuesPage(ctx, 202, 1, 500)
			return err
		}},
	}
}

// always429 answers every request with a 429 carrying body, counting requests.
func always429(calls *atomic.Int32, body string) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(body))
	}))
}

// noSleep stubs sleepFn so a regression that re-introduces the inner retry fails fast on the
// request count instead of hanging the test on real waits. It records whether it was called.
func noSleep(t *testing.T) *atomic.Int32 {
	t.Helper()
	var n atomic.Int32
	orig := sleepFn
	sleepFn = func(time.Duration) { n.Add(1) }
	t.Cleanup(func() { sleepFn = orig })
	return &n
}

// TestCustomFieldValuesPages_Return429WithoutInternalRetry: one request, no client-side sleep,
// and a *RateLimitError whose RetryAfter carries CampMinder's hint (+5s buffer, clamped at
// rateLimitMaxHintedWait), or rateLimitBaseBackoff when the body has no hint.
func TestCustomFieldValuesPages_Return429WithoutInternalRetry(t *testing.T) {
	cases := []struct {
		name string
		body string
		want time.Duration
	}{
		{"hinted", `{"message":"Rate limit is exceeded. Try again in 30 seconds."}`, 35 * time.Second},
		{"unhinted", "Too Many Requests", rateLimitBaseBackoff},
		{"absurd hint is clamped", `{"message":"Rate limit is exceeded. Try again in 999999 seconds."}`,
			rateLimitMaxHintedWait},
	}
	for _, f := range customValuesFetches() {
		for _, tc := range cases {
			t.Run(f.name+"/"+tc.name, func(t *testing.T) {
				sleeps := noSleep(t)
				var calls atomic.Int32
				srv := always429(&calls, tc.body)
				defer srv.Close()

				err := f.fetch(context.Background(), newTestAPIClient(srv))

				if got := calls.Load(); got != 1 {
					t.Errorf("requests = %d, want 1 (the caller's ExecuteWithRetry owns the retry)", got)
				}
				if got := sleeps.Load(); got != 0 {
					t.Errorf("client slept %d times, want 0", got)
				}
				var rle *RateLimitError
				if !errors.As(err, &rle) {
					t.Fatalf("err = %v (%T), want a *RateLimitError", err, err)
				}
				if got := rle.RetryAfter(); got != tc.want {
					t.Errorf("RetryAfter() = %v, want %v", got, tc.want)
				}
			})
		}
	}
}

// TestCustomFieldValuesPages_OuterRetryIsTheOnlyLayer composes the fetch with ExecuteWithRetry
// exactly as the syncs do: under sustained 429s the server sees MaxAttempts requests, not
// MaxAttempts x (1 + maxRequestRetries).
func TestCustomFieldValuesPages_OuterRetryIsTheOnlyLayer(t *testing.T) {
	noSleep(t)
	const outerAttempts = 3
	for _, f := range customValuesFetches() {
		t.Run(f.name, func(t *testing.T) {
			t.Parallel()
			var calls atomic.Int32
			srv := always429(&calls, "Too Many Requests")
			defer srv.Close()
			c := newTestAPIClient(srv)
			rl := ratelimit.NewRateLimiter(&ratelimit.Config{
				APIDelay: time.Millisecond, BackoffMultiplier: 2.0,
				MaxDelay: 10 * time.Millisecond, MaxAttempts: outerAttempts,
			})

			err := rl.ExecuteWithRetry(context.Background(), func() error {
				return f.fetch(context.Background(), c)
			})

			if err == nil {
				t.Fatal("ExecuteWithRetry returned nil on a persistent 429")
			}
			if got := calls.Load(); got != outerAttempts {
				t.Errorf("requests = %d, want exactly %d (outer attempts only; nested would be %d)",
					got, outerAttempts, outerAttempts*(1+maxRequestRetries))
			}
		})
	}
}

// TestCustomFieldValuesPages_CtxCancelStopsHintedWait: a long hinted wait sits in the outer
// layer's ctx-aware select, so canceling the sync's ctx returns promptly with ctx's error
// after a single request.
func TestCustomFieldValuesPages_CtxCancelStopsHintedWait(t *testing.T) {
	noSleep(t)
	for _, f := range customValuesFetches() {
		t.Run(f.name, func(t *testing.T) {
			var calls atomic.Int32
			srv := always429(&calls, `{"message":"Rate limit is exceeded. Try again in 240 seconds."}`)
			defer srv.Close()
			c := newTestAPIClient(srv)
			rl := ratelimit.NewRateLimiter(&ratelimit.Config{
				APIDelay: time.Millisecond, BackoffMultiplier: 2.0,
				MaxDelay: 10 * time.Millisecond, MaxAttempts: 10,
			})
			ctx, cancel := context.WithCancel(context.Background())
			time.AfterFunc(100*time.Millisecond, cancel)
			defer cancel()

			start := time.Now()
			err := rl.ExecuteWithRetry(ctx, func() error { return f.fetch(ctx, c) })
			elapsed := time.Since(start)

			if !errors.Is(err, context.Canceled) {
				t.Errorf("err = %v, want it to wrap context.Canceled", err)
			}
			if elapsed > 3*time.Second {
				t.Errorf("returned after %v, want prompt return on cancel", elapsed)
			}
			if got := calls.Load(); got != 1 {
				t.Errorf("requests = %d, want 1 (cancelled during the first hinted wait)", got)
			}
		})
	}
}

// TestCustomFieldValuesPages_RequestIsBoundToCtx: canceling ctx aborts an in-flight request
// instead of waiting out the 30s HTTP client timeout.
func TestCustomFieldValuesPages_RequestIsBoundToCtx(t *testing.T) {
	for _, f := range customValuesFetches() {
		t.Run(f.name, func(t *testing.T) {
			release := make(chan struct{})
			srv := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
				select {
				case <-r.Context().Done():
				case <-release:
				}
			}))
			defer srv.Close()
			defer close(release)
			ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
			defer cancel()

			start := time.Now()
			err := f.fetch(ctx, newTestAPIClient(srv))

			if !errors.Is(err, context.DeadlineExceeded) {
				t.Errorf("err = %v, want it to wrap context.DeadlineExceeded", err)
			}
			if elapsed := time.Since(start); elapsed > 3*time.Second {
				t.Errorf("returned after %v, want prompt return when ctx expires", elapsed)
			}
		})
	}
}

// TestOtherCallersKeepInternal429Retry: every other caller still retries a 429 inside the
// client, exactly as before this change.
func TestOtherCallersKeepInternal429Retry(t *testing.T) {
	waits := recordSleeps(t)
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if calls.Add(1) <= 2 {
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = w.Write([]byte(`{"message":"Rate limit is exceeded. Try again in 2 seconds."}`))
			return
		}
		_, _ = w.Write([]byte(`{"TotalCount":1,"Results":[{"ID":1}]}`))
	}))
	defer srv.Close()

	divisions, err := newTestAPIClient(srv).GetDivisions()
	if err != nil {
		t.Fatalf("GetDivisions: %v", err)
	}
	if len(divisions) != 1 {
		t.Errorf("divisions = %d, want 1", len(divisions))
	}
	if got := calls.Load(); got != 3 {
		t.Errorf("requests = %d, want 3 (two 429s retried internally, then success)", got)
	}
	if len(*waits) != 2 {
		t.Errorf("client sleeps = %v, want 2 internal waits", *waits)
	}
}
