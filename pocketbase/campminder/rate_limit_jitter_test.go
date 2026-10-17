package campminder

import (
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

// Every other test in the package asserts exact waits, so the default test jitter is zero.
// The tests below set their own source and restore this one.
func init() {
	jitterFn = func() float64 { return 0 }
}

func setJitter(t *testing.T, v float64) {
	t.Helper()
	orig := jitterFn
	jitterFn = func() float64 { return v }
	t.Cleanup(func() { jitterFn = orig })
}

// A hinted wait gains 0-20 % on top of hint+5s, so waiters that were limited together do not
// wake together.
func TestRateLimitWait_HintedWaitHasJitterWithinBounds(t *testing.T) {
	body := `{"message":"Rate limit is exceeded. Try again in 15 seconds."}`
	base := 20 * time.Second

	setJitter(t, 0)
	if got := rateLimitWaitFor(body, nil, 0); got != base {
		t.Errorf("zero jitter: got %v, want %v", got, base)
	}
	setJitter(t, 1)
	if got, want := rateLimitWaitFor(body, nil, 0), base+base/5; got != want {
		t.Errorf("full jitter: got %v, want %v (+20%%)", got, want)
	}
	setJitter(t, 0.5)
	if got, want := rateLimitWaitFor(body, nil, 0), base+base/10; got != want {
		t.Errorf("half jitter: got %v, want %v", got, want)
	}
	// The unhinted backoff keeps its fixed ladder.
	setJitter(t, 1)
	if got := rateLimitWaitFor("Too Many Requests", nil, 1); got != 10*time.Second {
		t.Errorf("unhinted wait = %v, want the unjittered 10s step", got)
	}
}

func TestJitterWait_CallSitesUseSeam(t *testing.T) {
	setJitter(t, 1)
	if got, want := jitterWait(10*time.Second), 12*time.Second; got != want {
		t.Errorf("jitterWait = %v, want %v", got, want)
	}
}

// With no hint in the body, the Retry-After header (seconds) sets the wait.
func TestDoRequest_HonoursRetryAfterHeaderWhenBodyHasNoHint(t *testing.T) {
	waits := recordSleeps(t)
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if calls.Add(1) == 1 {
			w.Header().Set("Retry-After", "12")
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = w.Write([]byte("Too Many Requests"))
			return
		}
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	if _, err := newTestAPIClient(srv).makeRequest("GET", "sessions", nil); err != nil {
		t.Fatalf("makeRequest: %v", err)
	}
	if len(*waits) != 1 || (*waits)[0] != 17*time.Second {
		t.Errorf("waits = %v, want [17s] (Retry-After 12s + 5s buffer)", *waits)
	}
}

// The body's hint wins over the header.
func TestDoRequest_BodyHintBeatsRetryAfterHeader(t *testing.T) {
	waits := recordSleeps(t)
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if calls.Add(1) == 1 {
			w.Header().Set("Retry-After", "99")
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = w.Write([]byte(`{"message":"Rate limit is exceeded. Try again in 2 seconds."}`))
			return
		}
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	if _, err := newTestAPIClient(srv).makeRequest("GET", "sessions", nil); err != nil {
		t.Fatalf("makeRequest: %v", err)
	}
	if len(*waits) != 1 || (*waits)[0] != 7*time.Second {
		t.Errorf("waits = %v, want [7s]", *waits)
	}
}

// The pre-built-URL loop sleeps with jitter and reads the header too.
func TestMakeRequestWithURL_JitterAndRetryAfter(t *testing.T) {
	setJitter(t, 1)
	waits := recordSleeps(t)
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if calls.Add(1) == 1 {
			w.Header().Set("Retry-After", "5")
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	if _, err := newTestAPIClient(srv).makeRequestWithURL("GET", srv.URL+"/x"); err != nil {
		t.Fatalf("makeRequestWithURL: %v", err)
	}
	if len(*waits) != 1 || (*waits)[0] != 12*time.Second {
		t.Errorf("waits = %v, want [12s] (5s header + 5s buffer, +20%%)", *waits)
	}
}

// An absurd Retry-After is capped at rateLimitMaxHintedWait and never wraps round into a short
// wait; the HTTP-date form is ignored, leaving the unhinted wait.
func TestRateLimitWaitFor_RetryAfterIsCappedAndDateFormIgnored(t *testing.T) {
	setJitter(t, 0)
	for _, v := range []string{"999999", "18446744069", "9223372036854775807"} {
		h := http.Header{}
		h.Set("Retry-After", v)
		if got := rateLimitWaitFor("Too Many Requests", h, 0); got != rateLimitMaxHintedWait {
			t.Errorf("Retry-After %s: wait = %v, want the %v cap", v, got, rateLimitMaxHintedWait)
		}
		wantCap := int(rateLimitMaxHintedWait / time.Second)
		if got := (&Client{}).parseRateLimitSecondsFor("Too Many Requests", h); got != wantCap {
			t.Errorf("Retry-After %s: auth/URL wait = %ds, want the %ds cap", v, got, wantCap)
		}
	}
	h := http.Header{}
	h.Set("Retry-After", "Wed, 21 Oct 2015 07:28:00 GMT")
	if got := rateLimitWaitFor("Too Many Requests", h, 0); got != rateLimitBaseBackoff {
		t.Errorf("HTTP-date Retry-After: wait = %v, want the unhinted %v", got, rateLimitBaseBackoff)
	}
	if got := (&Client{}).parseRateLimitSecondsFor("Too Many Requests", h); got != 60 {
		t.Errorf("HTTP-date Retry-After: auth/URL wait = %ds, want the unhinted 60s", got)
	}
}
