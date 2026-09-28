package campminder

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

// newAuthCtxClient returns a client with no token, pointed at the given auth server.
func newAuthCtxClient(srv *httptest.Server) *Client {
	return &Client{
		apiKey:          "test-key",
		subscriptionKey: "test-subscription-key",
		clientID:        "test-client",
		seasonID:        2025,
		httpClient:      &http.Client{Timeout: 5 * time.Second},
		authURL:         srv.URL + "/auth/apikey",
	}
}

func serve429(calls *atomic.Int32, body string) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = fmt.Fprint(w, body)
	}))
}

// A cancelled context must stop the auth 429 retry loop during the wait, not after all
// maxRequestRetries waits have elapsed (#2864). The real sleepCtxFn is used on purpose: the
// hinted wait is 30s+5s, so returning quickly proves the wait is context-aware.
func TestAuthenticate_ContextCancelStopsRetryLoop(t *testing.T) {
	var calls atomic.Int32
	srv := serve429(&calls, "Rate limit is exceeded. Try again in 30 seconds.")
	defer srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
	defer cancel()

	start := time.Now()
	err := newAuthCtxClient(srv).ensureAuthenticated(ctx)
	elapsed := time.Since(start)

	if err == nil {
		t.Fatal("expected an error when the context ends during the 429 wait, got nil")
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("error %v does not wrap context.DeadlineExceeded", err)
	}
	if elapsed > 3*time.Second {
		t.Errorf("returned after %v, want well under one 35s wait", elapsed)
	}
	if got := calls.Load(); got != 1 {
		t.Errorf("auth server hit %d times, want 1 (cancelled during the first wait)", got)
	}
}

// An already-cancelled context must not reach the auth server at all.
func TestAuthenticate_PreCancelledContextMakesNoRequest(t *testing.T) {
	var calls atomic.Int32
	srv := serve429(&calls, "x")
	defer srv.Close()

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	err := newAuthCtxClient(srv).ensureAuthenticated(ctx)
	if !errors.Is(err, context.Canceled) {
		t.Errorf("error %v does not wrap context.Canceled", err)
	}
	if got := calls.Load(); got != 0 {
		t.Errorf("auth server hit %d times, want 0", got)
	}
}

// An absurd hint must be clamped at rateLimitMaxHintedWait in the auth path, like
// rateLimitWait does for makeRequest.
func TestAuthenticate_AbsurdHintIsClamped(t *testing.T) {
	var waits []time.Duration
	orig := sleepCtxFn
	sleepCtxFn = func(_ context.Context, d time.Duration) error {
		waits = append(waits, d)
		return nil
	}
	t.Cleanup(func() { sleepCtxFn = orig })

	var calls atomic.Int32
	srv := serve429(&calls, "Rate limit is exceeded. Try again in 999999 seconds.")
	defer srv.Close()

	if err := newAuthCtxClient(srv).ensureAuthenticated(context.Background()); err == nil {
		t.Fatal("expected an error after exhausting retries")
	}
	if len(waits) != maxRequestRetries {
		t.Fatalf("recorded %d waits, want %d", len(waits), maxRequestRetries)
	}
	for i, w := range waits {
		if w != rateLimitMaxHintedWait {
			t.Errorf("wait[%d] = %v, want %v", i, w, rateLimitMaxHintedWait)
		}
	}
}

// parseRateLimitSeconds is shared by the auth and pre-built-URL loops; it must clamp too.
func TestParseRateLimitSeconds_ClampsAbsurdHint(t *testing.T) {
	got := (&Client{}).parseRateLimitSeconds("Rate limit is exceeded. Try again in 999999 seconds.")
	want := int(rateLimitMaxHintedWait / time.Second)
	if got != want {
		t.Errorf("parseRateLimitSeconds = %d, want %d", got, want)
	}
}

// The common case: a valid cached token makes no network call.
func TestEnsureAuthenticated_ValidCachedTokenMakesNoRequest(t *testing.T) {
	var calls atomic.Int32
	srv := serve429(&calls, "x")
	defer srv.Close()

	c := newAuthCtxClient(srv)
	c.accessToken = "cached"
	c.tokenExpiry = time.Now().Add(time.Hour)

	if err := c.ensureAuthenticated(context.Background()); err != nil {
		t.Fatalf("ensureAuthenticated: %v", err)
	}
	if got := calls.Load(); got != 0 {
		t.Errorf("auth server hit %d times, want 0", got)
	}
}
