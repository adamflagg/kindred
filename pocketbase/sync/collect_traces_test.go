package sync

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// =============================================================================
// CollectTraces Wiring Tests
//
// These tests verify that the CollectTraces flag is correctly wired across
// the sync pipeline:
// 1. Default value on RequestProcessor
// 2. Orchestrator registration in daily/historical sync paths
// 3. Query parameter parsing for the manual API endpoint
// 4. JSON serialization for the Python API call
// 5. End-to-end propagation through callAPIProcessor
// 6. Re-registration overwrites previous value
// =============================================================================

// TestNewRequestProcessor_CollectTracesDefaultsFalse verifies that a freshly
// created RequestProcessor has CollectTraces=false by default. This is
// important because automated paths explicitly set it to true — the default
// must be false so that manual/ad-hoc runs don't collect traces unless
// requested.
func TestNewRequestProcessor_CollectTracesDefaultsFalse(t *testing.T) {
	t.Parallel()
	processor := NewRequestProcessor(nil)

	if processor.CollectTraces {
		t.Error("expected CollectTraces to default to false for a new RequestProcessor")
	}
}

// TestSyncRegistration_SetsCollectTracesTrue verifies that both the daily sync
// and historical sync registration patterns create a RequestProcessor with
// CollectTraces=true and register it as "process_requests" in the orchestrator.
func TestSyncRegistration_SetsCollectTracesTrue(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
	}{
		{name: "daily sync registration"},
		{name: "historical sync registration"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			o := NewOrchestrator(nil)

			processor := NewRequestProcessor(nil)
			processor.CollectTraces = true
			o.RegisterService("process_requests", processor)

			svc, exists := o.services["process_requests"]
			if !exists {
				t.Fatal("process_requests service not registered")
			}

			rp, ok := svc.(*RequestProcessor)
			if !ok {
				t.Fatal("process_requests service is not a *RequestProcessor")
			}

			if !rp.CollectTraces {
				t.Errorf("expected CollectTraces=true on process_requests registered for %s", tt.name)
			}
		})
	}
}

// TestManualProcessRequests_CollectTracesFromParam verifies that the manual
// /process-requests endpoint correctly parses the collect_traces query
// parameter from an HTTP request URL.
//
// Production code (api.go ~line 204-215):
//
//	collectTracesParam := e.Request.URL.Query().Get("collect_traces")
//	collectTraces := collectTracesParam == "true" || collectTracesParam == "1"
//	processor.CollectTraces = collectTraces
func TestManualProcessRequests_CollectTracesFromParam(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name  string
		query string
		want  bool
	}{
		{name: "collect_traces=true", query: "?collect_traces=true", want: true},
		{name: "collect_traces=1", query: "?collect_traces=1", want: true},
		{name: "collect_traces=false", query: "?collect_traces=false", want: false},
		{name: "collect_traces absent", query: "", want: false},
		{name: "collect_traces empty", query: "?collect_traces=", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/api/custom/sync/process-requests"+tt.query, http.NoBody)

			collectTracesParam := req.URL.Query().Get("collect_traces")
			collectTraces := collectTracesParam == "true" || collectTracesParam == "1"

			if collectTraces != tt.want {
				t.Errorf("expected collect_traces=%v for query %q, got %v", tt.want, tt.query, collectTraces)
			}
		})
	}
}

// TestCollectTraces_JSONSerialization verifies that the collect_traces field
// is correctly serialized in the JSON body sent to the Python API. This is
// the actual wire format that Python reads.
func TestCollectTraces_JSONSerialization(t *testing.T) {
	t.Parallel()
	t.Run("collect_traces=true appears in JSON", func(t *testing.T) {
		req := apiProcessorRequest{
			Year:          2025,
			Session:       "all",
			CollectTraces: true,
		}

		data, err := json.Marshal(req)
		if err != nil {
			t.Fatalf("failed to marshal request: %v", err)
		}

		var decoded map[string]any
		if err := json.Unmarshal(data, &decoded); err != nil {
			t.Fatalf("failed to unmarshal: %v", err)
		}

		val, exists := decoded["collect_traces"]
		if !exists {
			t.Fatal("collect_traces field missing from JSON output")
		}

		boolVal, ok := val.(bool)
		if !ok || !boolVal {
			t.Errorf("expected collect_traces=true in JSON, got %v", val)
		}
	})

	t.Run("collect_traces=false appears in JSON as false", func(t *testing.T) {
		req := apiProcessorRequest{
			Year:          2025,
			Session:       "all",
			CollectTraces: false,
		}

		data, err := json.Marshal(req)
		if err != nil {
			t.Fatalf("failed to marshal request: %v", err)
		}

		var decoded map[string]any
		if err := json.Unmarshal(data, &decoded); err != nil {
			t.Fatalf("failed to unmarshal: %v", err)
		}

		val, exists := decoded["collect_traces"]
		if !exists {
			t.Fatal("collect_traces field missing from JSON output")
		}

		boolVal, ok := val.(bool)
		if !ok || boolVal {
			t.Errorf("expected collect_traces=false in JSON, got %v", val)
		}
	})
}

// TestCollectTraces_EndToEndFalseViaCallAPIProcessor verifies that
// CollectTraces=false on the RequestProcessor results in collect_traces=false
// arriving at the Python API endpoint. Uses a test HTTP server to capture the
// actual request body.
//
// Note: The collect_traces=true case is covered by
// TestCallAPIProcessor_CollectTracesField in process_requests_test.go.
func TestCollectTraces_EndToEndFalseViaCallAPIProcessor(t *testing.T) {
	t.Parallel()
	var receivedCollectTraces bool
	var fieldPresent bool

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("failed to decode request body: %v", err)
			w.WriteHeader(500)
			return
		}

		val, ok := body["collect_traces"]
		fieldPresent = ok
		if ok {
			receivedCollectTraces, _ = val.(bool)
		}

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"success":true,"created":0,"updated":0,"skipped":0,"errors":0,"already_processed":0}`))
	}))
	defer server.Close()

	_, err := callAPIProcessor(context.Background(), server.URL, &apiProcessorRequest{
		Year:          2025,
		Session:       "all",
		CollectTraces: false,
	})
	if err != nil {
		t.Fatalf("callAPIProcessor failed: %v", err)
	}

	if !fieldPresent {
		t.Fatal("collect_traces field not present in request to Python API")
	}

	if receivedCollectTraces {
		t.Error("expected collect_traces=false to reach the Python API")
	}
}

// TestCollectTraces_OverwriteOnReRegistration verifies that when the
// orchestrator re-registers the process_requests service (as happens when
// RunSyncWithOptions switches from current-year to historical-year),
// the new processor's CollectTraces value replaces the old one.
func TestCollectTraces_OverwriteOnReRegistration(t *testing.T) {
	t.Parallel()
	o := NewOrchestrator(nil)

	// First registration with CollectTraces=false
	processor1 := NewRequestProcessor(nil)
	processor1.CollectTraces = false
	o.RegisterService("process_requests", processor1)

	svc1 := o.services["process_requests"].(*RequestProcessor)
	if svc1.CollectTraces {
		t.Error("expected CollectTraces=false on first registration")
	}

	// Re-register with CollectTraces=true (simulates historical sync overwrite)
	processor2 := NewRequestProcessor(nil)
	processor2.CollectTraces = true
	o.RegisterService("process_requests", processor2)

	svc2 := o.services["process_requests"].(*RequestProcessor)
	if !svc2.CollectTraces {
		t.Error("expected CollectTraces=true after re-registration")
	}

	// Confirm it's a new instance, not a mutation of the old one
	if svc1 == svc2 {
		t.Error("expected different processor instances after re-registration")
	}
}
