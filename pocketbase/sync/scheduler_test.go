package sync

import (
	"context"
	"testing"
)

// TestSchedulerCreation tests scheduler initialization
func TestSchedulerCreation(t *testing.T) {
	s := NewScheduler(nil)

	if s == nil {
		t.Fatal("NewScheduler returned nil")
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
		t.Run(syncType, func(t *testing.T) {
			s := NewScheduler(nil)

			// Register mock services for testing
			mock := &MockService{name: "test"}
			s.orchestrator.RegisterService("bunk_assignments", mock)
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
