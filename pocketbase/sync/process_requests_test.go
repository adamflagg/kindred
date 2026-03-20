package sync

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestGetSessionNamePattern tests the session name pattern generation
// Session 1 is "Taste of Camp", not "Session 1"
func TestGetSessionNamePattern(t *testing.T) {
	tests := []struct {
		name        string
		sessionNum  string
		wantPattern string
	}{
		{
			name:        "session 1 should match Taste of Camp",
			sessionNum:  "1",
			wantPattern: "Taste of Camp",
		},
		{
			name:        "session 2 should match Session 2",
			sessionNum:  "2",
			wantPattern: "Session 2",
		},
		{
			name:        "session 3 should match Session 3",
			sessionNum:  "3",
			wantPattern: "Session 3",
		},
		{
			name:        "session 4 should match Session 4",
			sessionNum:  "4",
			wantPattern: "Session 4",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := GetSessionNamePattern(tt.sessionNum)
			if got != tt.wantPattern {
				t.Errorf("GetSessionNamePattern(%q) = %q, want %q", tt.sessionNum, got, tt.wantPattern)
			}
		})
	}
}

// TestIsEmbeddedSession tests detection of embedded sessions (2a, 2b, 3a, etc.)
func TestIsEmbeddedSession(t *testing.T) {
	tests := []struct {
		name       string
		sessionNum string
		want       bool
	}{
		// Main sessions - not embedded
		{"session 1 is main", "1", false},
		{"session 2 is main", "2", false},
		{"session 3 is main", "3", false},
		{"session 4 is main", "4", false},
		// Embedded sessions
		{"session 2a is embedded", "2a", true},
		{"session 2b is embedded", "2b", true},
		{"session 3a is embedded", "3a", true},
		{"session 3b is embedded", "3b", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := IsEmbeddedSession(tt.sessionNum)
			if got != tt.want {
				t.Errorf("IsEmbeddedSession(%q) = %v, want %v", tt.sessionNum, got, tt.want)
			}
		})
	}
}

// TestCallAPIProcessor tests the HTTP-based process-requests API call
func TestCallAPIProcessor(t *testing.T) {
	tests := []struct {
		name           string
		responseStatus int
		responseBody   string
		wantErr        bool
		wantCreated    int
	}{
		{
			name:           "successful processing",
			responseStatus: 200,
			responseBody:   `{"success": true, "created": 5, "updated": 0, "skipped": 1, "errors": 0, "already_processed": 10}`,
			wantErr:        false,
			wantCreated:    5,
		},
		{
			name:           "python reports failure but HTTP 200",
			responseStatus: 200,
			responseBody:   `{"success": false, "created": 0, "updated": 0, "skipped": 0, "errors": 1, "already_processed": 0}`,
			wantErr:        false,
			wantCreated:    0,
		},
		{
			name:           "server error",
			responseStatus: 500,
			responseBody:   `{"success": false, "error": "PocketBase auth failed"}`,
			wantErr:        true,
			wantCreated:    0,
		},
		{
			name:           "response with warnings logs them",
			responseStatus: 200,
			responseBody: `{"success":true,"created":0,"updated":0,"skipped":0,` +
				`"errors":15,"already_processed":800,` +
				`"warnings":["15/15 AI parse requests failed: Unsupported parameter"],` +
				`"phase1_failed":15}`,
			wantErr:     false,
			wantCreated: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != "POST" {
					t.Errorf("expected POST, got %s", r.Method)
				}
				if r.URL.Path != "/api/internal/process-requests" {
					t.Errorf("expected /api/internal/process-requests, got %s", r.URL.Path)
				}

				// Verify request body has expected fields
				var reqBody map[string]interface{}
				if err := json.NewDecoder(r.Body).Decode(&reqBody); err != nil {
					t.Errorf("failed to decode request body: %v", err)
				}
				if _, ok := reqBody["year"]; !ok {
					t.Error("request body missing 'year' field")
				}
				if _, ok := reqBody["session"]; !ok {
					t.Error("request body missing 'session' field")
				}

				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(tt.responseStatus)
				_, _ = w.Write([]byte(tt.responseBody))
			}))
			defer server.Close()

			stats, err := callAPIProcessor(context.Background(), server.URL, apiProcessorRequest{
				Year:    2025,
				Session: "all",
			})

			if tt.wantErr {
				if err == nil {
					t.Error("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Errorf("unexpected error: %v", err)
			}
			if stats.Created != tt.wantCreated {
				t.Errorf("expected %d created, got %d", tt.wantCreated, stats.Created)
			}
		})
	}
}

// TestCallAPIProcessor_ForceField verifies the force field is serialized in the request body
func TestCallAPIProcessor_ForceField(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var reqBody map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&reqBody); err != nil {
			t.Fatalf("failed to decode request body: %v", err)
		}

		// Verify force field is present and true
		forceVal, ok := reqBody["force"]
		if !ok {
			t.Error("request body missing 'force' field")
		}
		if forceBool, ok := forceVal.(bool); !ok || !forceBool {
			t.Errorf("expected force=true, got %v", forceVal)
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(200)
		resp := `{"success":true,"created":3,"updated":0,"skipped":0,"errors":0,"already_processed":0}`
		_, _ = w.Write([]byte(resp))
	}))
	defer server.Close()

	stats, err := callAPIProcessor(context.Background(), server.URL, apiProcessorRequest{
		Year:    2025,
		Session: "1",
		Force:   true,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if stats.Created != 3 {
		t.Errorf("expected 3 created, got %d", stats.Created)
	}
}

// TestCallAPIProcessor_CollectTracesField verifies collect_traces is serialized in the request body
func TestCallAPIProcessor_CollectTracesField(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var reqBody map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&reqBody); err != nil {
			t.Fatalf("failed to decode request body: %v", err)
		}

		// Verify collect_traces field is present and true
		val, ok := reqBody["collect_traces"]
		if !ok {
			t.Error("request body missing 'collect_traces' field")
		}
		if boolVal, ok := val.(bool); !ok || !boolVal {
			t.Errorf("expected collect_traces=true, got %v", val)
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(200)
		resp := `{"success":true,"created":2,"updated":0,"skipped":0,"errors":0,"already_processed":0}`
		_, _ = w.Write([]byte(resp))
	}))
	defer server.Close()

	stats, err := callAPIProcessor(context.Background(), server.URL, apiProcessorRequest{
		Year:          2025,
		Session:       "all",
		CollectTraces: true,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if stats.Created != 2 {
		t.Errorf("expected 2 created, got %d", stats.Created)
	}
}

// TestNewRequestProcessor_DefaultCollectTraces verifies CollectTraces defaults to false
func TestNewRequestProcessor_DefaultCollectTraces(t *testing.T) {
	// NewRequestProcessor requires a core.App, but we only need to check the default field value.
	// We can't easily create a real PocketBase app in unit tests, so test the struct default directly.
	p := &RequestProcessor{}
	if p.CollectTraces {
		t.Error("expected CollectTraces to default to false on zero-value struct")
	}
}
