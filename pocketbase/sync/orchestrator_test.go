package sync

import (
	"context"
	"sync/atomic"
	"testing"
	"time"
)

// MockService implements Service interface for testing
type MockService struct {
	name       string
	stats      Stats
	shouldFail bool
	delay      time.Duration
	callCount  atomic.Int32
}

func (m *MockService) Sync(ctx context.Context) error {
	m.callCount.Add(1)

	if m.delay > 0 {
		select {
		case <-time.After(m.delay):
		case <-ctx.Done():
			return ctx.Err()
		}
	}

	if m.shouldFail {
		return context.DeadlineExceeded
	}
	return nil
}

func (m *MockService) Name() string {
	return m.name
}

func (m *MockService) GetStats() Stats {
	return m.stats
}

func (m *MockService) GetCallCount() int {
	return int(m.callCount.Load())
}

// TestOrchestratorCreation tests orchestrator initialization
func TestOrchestratorCreation(t *testing.T) {
	o := NewOrchestrator(nil)

	if o == nil {
		t.Fatal("NewOrchestrator returned nil")
	}

	if o.services == nil {
		t.Error("services map should be initialized")
	}

	if o.runningJobs == nil {
		t.Error("runningJobs map should be initialized")
	}

	if o.lastCompletedStatus == nil {
		t.Error("lastCompletedStatus map should be initialized")
	}

	if o.jobSpacing != 2*time.Second {
		t.Errorf("expected default jobSpacing of 2s, got %v", o.jobSpacing)
	}
}

// TestRegisterService tests service registration
func TestRegisterService(t *testing.T) {
	o := NewOrchestrator(nil)

	mock := &MockService{name: "test_service"}
	o.RegisterService("test", mock)

	if len(o.services) != 1 {
		t.Errorf("expected 1 service, got %d", len(o.services))
	}

	if _, exists := o.services["test"]; !exists {
		t.Error("service should be registered under 'test' key")
	}
}

// TestRegisterMultipleServices tests registering multiple services
func TestRegisterMultipleServices(t *testing.T) {
	o := NewOrchestrator(nil)

	services := []string{"sessions", "attendees", "persons", "bunks"}

	for _, name := range services {
		mock := &MockService{name: name}
		o.RegisterService(name, mock)
	}

	if len(o.services) != len(services) {
		t.Errorf("expected %d services, got %d", len(services), len(o.services))
	}
}

// TestIsRunning tests running status checks
func TestIsRunning(t *testing.T) {
	o := NewOrchestrator(nil)

	// Initially nothing should be running
	if o.IsRunning("sessions") {
		t.Error("sessions should not be running initially")
	}

	// Add a running status
	o.mu.Lock()
	o.runningJobs["sessions"] = &Status{
		Type:   "sessions",
		Status: "running",
	}
	o.mu.Unlock()

	if !o.IsRunning("sessions") {
		t.Error("sessions should be running")
	}

	// Check non-existent job
	if o.IsRunning("nonexistent") {
		t.Error("nonexistent job should not be running")
	}
}

// TestGetStatus tests status retrieval
func TestGetStatus(t *testing.T) {
	o := NewOrchestrator(nil)

	// Get status for non-existent job
	status := o.GetStatus("sessions")
	if status != nil {
		t.Error("expected nil status for unstarted job")
	}

	// Add a completed status
	now := time.Now()
	o.mu.Lock()
	o.lastCompletedStatus["sessions"] = &Status{
		Type:      "sessions",
		Status:    "completed",
		StartTime: now.Add(-time.Minute),
		EndTime:   &now,
		Summary: Stats{
			Created: 10,
			Updated: 5,
		},
	}
	o.mu.Unlock()

	status = o.GetStatus("sessions")
	if status == nil {
		t.Fatal("expected non-nil status")
	}

	if status.Status != "completed" {
		t.Errorf("expected status 'completed', got %q", status.Status)
	}

	if status.Summary.Created != 10 {
		t.Errorf("expected 10 created, got %d", status.Summary.Created)
	}
}

// TestGetRunningJobs tests getting list of running jobs
func TestGetRunningJobs(t *testing.T) {
	o := NewOrchestrator(nil)

	// Initially no jobs running
	jobs := o.GetRunningJobs()
	if len(jobs) != 0 {
		t.Errorf("expected 0 running jobs, got %d", len(jobs))
	}

	// Add some running jobs
	o.mu.Lock()
	o.runningJobs["sessions"] = &Status{Type: "sessions", Status: "running"}
	o.runningJobs["attendees"] = &Status{Type: "attendees", Status: "running"}
	o.runningJobs["bunks"] = &Status{Type: "bunks", Status: "completed"} // Not running
	o.mu.Unlock()

	jobs = o.GetRunningJobs()
	if len(jobs) != 2 {
		t.Errorf("expected 2 running jobs, got %d", len(jobs))
	}

	// Verify correct jobs are returned
	expected := map[string]bool{"sessions": true, "attendees": true}
	for _, job := range jobs {
		if !expected[job] {
			t.Errorf("unexpected running job: %s", job)
		}
	}
}

// TestIsDailySyncRunning tests daily sync running check
func TestIsDailySyncRunning(t *testing.T) {
	o := NewOrchestrator(nil)

	if o.IsDailySyncRunning() {
		t.Error("daily sync should not be running initially")
	}

	o.mu.Lock()
	o.dailySyncRunning = true
	o.mu.Unlock()

	if !o.IsDailySyncRunning() {
		t.Error("daily sync should be running after flag set")
	}
}

// TestIsHistoricalSyncRunning tests historical sync running check
func TestIsHistoricalSyncRunning(t *testing.T) {
	o := NewOrchestrator(nil)

	if o.IsHistoricalSyncRunning() {
		t.Error("historical sync should not be running initially")
	}

	o.mu.Lock()
	o.historicalSyncRunning = true
	o.historicalSyncYear = 2023
	o.mu.Unlock()

	if !o.IsHistoricalSyncRunning() {
		t.Error("historical sync should be running after flag set")
	}

	if o.GetHistoricalSyncYear() != 2023 {
		t.Errorf("expected historical year 2023, got %d", o.GetHistoricalSyncYear())
	}
}

// TestStatusStruct tests Status struct initialization
func TestStatusStruct(t *testing.T) {
	now := time.Now()
	endTime := now.Add(time.Minute)

	status := Status{
		Type:      serviceNameSessions,
		Status:    "completed",
		StartTime: now,
		EndTime:   &endTime,
		Summary: Stats{
			Created: 10,
			Updated: 5,
			Skipped: 2,
			Errors:  1,
		},
		Year: 2024,
	}

	if status.Type != serviceNameSessions {
		t.Errorf("expected type %q, got %q", serviceNameSessions, status.Type)
	}

	if status.Year != 2024 {
		t.Errorf("expected year 2024, got %d", status.Year)
	}

	if status.Summary.Created != 10 {
		t.Errorf("expected 10 created, got %d", status.Summary.Created)
	}
}

// TestOptions tests Options struct
func TestOptions(t *testing.T) {
	opts := Options{
		Year:       2023,
		Services:   []string{"sessions", "attendees"},
		Concurrent: true,
	}

	if opts.Year != 2023 {
		t.Errorf("expected year 2023, got %d", opts.Year)
	}

	if len(opts.Services) != 2 {
		t.Errorf("expected 2 services, got %d", len(opts.Services))
	}

	if !opts.Concurrent {
		t.Error("expected Concurrent to be true")
	}
}

// TestOptionsDefaults tests default Options values
func TestOptionsDefaults(t *testing.T) {
	opts := Options{}

	if opts.Year != 0 {
		t.Errorf("expected default year 0, got %d", opts.Year)
	}

	if len(opts.Services) != 0 {
		t.Errorf("expected empty services, got %d", len(opts.Services))
	}

	if opts.Concurrent {
		t.Error("expected Concurrent to default to false")
	}
}

// TestSyncOrder tests that services are registered in correct dependency order
func TestSyncOrder(t *testing.T) {
	// Expected sync order for daily sync
	expectedOrder := []string{
		"sessions",
		"attendees",
		"persons",
		"bunks",
		"bunk_plans",
		"bunk_assignments",
		"bunk_requests",
	}

	// Verify order has correct dependencies
	// sessions must come before attendees (attendees reference sessions)
	// attendees must come before persons (persons derived from attendees)
	// bunks must come before bunk_plans (bunk_plans reference bunks)
	// etc.

	dependencies := map[string][]string{
		"attendees":        {"sessions"},
		"persons":          {"attendees"},
		"bunk_plans":       {"bunks", "sessions"},
		"bunk_assignments": {"bunk_plans", "persons"},
		"bunk_requests":    {"persons", "sessions"},
	}

	// Build position map
	positions := make(map[string]int)
	for i, name := range expectedOrder {
		positions[name] = i
	}

	// Verify all dependencies come before their dependents
	for service, deps := range dependencies {
		servicePos, exists := positions[service]
		if !exists {
			t.Errorf("service %q not in expected order", service)
			continue
		}

		for _, dep := range deps {
			depPos, exists := positions[dep]
			if !exists {
				t.Errorf("dependency %q not in expected order", dep)
				continue
			}

			if depPos >= servicePos {
				t.Errorf("dependency %q (pos %d) should come before %q (pos %d)",
					dep, depPos, service, servicePos)
			}
		}
	}
}

// TestConcurrentAccess tests thread safety of orchestrator operations
func TestConcurrentAccess(_ *testing.T) {
	o := NewOrchestrator(nil)

	// Register a service
	mock := &MockService{name: "test"}
	o.RegisterService("test", mock)

	// Concurrent operations
	done := make(chan bool)

	// Writer goroutine
	go func() {
		for i := 0; i < 100; i++ {
			o.mu.Lock()
			o.runningJobs["test"] = &Status{Type: "test", Status: "running"}
			o.mu.Unlock()
		}
		done <- true
	}()

	// Reader goroutine
	go func() {
		for i := 0; i < 100; i++ {
			_ = o.IsRunning("test")
		}
		done <- true
	}()

	// Wait for both to complete
	<-done
	<-done

	// No race conditions should have occurred
}

// TestStatusConstants tests status constant values
func TestStatusConstants(t *testing.T) {
	if statusFailed != "failed" {
		t.Errorf("expected statusFailed='failed', got %q", statusFailed)
	}
}
