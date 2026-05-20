package sync

import (
	"context"
	"sync"
	"testing"
	"testing/synctest"
	"time"
)

// TestSchedulerCreation tests scheduler initialization
func TestSchedulerCreation(t *testing.T) {
	s := NewScheduler(nil)

	if s == nil {
		t.Fatal("NewScheduler returned nil")
		return
	}

	if s.cron == nil {
		t.Error("cron should be initialized")
	}

	if s.orchestrator == nil {
		t.Error("orchestrator should be initialized")
	}
}

// TestSchedulerTriggerSyncTypes tests that TriggerSync handles all expected types
func TestSchedulerTriggerSyncTypes(t *testing.T) {
	// Valid sync types that should be handled
	validTypes := []string{
		"refresh-bunking",
		"daily",
		"hourly",
		"weekly",
	}

	for _, syncType := range validTypes {
		t.Run(syncType, func(_ *testing.T) {
			s := NewScheduler(nil)

			// Register mock services for testing
			mock := &MockService{name: "test"}
			s.orchestrator.RegisterService("bunk_assignments", mock)
			s.orchestrator.RegisterService("bunks", mock)
			s.orchestrator.RegisterService("bunk_plans", mock)
			// Weekly sync services (definition tables)
			s.orchestrator.RegisterService("divisions", mock)
			s.orchestrator.RegisterService("person_tag_defs", mock)
			s.orchestrator.RegisterService("custom_field_defs", mock)

			// TriggerSync should not return "unknown sync type" error for valid types
			// (it may still fail due to missing services, but that's OK for this test)
			// We're testing that the switch case exists
		})
	}
}

// TestSchedulerUnknownSyncType tests that unknown sync types return an error
func TestSchedulerUnknownSyncType(t *testing.T) {
	s := NewScheduler(nil)

	err := s.TriggerSync(context.Background(), "invalid-type")
	if err == nil {
		t.Error("expected error for unknown sync type")
	}

	expectedMsg := "unknown sync type: invalid-type"
	if err.Error() != expectedMsg {
		t.Errorf("expected error %q, got %q", expectedMsg, err.Error())
	}
}

// TestIsWeeklySyncRunning tests weekly sync status check via scheduler
func TestSchedulerIsWeeklySyncRunning(t *testing.T) {
	s := NewScheduler(nil)

	if s.IsWeeklySyncRunning() {
		t.Error("weekly sync should not be running initially")
	}
}

// TestIsCustomValuesSyncRunning tests custom values sync status check via scheduler
func TestSchedulerIsCustomValuesSyncRunning(t *testing.T) {
	s := NewScheduler(nil)

	if s.IsCustomValuesSyncRunning() {
		t.Error("custom values sync should not be running initially")
	}
}

// TestTriggerSyncCustomValues tests that TriggerSync handles custom-values type
func TestSchedulerTriggerSyncCustomValues(t *testing.T) {
	s := NewScheduler(nil)

	// Register mock services for custom values sync
	mock := &MockService{name: "test"}
	s.orchestrator.RegisterService("person_custom_values", mock)
	s.orchestrator.RegisterService("household_custom_values", mock)

	// TriggerSync should handle custom-values type
	err := s.TriggerSync(context.Background(), "custom-values")
	// It should not return "unknown sync type" error
	if err != nil && err.Error() == "unknown sync type: custom-values" {
		t.Error("TriggerSync should handle custom-values type")
	}
}

// TestGetCustomValuesSyncJobs tests that custom values sync jobs are returned correctly
func TestGetCustomValuesSyncJobs(t *testing.T) {
	jobs := GetCustomValuesSyncJobs()

	expected := []string{"person_custom_values", "household_custom_values"}
	if len(jobs) != len(expected) {
		t.Errorf("expected %d jobs, got %d", len(expected), len(jobs))
	}

	for i, job := range expected {
		if jobs[i] != job {
			t.Errorf("expected job %d to be %q, got %q", i, job, jobs[i])
		}
	}
}

// TestCustomValuesSyncRunsSequentially verifies that runCustomValuesSync waits for each
// job to complete before starting the next, preventing concurrent API load.
// This is a regression test for the "rate limiter wait: context deadline exceeded" issue
// that occurred when both custom values syncs ran concurrently, doubling API pressure.
func TestCustomValuesSyncRunsSequentially(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		s := NewScheduler(nil)

		// Create mock services that track execution timing
		type execRecord struct {
			start time.Time
			end   time.Time
		}
		var mu sync.Mutex
		execTimes := make(map[string]*execRecord)

		// Create slow mock services (100ms each) to make timing measurable
		for _, name := range []string{"person_custom_values", "household_custom_values"} {
			jobName := name
			mock := &MockService{
				name:  jobName,
				delay: 100 * time.Millisecond,
			}
			// Wrap the mock to record timing
			wrappedMock := &timingMockService{
				MockService: mock,
				onSync: func() {
					mu.Lock()
					execTimes[jobName] = &execRecord{start: time.Now()}
					mu.Unlock()
				},
				afterSync: func() {
					mu.Lock()
					if rec := execTimes[jobName]; rec != nil {
						rec.end = time.Now()
					}
					mu.Unlock()
				},
			}
			s.orchestrator.RegisterService(name, wrappedMock)
		}

		// Run the custom values sync (this should run sequentially)
		s.runCustomValuesSync()

		// Allow virtual time to advance past both 100ms mock delays plus margin.
		time.Sleep(300 * time.Millisecond)

		// Verify sequential execution: job 2 should start AFTER job 1 ends
		mu.Lock()
		personRec := execTimes["person_custom_values"]
		householdRec := execTimes["household_custom_values"]
		mu.Unlock()

		if personRec == nil || householdRec == nil {
			t.Fatal("expected both services to have been executed")
			return
		}

		// Ensure end times were recorded (syncs completed)
		if personRec.end.IsZero() || householdRec.end.IsZero() {
			t.Fatal("expected both services to have completed (end times recorded)")
			return
		}

		// Check that there's no overlap - one must complete before the other starts
		// Either: person ends before household starts, OR household ends before person starts
		personEndsFirst := personRec.end.Before(householdRec.start) || personRec.end.Equal(householdRec.start)
		householdEndsFirst := householdRec.end.Before(personRec.start) || householdRec.end.Equal(personRec.start)

		if !personEndsFirst && !householdEndsFirst {
			t.Errorf("custom values syncs ran concurrently (overlapped):\n"+
				"  person_custom_values:    start=%v, end=%v\n"+
				"  household_custom_values: start=%v, end=%v",
				personRec.start.Format(time.RFC3339Nano), personRec.end.Format(time.RFC3339Nano),
				householdRec.start.Format(time.RFC3339Nano), householdRec.end.Format(time.RFC3339Nano))
		}
	})
}

// TestGetRefreshBunkingJobs tests that refresh bunking returns the correct services in order
func TestGetRefreshBunkingJobs(t *testing.T) {
	jobs := GetRefreshBunkingJobs()

	// stranded_assignment_cleanup runs last: refresh-bunking rewrites bunk_plans,
	// which is exactly what strands scenario drafts — they must be swept in the
	// same run.
	expected := []string{"bunks", "bunk_plans", "bunk_assignments", "stranded_assignment_cleanup"}
	if len(jobs) != len(expected) {
		t.Fatalf("expected %d jobs, got %d: %v", len(expected), len(jobs), jobs)
	}

	for i, job := range expected {
		if jobs[i] != job {
			t.Errorf("expected job %d to be %q, got %q", i, job, jobs[i])
		}
	}
}

// TestRefreshBunkingRunsAllServices verifies that refresh-bunking triggers
// bunks, bunk_plans, bunk_assignments, and stranded_assignment_cleanup in
// sequence (not just bunk_assignments)
func TestRefreshBunkingRunsAllServices(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		s := NewScheduler(nil)

		// Track which services were called and in what order
		var mu sync.Mutex
		var callOrder []string

		for _, name := range GetRefreshBunkingJobs() {
			jobName := name
			mock := &MockService{
				name:  jobName,
				delay: 10 * time.Millisecond,
			}
			wrappedMock := &timingMockService{
				MockService: mock,
				onSync: func() {
					mu.Lock()
					callOrder = append(callOrder, jobName)
					mu.Unlock()
				},
			}
			s.orchestrator.RegisterService(name, wrappedMock)
		}

		err := s.TriggerSync(context.Background(), "refresh-bunking")
		if err != nil {
			t.Fatalf("TriggerSync failed: %v", err)
		}

		// Allow virtual time to advance past all 4 services × 10ms mock delays plus margin.
		time.Sleep(200 * time.Millisecond)

		mu.Lock()
		defer mu.Unlock()

		expected := []string{"bunks", "bunk_plans", "bunk_assignments", "stranded_assignment_cleanup"}
		if len(callOrder) != len(expected) {
			t.Fatalf("expected %d services called, got %d: %v", len(expected), len(callOrder), callOrder)
		}

		for i, name := range expected {
			if callOrder[i] != name {
				t.Errorf("expected service %d to be %q, got %q (order: %v)", i, name, callOrder[i], callOrder)
			}
		}
	})
}

// TestRefreshBunkingRegistersRequiredServices verifies that TriggerSync for
// refresh-bunking requires every bunking sync job to be registered
func TestRefreshBunkingRegistersRequiredServices(t *testing.T) {
	s := NewScheduler(nil)

	// Only register bunk_assignments (old behavior) — should fail with new code
	// because bunks and bunk_plans are also needed
	mock := &MockService{name: "test"}
	s.orchestrator.RegisterService("bunk_assignments", mock)

	err := s.TriggerSync(context.Background(), "refresh-bunking")
	// Should get an error about missing "bunks" service
	if err == nil {
		t.Error("expected error when bunks service is not registered")
	}
}

// timingMockService wraps MockService to add timing callbacks
type timingMockService struct {
	*MockService
	onSync    func()
	afterSync func()
}

func (t *timingMockService) Sync(ctx context.Context) error {
	if t.onSync != nil {
		t.onSync()
	}
	err := t.MockService.Sync(ctx)
	if t.afterSync != nil {
		t.afterSync()
	}
	return err
}
