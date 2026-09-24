package rbac

import (
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	pbtests "github.com/pocketbase/pocketbase/tests"
)

func TestIsRegistrationConfig(t *testing.T) {
	tests := []struct {
		name     string
		category string
		expected bool
	}{
		{
			name:     "registration category matches",
			category: "registration",
			expected: true,
		},
		{
			name:     "empty category does not match",
			category: "",
			expected: false,
		},
		{
			name:     "other category does not match",
			category: "general",
			expected: false,
		},
		{
			name:     "sync category does not match",
			category: "sync",
			expected: false,
		},
		{
			name:     "case-sensitive: Registration does not match",
			category: "Registration",
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := isRegistrationConfig(tt.category)
			if result != tt.expected {
				t.Errorf("isRegistrationConfig(%q) = %v, want %v", tt.category, result, tt.expected)
			}
		})
	}
}

// The forecast endpoint reads budget config and registration dates, and the
// session-availability endpoint reads session_availability config; all three
// sit behind FastAPI's 2-hour metrics_cache. A write to any of them from the
// PocketBase admin UI (which no frontend invalidation can see) must clear it.
func TestConfigCategoryInvalidatesMetricsCache(t *testing.T) {
	tests := []struct {
		category string
		expected bool
	}{
		{"registration", true},
		{"budget", true},
		{"session_availability", true},
		{"", false},
		{"general", false},
		{"sync", false},
		{"constraint", false},
		{"Registration", false}, // case-sensitive
		{"Budget", false},
	}

	for _, tt := range tests {
		t.Run(tt.category, func(t *testing.T) {
			if got := configCategoryInvalidatesMetricsCache(tt.category); got != tt.expected {
				t.Errorf("configCategoryInvalidatesMetricsCache(%q) = %v, want %v", tt.category, got, tt.expected)
			}
		})
	}
}

// Create, update AND delete of a metrics-read config row each clear the cache:
// deleting a budget goal or a grade range changes the forecast just as editing
// one does. A row in a category no metric reads does not.
func TestConfigHooksNotifyOnCreateUpdateDelete(t *testing.T) {
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	col := core.NewBaseCollection("config")
	col.Fields.Add(&core.TextField{Name: "category"})
	col.Fields.Add(&core.TextField{Name: "config_key"})
	if saveErr := app.Save(col); saveErr != nil {
		t.Fatalf("create config collection: %v", saveErr)
	}

	var notified atomic.Int32
	bindConfigHooks(app, func() { notified.Add(1) })

	rec := core.NewRecord(col)
	rec.Set("category", "budget")
	rec.Set("config_key", "session_1000001")
	if saveErr := app.Save(rec); saveErr != nil {
		t.Fatalf("create: %v", saveErr)
	}
	if got := notified.Load(); got != 1 {
		t.Fatalf("after create: notified %d times, want 1", got)
	}

	rec.Set("config_key", "session_1000002")
	if saveErr := app.Save(rec); saveErr != nil {
		t.Fatalf("update: %v", saveErr)
	}
	if got := notified.Load(); got != 2 {
		t.Fatalf("after update: notified %d times, want 2", got)
	}

	if delErr := app.Delete(rec); delErr != nil {
		t.Fatalf("delete: %v", delErr)
	}
	if got := notified.Load(); got != 3 {
		t.Fatalf("after delete: notified %d times, want 3", got)
	}

	other := core.NewRecord(col)
	other.Set("category", "sync")
	other.Set("config_key", "schedule")
	if saveErr := app.Save(other); saveErr != nil {
		t.Fatalf("create unrelated: %v", saveErr)
	}
	if got := notified.Load(); got != 3 {
		t.Errorf("an unrelated category notified: %d, want 3", got)
	}
}

func TestNotifyMetricsCacheInvalidation(t *testing.T) {
	t.Run("calls the invalidation endpoint", func(t *testing.T) {
		var called atomic.Int32
		ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPost {
				t.Errorf("expected POST, got %s", r.Method)
			}
			if r.URL.Path != "/api/metrics/cache/invalidate" {
				t.Errorf("expected /api/metrics/cache/invalidate, got %s", r.URL.Path)
			}
			called.Add(1)
			w.WriteHeader(http.StatusOK)
			_, _ = io.WriteString(w, `{"cleared": 5}`)
		}))
		defer ts.Close()

		notifyMetricsCacheInvalidation(ts.URL)

		// Give the goroutine time to complete
		time.Sleep(100 * time.Millisecond)

		if called.Load() != 1 {
			t.Errorf("expected 1 call to invalidation endpoint, got %d", called.Load())
		}
	})

	t.Run("does not panic on unreachable server", func(t *testing.T) {
		// Should not panic even with a bad URL
		notifyMetricsCacheInvalidation("http://127.0.0.1:1")
		time.Sleep(100 * time.Millisecond)
	})
}

// In production PocketBase and FastAPI are separate containers, so the hook
// must reach FastAPI at API_URL (http://api:8000 in docker-compose). It used
// to build 127.0.0.1:$API_PORT -- PocketBase's OWN container, where nothing
// listens -- so a registration-config change never reached the metrics cache.
func TestConfigHooksReachFastAPIThroughAPIURL(t *testing.T) {
	t.Setenv("API_URL", "http://api:8000")
	t.Setenv("API_PORT", "8000")
	if got := configHooksAPIBaseURL(); got != "http://api:8000" {
		t.Errorf("configHooksAPIBaseURL() = %q, want the API_URL value http://api:8000", got)
	}
}
