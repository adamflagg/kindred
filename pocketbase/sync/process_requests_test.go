package sync

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// TestCallAPIProcessor tests the HTTP-based process-requests API call
func TestCallAPIProcessor(t *testing.T) {
	t.Parallel()
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
				var reqBody map[string]any
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

			stats, err := callAPIProcessor(context.Background(), server.URL, &apiProcessorRequest{
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
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var reqBody map[string]any
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

	stats, err := callAPIProcessor(context.Background(), server.URL, &apiProcessorRequest{
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
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var reqBody map[string]any
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

	stats, err := callAPIProcessor(context.Background(), server.URL, &apiProcessorRequest{
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

func TestGetProcessRequestsTimeout(t *testing.T) {
	tests := []struct {
		name     string
		envValue string
		want     time.Duration
	}{
		{
			name:     "default when env not set",
			envValue: "",
			want:     120 * time.Minute,
		},
		{
			name:     "custom value from env",
			envValue: "60",
			want:     60 * time.Minute,
		},
		{
			name:     "invalid value falls back to default",
			envValue: "not-a-number",
			want:     120 * time.Minute,
		},
		{
			name:     "zero falls back to default",
			envValue: "0",
			want:     120 * time.Minute,
		},
		{
			name:     "negative falls back to default",
			envValue: "-5",
			want:     120 * time.Minute,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("PROCESS_REQUESTS_TIMEOUT_MINUTES", tt.envValue)
			got := getProcessRequestsTimeout()
			if got != tt.want {
				t.Errorf("getProcessRequestsTimeout() = %v, want %v", got, tt.want)
			}
		})
	}
}

// TestApiProcessorRequestSerializesTrigger verifies that the trigger field is serialized in the JSON body
func TestApiProcessorRequestSerializesTrigger(t *testing.T) {
	t.Parallel()
	b, err := json.Marshal(apiProcessorRequest{Year: 2026, Session: "all", Trigger: "upload"})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if !strings.Contains(string(b), `"trigger":"upload"`) {
		t.Errorf("expected trigger in JSON, got: %s", string(b))
	}
}

// TestApiProcessorRequestOmitsEmptyTrigger verifies that an empty trigger is omitted from the JSON body
func TestApiProcessorRequestOmitsEmptyTrigger(t *testing.T) {
	t.Parallel()
	b, err := json.Marshal(apiProcessorRequest{Year: 2026, Session: "all"})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if strings.Contains(string(b), "trigger") {
		t.Errorf("empty trigger should be omitted, got: %s", string(b))
	}
}

// TestIsValidSessionWithCMIDs verifies IsValidSession accepts cm_ids and rejects
// non-numeric strings after the migration from friendly session names.
// Regression test for #807.
func TestIsValidSessionWithCMIDs(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		session string
		want    bool
	}{
		{"empty is valid", "", true},
		{"all is valid", "all", true},
		{"numeric cm_id is valid", "12345", true},
		{"single digit still valid (was friendly name)", "1", true},
		{"toc is now invalid (non-numeric)", "toc", false},
		{"abc is invalid", "abc", false},
		{"negative is invalid", "-1", false},
		{"zero is invalid (handled by normalizeSession before reaching validation)", "0", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := IsValidSession(tt.session)
			if got != tt.want {
				t.Errorf("IsValidSession(%q) = %v, want %v", tt.session, got, tt.want)
			}
		})
	}
}
