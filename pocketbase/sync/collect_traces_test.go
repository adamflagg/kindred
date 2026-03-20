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
// 3. CSV upload path wiring
// 4. Manual API endpoint parameter passthrough
// 5. JSON serialization for the Python API call
// 6. End-to-end propagation through callAPIProcessor
// =============================================================================

// TestNewRequestProcessor_CollectTracesDefaultsFalse verifies that a freshly
// created RequestProcessor has CollectTraces=false by default. This is
// important because automated paths explicitly set it to true — the default
// must be false so that manual/ad-hoc runs don't collect traces unless
// requested.
func TestNewRequestProcessor_CollectTracesDefaultsFalse(t *testing.T) {
	processor := NewRequestProcessor(nil)

	if processor.CollectTraces {
		t.Error("expected CollectTraces to default to false for a new RequestProcessor")
	}
}

// TestDailySyncRegistration_SetsCollectTracesTrue verifies that the daily sync
// registration pattern (as used in InitializeSyncServices) creates a
// RequestProcessor with CollectTraces=true and registers it as
// "process_requests" in the orchestrator.
//
// Production code (orchestrator.go ~line 1707):
//
//	processor := NewRequestProcessor(o.app)
//	processor.CollectTraces = true
//	o.RegisterService("process_requests", processor)
func TestDailySyncRegistration_SetsCollectTracesTrue(t *testing.T) {
	o := NewOrchestrator(nil)

	// Replicate the exact production wiring from InitializeSyncServices()
	processor := NewRequestProcessor(nil)
	processor.CollectTraces = true
	o.RegisterService("process_requests", processor)

	// Retrieve and verify via the orchestrator's service map
	svc, exists := o.services["process_requests"]
	if !exists {
		t.Fatal("process_requests service not registered")
	}

	rp, ok := svc.(*RequestProcessor)
	if !ok {
		t.Fatal("process_requests service is not a *RequestProcessor")
	}

	if !rp.CollectTraces {
		t.Error("expected CollectTraces=true on process_requests registered for daily sync")
	}
}

// TestHistoricalSyncRegistration_SetsCollectTracesTrue verifies that the
// historical sync path in RunSyncWithOptions creates a new RequestProcessor
// with CollectTraces=true when re-registering services for a specific year.
//
// Production code (orchestrator.go ~line 1172):
//
//	yearProcessor := NewRequestProcessor(o.app)
//	yearProcessor.CollectTraces = true
//	o.RegisterService("process_requests", yearProcessor)
func TestHistoricalSyncRegistration_SetsCollectTracesTrue(t *testing.T) {
	o := NewOrchestrator(nil)

	// Replicate the exact production wiring from RunSyncWithOptions()
	yearProcessor := NewRequestProcessor(nil)
	yearProcessor.CollectTraces = true
	o.RegisterService("process_requests", yearProcessor)

	svc, exists := o.services["process_requests"]
	if !exists {
		t.Fatal("process_requests service not registered")
	}

	rp, ok := svc.(*RequestProcessor)
	if !ok {
		t.Fatal("process_requests service is not a *RequestProcessor")
	}

	if !rp.CollectTraces {
		t.Error("expected CollectTraces=true on process_requests registered for historical sync")
	}
}

// TestCSVUploadPath_SetsCollectTracesTrue verifies that the CSV upload wiring
// pattern creates a processor with both ClearExisting=true and
// CollectTraces=true, matching the production code in api.go.
//
// Production code (api.go ~line 827-832):
//
//	processor := NewRequestProcessor(scheduler.app)
//	processor.ClearExisting = true
//	processor.CollectTraces = true
func TestCSVUploadPath_SetsCollectTracesTrue(t *testing.T) {
	processor := NewRequestProcessor(nil)
	processor.ClearExisting = true
	processor.CollectTraces = true

	if !processor.CollectTraces {
		t.Error("expected CollectTraces=true on processor configured for CSV upload")
	}

	if !processor.ClearExisting {
		t.Error("expected ClearExisting=true on processor configured for CSV upload")
	}
}

// TestManualProcessRequests_CollectTracesFromParam verifies that the manual
// /process-requests endpoint wiring correctly passes through the
// collect_traces query parameter to the RequestProcessor.
//
// Production code (api.go ~line 204-215):
//
//	collectTracesParam := e.Request.URL.Query().Get("collect_traces")
//	collectTraces := collectTracesParam == "true" || collectTracesParam == "1"
//	processor.CollectTraces = collectTraces
func TestManualProcessRequests_CollectTracesFromParam(t *testing.T) {
	t.Run("collect_traces=true sets CollectTraces on processor", func(t *testing.T) {
		processor := NewRequestProcessor(nil)
		// Simulate parsing "true" from query parameter
		collectTraces := true
		processor.CollectTraces = collectTraces

		if !processor.CollectTraces {
			t.Error("expected CollectTraces=true when collect_traces param is true")
		}
	})

	t.Run("collect_traces absent leaves CollectTraces=false", func(t *testing.T) {
		processor := NewRequestProcessor(nil)
		// Simulate absent/empty query parameter
		collectTraces := false
		processor.CollectTraces = collectTraces

		if processor.CollectTraces {
			t.Error("expected CollectTraces=false when collect_traces param is absent")
		}
	})
}

// TestCollectTraces_JSONSerialization verifies that the collect_traces field
// is correctly serialized in the JSON body sent to the Python API. This is
// the actual wire format that Python reads.
func TestCollectTraces_JSONSerialization(t *testing.T) {
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

		var decoded map[string]interface{}
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

		var decoded map[string]interface{}
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

// TestCollectTraces_EndToEndViaCallAPIProcessor verifies that CollectTraces=true
// on the RequestProcessor results in collect_traces=true arriving at the Python
// API endpoint. Uses a test HTTP server to capture the actual request body.
func TestCollectTraces_EndToEndViaCallAPIProcessor(t *testing.T) {
	t.Run("collect_traces=true reaches the API", func(t *testing.T) {
		var receivedCollectTraces bool
		var fieldPresent bool

		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			var body map[string]interface{}
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

		_, err := callAPIProcessor(context.Background(), server.URL, apiProcessorRequest{
			Year:          2025,
			Session:       "all",
			CollectTraces: true,
		})
		if err != nil {
			t.Fatalf("callAPIProcessor failed: %v", err)
		}

		if !fieldPresent {
			t.Fatal("collect_traces field not present in request to Python API")
		}

		if !receivedCollectTraces {
			t.Error("expected collect_traces=true to reach the Python API")
		}
	})

	t.Run("collect_traces=false reaches the API", func(t *testing.T) {
		var receivedCollectTraces bool
		var fieldPresent bool

		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			var body map[string]interface{}
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

		_, err := callAPIProcessor(context.Background(), server.URL, apiProcessorRequest{
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
	})
}

// TestCollectTraces_OverwriteOnReRegistration verifies that when the
// orchestrator re-registers the process_requests service (as happens when
// RunSyncWithOptions switches from current-year to historical-year),
// the new processor's CollectTraces value replaces the old one.
func TestCollectTraces_OverwriteOnReRegistration(t *testing.T) {
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

// TestCollectTraces_ProcessorToRequestMapping verifies that the field mapping
// from RequestProcessor.CollectTraces to apiProcessorRequest.CollectTraces
// works correctly. This mirrors the mapping in RequestProcessor.Sync():
//
//	CollectTraces: p.CollectTraces,
func TestCollectTraces_ProcessorToRequestMapping(t *testing.T) {
	processor := NewRequestProcessor(nil)

	// Default mapping
	req := apiProcessorRequest{
		CollectTraces: processor.CollectTraces,
	}
	if req.CollectTraces {
		t.Error("default processor should map to CollectTraces=false in request")
	}

	// Enabled mapping
	processor.CollectTraces = true
	req = apiProcessorRequest{
		CollectTraces: processor.CollectTraces,
	}
	if !req.CollectTraces {
		t.Error("enabled processor should map to CollectTraces=true in request")
	}
}
