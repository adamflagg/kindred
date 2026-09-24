package fastapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// BaseURL is how every Go caller finds FastAPI: API_URL where it is set (the
// docker-compose files set http://api:8000, worktrees set their own port), and
// the dev default otherwise. The PocketBase config hook used to build
// 127.0.0.1:$API_PORT itself, which in production is PocketBase's OWN
// container -- nothing listens there, so every call failed.
func TestBaseURLPrefersAPIURL(t *testing.T) {
	t.Setenv("API_URL", "http://api:8000")
	if got := BaseURL(); got != "http://api:8000" {
		t.Errorf("BaseURL() = %q, want the API_URL value", got)
	}
}

func TestBaseURLFallsBackToTheDevDefault(t *testing.T) {
	t.Setenv("API_URL", "")
	if got := BaseURL(); got != "http://127.0.0.1:8000" {
		t.Errorf("BaseURL() = %q, want http://127.0.0.1:8000", got)
	}
}

func TestInvalidateCachesNamesTheSyncThatFinished(t *testing.T) {
	t.Parallel()
	var gotMethod, gotPath, gotQuery string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod, gotPath, gotQuery = r.Method, r.URL.Path, r.URL.RawQuery
		w.WriteHeader(http.StatusOK)
	}))
	defer ts.Close()

	if err := InvalidateCaches(context.Background(), ts.URL, "bunk_assignments"); err != nil {
		t.Fatalf("InvalidateCaches: %v", err)
	}
	if gotMethod != http.MethodPost || gotPath != "/api/metrics/cache/invalidate" {
		t.Errorf("got %s %s, want POST /api/metrics/cache/invalidate", gotMethod, gotPath)
	}
	if gotQuery != "sync_type=bunk_assignments" {
		t.Errorf("query = %q, want sync_type=bunk_assignments", gotQuery)
	}
}

// A caller that names no sync (the config hook) sends no parameter, which the
// endpoint reads as "clear everything" -- what it did before sync_type existed.
func TestInvalidateCachesWithNoSyncSendsNoParameter(t *testing.T) {
	t.Parallel()
	var gotQuery = "unset"
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.RawQuery
		w.WriteHeader(http.StatusOK)
	}))
	defer ts.Close()

	if err := InvalidateCaches(context.Background(), ts.URL, ""); err != nil {
		t.Fatalf("InvalidateCaches: %v", err)
	}
	if gotQuery != "" {
		t.Errorf("query = %q, want none", gotQuery)
	}
}

func TestInvalidateCachesReportsANon200(t *testing.T) {
	t.Parallel()
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer ts.Close()

	err := InvalidateCaches(context.Background(), ts.URL, "attendees")
	if err == nil || !strings.Contains(err.Error(), "500") {
		t.Errorf("err = %v, want one naming the 500", err)
	}
}

func TestInvalidateCachesReportsAnUnreachableAPI(t *testing.T) {
	t.Parallel()
	if err := InvalidateCaches(context.Background(), "http://127.0.0.1:1", "attendees"); err == nil {
		t.Error("want an error for an API nobody is listening on")
	}
}

// A hung API must not hold the caller: the call gives up on its own.
func TestInvalidateCachesGivesUpOnAHungAPI(t *testing.T) {
	t.Parallel()
	release := make(chan struct{})
	ts := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {
		<-release
	}))
	defer ts.Close()
	defer close(release)

	start := time.Now()
	err := invalidateCaches(context.Background(), &http.Client{Timeout: 50 * time.Millisecond}, ts.URL, "attendees")
	if err == nil {
		t.Error("want a timeout error")
	}
	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Errorf("took %s, want the client timeout to end it", elapsed)
	}
}
