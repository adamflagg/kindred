package rbac

import (
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
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
