package sync

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"testing/synctest"
	"time"

	"github.com/pocketbase/pocketbase/core"
	pbtests "github.com/pocketbase/pocketbase/tests"
)

// MockService implements Service interface for testing
type MockService struct {
	name  string
	stats Stats
	// shouldFail makes Sync return an error. Which error is failWith, defaulting to
	// context.DeadlineExceeded when it is nil — tests that only care THAT it failed leave
	// failWith unset, tests that assert on the message set it to their own sentinel.
	shouldFail bool
	failWith   error
	delay      time.Duration
	callCount  atomic.Int32
}

// mockYearService is a Service that carries a Year field, mirroring the shape of the real
// per-type sync structs (FamilyCampDerivedSync, StaffSkillsSync, ...) that #1881 found being
// mutated in place on the orchestrator's registered singleton. Used to prove that
// RunSingleSyncWithService runs the caller's own instance and never touches the registry.
type mockYearService struct {
	name      string
	year      int
	delay     time.Duration
	shouldErr bool
	stats     Stats
	callCount atomic.Int32
}

func (m *mockYearService) Sync(ctx context.Context) error {
	m.callCount.Add(1)
	if m.delay > 0 {
		select {
		case <-time.After(m.delay):
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	if m.shouldErr {
		return context.DeadlineExceeded
	}
	return nil
}

func (m *mockYearService) Name() string    { return m.name }
func (m *mockYearService) GetStats() Stats { return m.stats }

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
		if m.failWith != nil {
			return m.failWith
		}
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
	t.Parallel()
	o := NewOrchestrator(nil)

	if o == nil {
		t.Fatal("NewOrchestrator returned nil")
		return
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
	t.Parallel()
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
	t.Parallel()
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
	t.Parallel()
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
	t.Parallel()
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
		Status:    statusCompleted,
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
		return
	}

	if status.Status != statusCompleted {
		t.Errorf("expected status 'completed', got %q", status.Status)
	}

	if status.Summary.Created != 10 {
		t.Errorf("expected 10 created, got %d", status.Summary.Created)
	}
}

// TestIsAnyJobRunning tests checking if any sync job is currently running
func TestIsAnyJobRunning(t *testing.T) {
	t.Parallel()
	t.Run("returns false when no jobs", func(t *testing.T) {
		o := NewOrchestrator(nil)
		if o.IsAnyJobRunning() {
			t.Error("expected false when runningJobs is empty")
		}
	})

	t.Run("returns true when job is running", func(t *testing.T) {
		o := NewOrchestrator(nil)
		o.mu.Lock()
		o.runningJobs["test_job"] = &Status{Status: statusRunning}
		o.mu.Unlock()
		if !o.IsAnyJobRunning() {
			t.Error("expected true when a job has statusRunning")
		}
	})

	t.Run("returns false when job is completed", func(t *testing.T) {
		o := NewOrchestrator(nil)
		o.mu.Lock()
		o.runningJobs["test_job"] = &Status{Status: statusCompleted}
		o.mu.Unlock()
		if o.IsAnyJobRunning() {
			t.Error("expected false when job is completed, not running")
		}
	})

	t.Run("returns true if any one of multiple jobs is running", func(t *testing.T) {
		o := NewOrchestrator(nil)
		o.mu.Lock()
		o.runningJobs["job1"] = &Status{Status: statusCompleted}
		o.runningJobs["job2"] = &Status{Status: statusRunning}
		o.runningJobs["job3"] = &Status{Status: statusFailed}
		o.mu.Unlock()
		if !o.IsAnyJobRunning() {
			t.Error("expected true when at least one job is running")
		}
	})

	t.Run("returns false when all jobs are completed or failed", func(t *testing.T) {
		o := NewOrchestrator(nil)
		o.mu.Lock()
		o.runningJobs["job1"] = &Status{Status: statusCompleted}
		o.runningJobs["job2"] = &Status{Status: statusFailed}
		o.runningJobs["job3"] = &Status{Status: statusCompleted}
		o.mu.Unlock()
		if o.IsAnyJobRunning() {
			t.Error("expected false when no job has statusRunning")
		}
	})
}

// TestGetRunningJobs tests getting list of running jobs
func TestGetRunningJobs(t *testing.T) {
	t.Parallel()
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
	o.runningJobs["bunks"] = &Status{Type: "bunks", Status: statusCompleted} // Not running
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
	t.Parallel()
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
	t.Parallel()
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

// TestSyncOrder tests that services are registered in correct dependency order
func TestSyncOrder(t *testing.T) {
	t.Parallel()
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
func TestConcurrentAccess(t *testing.T) {
	t.Parallel()

	o := NewOrchestrator(nil)

	// Register a service
	mock := &MockService{name: "test"}
	o.RegisterService("test", mock)

	// Concurrent operations
	done := make(chan bool)

	// Writer goroutine
	go func() {
		for range 100 {
			o.mu.Lock()
			o.runningJobs["test"] = &Status{Type: "test", Status: "running"}
			o.mu.Unlock()
		}
		done <- true
	}()

	// Reader goroutine
	go func() {
		for range 100 {
			_ = o.IsRunning("test")
		}
		done <- true
	}()

	// Wait for both to complete
	<-done
	<-done

	// No race conditions should have occurred
}

// TestIsWeeklySyncRunning tests weekly sync running check
func TestIsWeeklySyncRunning(t *testing.T) {
	t.Parallel()
	o := NewOrchestrator(nil)

	if o.IsWeeklySyncRunning() {
		t.Error("weekly sync should not be running initially")
	}

	o.mu.Lock()
	o.weeklySyncRunning = true
	o.mu.Unlock()

	if !o.IsWeeklySyncRunning() {
		t.Error("weekly sync should be running after flag set")
	}
}

// TestWeeklySyncServices tests that weekly sync includes expected global services
func TestWeeklySyncServices(t *testing.T) {
	t.Parallel()
	// Weekly sync should include global definition tables that rarely change
	// Divisions is included here since it's a global table (no year field)
	expectedServices := []string{
		"person_tag_defs",
		"custom_field_defs",
		"staff_lookups",     // Global: positions, org_categories, program_areas
		"financial_lookups", // Global: financial_categories, payment_methods
		"divisions",         // Global: division definitions (no year field)
	}

	jobs := GetWeeklySyncJobs()

	if len(jobs) != len(expectedServices) {
		t.Errorf("expected %d weekly sync jobs, got %d", len(expectedServices), len(jobs))
	}

	for _, expected := range expectedServices {
		found := false
		for _, job := range jobs {
			if job == expected {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("expected weekly sync to include %q", expected)
		}
	}
}

// TestWeeklySyncNotInDailySync verifies weekly services are NOT in daily sync
func TestWeeklySyncNotInDailySync(t *testing.T) {
	t.Parallel()
	// Daily sync jobs - these should NOT include weekly sync services
	// (person_tag_defs, custom_field_defs, staff_lookups, financial_lookups, divisions are weekly)
	dailyJobs := []string{
		"session_groups",
		"sessions",
		"attendees",
		"persons", // Combined sync: persons + households
		"bunks",
		"bunk_plans",
		"bunk_assignments",
		"staff",
		"financial_transactions",
		"family_camp_derived",
		"bunk_requests",
	}

	weeklyJobs := GetWeeklySyncJobs()

	// Verify no overlap
	for _, weekly := range weeklyJobs {
		for _, daily := range dailyJobs {
			if weekly == daily {
				t.Errorf("weekly job %q should not be in daily sync", weekly)
			}
		}
	}
}

// TestStatsWithSubStats tests Stats struct with SubStats for combined syncs
func TestStatsWithSubStats(t *testing.T) {
	t.Parallel()
	stats := Stats{
		Created:  10,
		Updated:  5,
		Skipped:  2,
		Errors:   1,
		Duration: 30,
		SubStats: map[string]Stats{
			"households": {
				Created: 3,
				Updated: 2,
				Skipped: 1,
				Errors:  0,
			},
			"person_tags": {
				Created: 15,
				Updated: 80,
				Skipped: 5,
				Errors:  0,
			},
		},
	}

	// Verify main stats
	if stats.Created != 10 {
		t.Errorf("expected Created=10, got %d", stats.Created)
	}

	// Verify SubStats exists and has correct values
	if stats.SubStats == nil {
		t.Fatal("expected SubStats to be non-nil")
		return
	}

	if len(stats.SubStats) != 2 {
		t.Errorf("expected 2 sub-stats entries, got %d", len(stats.SubStats))
	}

	// Verify households sub-stats
	householdStats, exists := stats.SubStats["households"]
	if !exists {
		t.Fatal("expected 'households' key in SubStats")
		return
	}
	if householdStats.Created != 3 {
		t.Errorf("expected households.Created=3, got %d", householdStats.Created)
	}
	if householdStats.Updated != 2 {
		t.Errorf("expected households.Updated=2, got %d", householdStats.Updated)
	}

	// Verify person_tags sub-stats
	personTagStats, exists := stats.SubStats["person_tags"]
	if !exists {
		t.Fatal("expected 'person_tags' key in SubStats")
		return
	}
	if personTagStats.Created != 15 {
		t.Errorf("expected person_tags.Created=15, got %d", personTagStats.Created)
	}
	if personTagStats.Updated != 80 {
		t.Errorf("expected person_tags.Updated=80, got %d", personTagStats.Updated)
	}
}

// TestStatsWithoutSubStats tests Stats struct backwards compatibility without SubStats
func TestStatsWithoutSubStats(t *testing.T) {
	t.Parallel()
	stats := Stats{
		Created:  10,
		Updated:  5,
		Skipped:  2,
		Errors:   1,
		Duration: 30,
	}

	// SubStats should be nil when not set
	if stats.SubStats != nil {
		t.Errorf("expected SubStats to be nil when not set, got %v", stats.SubStats)
	}

	// Verify main stats still work
	if stats.Created != 10 {
		t.Errorf("expected Created=10, got %d", stats.Created)
	}
}

// TestMarkSyncRunning tests the MarkSyncRunning method
func TestMarkSyncRunning(t *testing.T) {
	t.Parallel()
	o := NewOrchestrator(nil)

	// Register a mock service
	mock := &MockService{name: "test_service"}
	o.RegisterService("test", mock)

	// Test 1: MarkSyncRunning should fail for non-existent service
	err := o.MarkSyncRunning("nonexistent")
	if err == nil {
		t.Error("expected error for non-existent service")
	}

	// Test 2: MarkSyncRunning should succeed for registered service
	err = o.MarkSyncRunning("test")
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}

	// Test 3: Status should be "running" after MarkSyncRunning
	if !o.IsRunning("test") {
		t.Error("service should be running after MarkSyncRunning")
	}

	// Test 4: GetStatus should return running status
	status := o.GetStatus("test")
	if status == nil {
		t.Fatal("expected non-nil status")
		return
	}
	if status.Status != "running" {
		t.Errorf("expected status 'running', got %q", status.Status)
	}

	// Test 5: MarkSyncRunning should fail if already running
	err = o.MarkSyncRunning("test")
	if err == nil {
		t.Error("expected error when service already running")
	}
}

// TestMarkSyncRunningPreservesStatus tests that MarkSyncRunning sets correct status fields
func TestMarkSyncRunningPreservesStatus(t *testing.T) {
	t.Parallel()
	o := NewOrchestrator(nil)

	// Register a mock service
	mock := &MockService{name: "test_service"}
	o.RegisterService("test", mock)

	// A historical backfill holding the process-global year. MarkSyncRunning is reached only
	// from the process_requests handlers, which are operator actions against the current
	// season, so an unrelated sync's year must not reach this run (kindred#2297, finding 4).
	o.mu.Lock()
	o.currentSyncYear = 2024
	o.mu.Unlock()

	// Mark as running
	err := o.MarkSyncRunning("test")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Get status and verify fields
	o.mu.RLock()
	status := o.runningJobs["test"]
	o.mu.RUnlock()

	if status == nil {
		t.Fatal("expected status to be set")
		return
	}

	if status.Type != "test" {
		t.Errorf("expected Type='test', got %q", status.Type)
	}

	if status.Status != "running" {
		t.Errorf("expected Status='running', got %q", status.Status)
	}

	if status.Year != 0 {
		t.Errorf("expected Year=0 (the current season), got %d — the run adopted a "+
			"concurrent backfill's year", status.Year)
	}

	if status.StartTime.IsZero() {
		t.Error("expected StartTime to be set")
	}
}

// TestRunSingleSyncRespectsPreMarkedStatus tests that RunSingleSync uses existing status
// if MarkSyncRunning was called first
func TestRunSingleSyncRespectsPreMarkedStatus(t *testing.T) {
	t.Parallel()
	synctest.Test(t, func(t *testing.T) {
		o := NewOrchestrator(nil)

		// Register a fast mock service
		mock := &MockService{name: "test_service", delay: 10 * time.Millisecond}
		o.RegisterService("test", mock)

		// Pre-mark as running (simulating what API handler will do)
		err := o.MarkSyncRunning("test")
		if err != nil {
			t.Fatalf("MarkSyncRunning failed: %v", err)
		}

		// Get the start time from pre-marked status
		o.mu.RLock()
		preMarkedStatus := o.runningJobs["test"]
		preMarkedStartTime := preMarkedStatus.StartTime
		o.mu.RUnlock()

		// RunSingleSync should use the existing status, not create a new one
		ctx := context.Background()
		err = o.RunSingleSync(ctx, "test")
		if err != nil {
			t.Fatalf("RunSingleSync failed: %v", err)
		}

		// Wait for the sync goroutine to complete (virtual time advances past the mock's 10ms delay).
		time.Sleep(50 * time.Millisecond)

		// Check that the service was actually called
		if mock.GetCallCount() != 1 {
			t.Errorf("expected 1 call to Sync, got %d", mock.GetCallCount())
		}

		// The status should have been moved to lastCompletedStatus on success
		o.mu.RLock()
		completedStatus := o.lastCompletedStatus["test"]
		o.mu.RUnlock()

		if completedStatus == nil {
			t.Fatal("expected completed status, got nil")
		}
		// Start time should be preserved from pre-marked status
		if !completedStatus.StartTime.Equal(preMarkedStartTime) {
			t.Errorf("expected StartTime to be preserved from MarkSyncRunning, got different time")
		}
	})
}

// TestHistoricalSyncIncludesCustomValueServices verifies custom value services are
// re-registered with year-specific client during historical syncs
func TestHistoricalSyncIncludesCustomValueServices(t *testing.T) {
	t.Parallel()
	// This test verifies the historical sync services list includes custom value services
	// The actual services list in RunSyncWithOptions should include:
	// - person_custom_values
	// - household_custom_values
	// Note: divisions is NOT included - it's a global table (no year field)

	// Get the list of services that SHOULD be re-registered for historical syncs
	// These are the services registered in RunSyncWithOptions when opts.Year > 0
	expectedHistoricalServices := []string{
		"session_groups",
		"sessions",
		// Note: divisions removed - it's global (no year field)
		"attendees",
		"persons",
		"bunks",
		"bunk_plans",
		"bunk_assignments",
		"bunk_requests",
		"process_requests",
		"staff",
		"financial_transactions",
		"family_camp_derived", // Derived table (depends on custom values)
		// Custom value services - must be included for historical sync support
		"person_custom_values",
		"household_custom_values",
	}

	// GetCustomValuesSyncJobs should return the custom values services
	customJobs := GetCustomValuesSyncJobs()

	// Verify custom value services are in the expected historical services list
	for _, customJob := range customJobs {
		found := false
		for _, expected := range expectedHistoricalServices {
			if expected == customJob {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("custom value service %q should be in historical sync services list", customJob)
		}
	}
}

// TestCustomValuesSyncServicesCount verifies the count of custom value services
func TestCustomValuesSyncServicesCount(t *testing.T) {
	t.Parallel()
	jobs := GetCustomValuesSyncJobs()

	if len(jobs) != 2 {
		t.Errorf("expected 2 custom values sync jobs, got %d", len(jobs))
	}

	expected := map[string]bool{
		"person_custom_values":    true,
		"household_custom_values": true,
	}

	for _, job := range jobs {
		if !expected[job] {
			t.Errorf("unexpected custom values job: %s", job)
		}
	}
}

// TestWeeklySyncIncludesDivisions verifies divisions is in weekly sync (global table)
func TestWeeklySyncIncludesDivisions(t *testing.T) {
	t.Parallel()
	jobs := GetWeeklySyncJobs()

	found := false
	for _, job := range jobs {
		if job == serviceNameDivisions {
			found = true
			break
		}
	}

	if !found {
		t.Errorf("expected weekly sync to include %q (global table)", serviceNameDivisions)
	}
}

// TestGetDailySyncJobsStrandedAssignmentCleanupOrdering asserts the daily sync
// runs stranded_assignment_cleanup last and strictly after bunk_plans. The
// cleanup's gating logic depends on bunk_plans being final before it sweeps
// stranded drafts, so a regression that drops it or moves it earlier must fail
// this test.
func TestGetDailySyncJobsStrandedAssignmentCleanupOrdering(t *testing.T) {
	t.Parallel()
	jobs := getDailySyncJobs()

	pos := make(map[string]int, len(jobs))
	for i, j := range jobs {
		pos[j] = i
	}

	cleanupPos, ok := pos["stranded_assignment_cleanup"]
	if !ok {
		t.Fatalf("stranded_assignment_cleanup missing from daily sync jobs: %v", jobs)
	}
	if cleanupPos != len(jobs)-1 {
		t.Errorf("stranded_assignment_cleanup must run last — got position %d of %d: %v", cleanupPos, len(jobs), jobs)
	}

	bunkPlansPos, ok := pos["bunk_plans"]
	if !ok {
		t.Fatalf("bunk_plans missing from daily sync jobs: %v", jobs)
	}
	if cleanupPos <= bunkPlansPos {
		t.Errorf("stranded_assignment_cleanup (pos %d) must run after bunk_plans (pos %d)", cleanupPos, bunkPlansPos)
	}
}

// TestCamperHistoryServiceFullyRemoved pins the removal of the camper_history table and its
// writer (see #2369): the orchestrator must not schedule, register, or advertise a
// "camper_history" job through any path a caller could reach it by. A regression here means
// either the collection got resurrected in the daily/unified job lists with nothing left to
// write to it, or the old registration silently survived after the table was already gone.
func TestCamperHistoryServiceFullyRemoved(t *testing.T) {
	t.Parallel()

	const removedID = "camper_history"

	for _, job := range getDailySyncJobs() {
		if job == removedID {
			t.Error("getDailySyncJobs still includes camper_history")
		}
	}

	for _, includeCV := range []bool{true, false} {
		for _, job := range GetDefaultUnifiedSyncJobs(includeCV) {
			if job == removedID {
				t.Errorf("GetDefaultUnifiedSyncJobs(%v) still includes camper_history", includeCV)
			}
		}
	}

	for _, job := range GetJobMeta() {
		if job.ID == removedID {
			t.Error("syncJobMeta still lists camper_history")
		}
	}

	// The registration half needs a source-level guard, not a live orchestrator: both
	// registration paths (InitializeSyncServices, RunSyncWithOptions) need a real
	// core.App and a CampMinder client to run, and NewOrchestrator registers nothing at
	// all -- so `GetService("camper_history") != nil` on a fresh orchestrator can never
	// fire and would pass unchanged if either path re-registered the job. Walking
	// orchestrator.go is the same technique TestYearTakingHandlersPassTheirYear uses on
	// api.go for the identical reason.
	body, err := os.ReadFile("orchestrator.go")
	if err != nil {
		t.Fatalf("read orchestrator.go: %v", err)
	}
	if strings.Contains(string(body), removedID) {
		t.Errorf("orchestrator.go still mentions %q -- a registration or job-list entry "+
			"came back for a collection that no longer exists", removedID)
	}
	if strings.Contains(string(body), "CamperHistorySync") {
		t.Error("orchestrator.go still references CamperHistorySync")
	}
}

// TestDailySyncExcludesDivisions verifies divisions is NOT in daily sync
func TestDailySyncExcludesDivisions(t *testing.T) {
	t.Parallel()
	// Daily sync jobs that would be in orderedJobs (excluding divisions)
	// Note: This tests the expected behavior - divisions should NOT be here
	dailyJobs := []string{
		"session_groups",
		"sessions",
		"attendees",
		"persons",
		"bunks",
		"bunk_plans",
		"bunk_assignments",
		"staff",
		"financial_transactions",
		"family_camp_derived", // Derived table - after dependencies
		"bunk_requests",
	}

	for _, job := range dailyJobs {
		if job == serviceNameDivisions {
			t.Errorf("daily sync should NOT include %q (moved to weekly)", serviceNameDivisions)
		}
	}
}

// TestDailySyncIncludesFamilyCampDerived verifies family_camp_derived is in daily sync
func TestDailySyncIncludesFamilyCampDerived(t *testing.T) {
	t.Parallel()
	// This test verifies family_camp_derived is part of expected daily sync jobs
	expectedDailyJobs := []string{
		"session_groups",
		"sessions",
		"attendees",
		"persons",
		"bunks",
		"bunk_plans",
		"bunk_assignments",
		"staff",
		"financial_transactions",
		"family_camp_derived", // Should be included!
		"bunk_requests",
	}

	found := false
	for _, job := range expectedDailyJobs {
		if job == serviceNameFamilyCampDerived {
			found = true
			break
		}
	}

	if !found {
		t.Errorf("expected daily sync to include %q", serviceNameFamilyCampDerived)
	}
}

// TestHistoricalSyncIncludesFamilyCampDerived verifies family_camp_derived is in historical syncs
func TestHistoricalSyncIncludesFamilyCampDerived(t *testing.T) {
	t.Parallel()
	// Get the list of services that SHOULD be re-registered for historical syncs
	// These are the services registered in RunSyncWithOptions when opts.Year > 0
	expectedHistoricalServices := []string{
		"session_groups",
		"sessions",
		"attendees",
		"persons",
		"bunks",
		"bunk_plans",
		"bunk_assignments",
		"bunk_requests",
		"process_requests",
		"staff",
		"financial_transactions",
		"family_camp_derived", // Should be included!
		"person_custom_values",
		"household_custom_values",
	}

	found := false
	for _, svc := range expectedHistoricalServices {
		if svc == "family_camp_derived" {
			found = true
			break
		}
	}

	if !found {
		t.Error("expected historical sync services to include 'family_camp_derived'")
	}
}

// TestHistoricalSyncExcludesDivisions verifies divisions is NOT in historical sync
// (divisions is global - not year-specific)
func TestHistoricalSyncExcludesDivisions(t *testing.T) {
	t.Parallel()
	// The list of services re-registered for historical syncs should NOT include divisions
	// since divisions is a global table (no year field)
	historicalServices := []string{
		"session_groups",
		"sessions",
		"attendees",
		"persons",
		"bunks",
		"bunk_plans",
		"bunk_assignments",
		"bunk_requests",
		"process_requests",
		"staff",
		"financial_transactions",
		"family_camp_derived",
		"person_custom_values",
		"household_custom_values",
	}

	for _, svc := range historicalServices {
		if svc == "divisions" {
			t.Error("historical sync should NOT include 'divisions' (global table)")
		}
	}
}

// TestWeeklySyncJobsCount verifies the expected count of weekly sync jobs
func TestWeeklySyncJobsCount(t *testing.T) {
	t.Parallel()
	jobs := GetWeeklySyncJobs()

	// Weekly sync should have: person_tag_defs, custom_field_defs, staff_lookups,
	// financial_lookups, and divisions (moved from daily)
	expectedCount := 5
	if len(jobs) != expectedCount {
		t.Errorf("expected %d weekly sync jobs, got %d: %v", expectedCount, len(jobs), jobs)
	}
}

// TestRunSingleSyncContextDeadlineHandling verifies RunSingleSync respects parent context
// deadlines appropriately, fixing the "rate limiter wait: context deadline exceeded" issue.
func TestRunSingleSyncContextDeadlineHandling(t *testing.T) {
	t.Parallel()
	t.Run("uses parent context when deadline is generous", func(t *testing.T) {
		synctest.Test(t, func(t *testing.T) {
			o := NewOrchestrator(nil)

			// Track what context the service receives
			var receivedCtx context.Context
			var ctxMu sync.Mutex

			mock := &contextCaptureMockService{
				MockService: &MockService{name: "test", delay: 50 * time.Millisecond},
				onSync: func(ctx context.Context) {
					ctxMu.Lock()
					receivedCtx = ctx
					ctxMu.Unlock()
				},
			}
			o.RegisterService("test", mock)

			// Create a parent context with 2-hour deadline (generous)
			parentCtx, cancel := context.WithTimeout(context.Background(), 2*time.Hour)
			defer cancel()

			err := o.RunSingleSync(parentCtx, "test")
			if err != nil {
				t.Fatalf("RunSingleSync failed: %v", err)
			}

			// Wait for the sync goroutine to complete (virtual time advances past the mock's 50ms delay).
			time.Sleep(100 * time.Millisecond)

			ctxMu.Lock()
			ctx := receivedCtx
			ctxMu.Unlock()

			if ctx == nil {
				t.Fatal("service was never called with a context")
				return
			}

			// When parent has generous deadline (>=30min), the sync context should
			// have a deadline that's at least 30 minutes out (not just whatever is left
			// on the parent context)
			deadline, hasDeadline := ctx.Deadline()
			if !hasDeadline {
				t.Error("expected sync context to have a deadline")
			} else {
				timeUntilDeadline := time.Until(deadline)
				// Should have at least 30 minutes remaining (allowing some margin for test execution)
				if timeUntilDeadline < 29*time.Minute {
					t.Errorf("sync context deadline too short: %v remaining", timeUntilDeadline)
				}
			}
		})
	})

	t.Run("extends short parent deadline", func(t *testing.T) {
		synctest.Test(t, func(t *testing.T) {
			o := NewOrchestrator(nil)

			var receivedCtx context.Context
			var ctxMu sync.Mutex

			mock := &contextCaptureMockService{
				MockService: &MockService{name: "test", delay: 50 * time.Millisecond},
				onSync: func(ctx context.Context) {
					ctxMu.Lock()
					receivedCtx = ctx
					ctxMu.Unlock()
				},
			}
			o.RegisterService("test", mock)

			// Create a parent context with very short deadline (1 minute - too short for sync)
			parentCtx, cancel := context.WithTimeout(context.Background(), 1*time.Minute)
			defer cancel()

			err := o.RunSingleSync(parentCtx, "test")
			if err != nil {
				t.Fatalf("RunSingleSync failed: %v", err)
			}

			// Wait for the sync goroutine to complete (virtual time advances past the mock's 50ms delay).
			time.Sleep(100 * time.Millisecond)

			ctxMu.Lock()
			ctx := receivedCtx
			ctxMu.Unlock()

			if ctx == nil {
				t.Fatal("service was never called with a context")
				return
			}

			// When parent has short deadline (<30min), the sync should create
			// its own generous timeout
			deadline, hasDeadline := ctx.Deadline()
			if !hasDeadline {
				t.Error("expected sync context to have a deadline")
			} else {
				timeUntilDeadline := time.Until(deadline)
				// Should have at least 30 minutes (the default generous timeout)
				if timeUntilDeadline < 29*time.Minute {
					t.Errorf("sync context should extend short parent deadline: got %v remaining", timeUntilDeadline)
				}
			}
		})
	})

	t.Run("creates deadline when parent has none", func(t *testing.T) {
		synctest.Test(t, func(t *testing.T) {
			o := NewOrchestrator(nil)

			var receivedCtx context.Context
			var ctxMu sync.Mutex

			mock := &contextCaptureMockService{
				MockService: &MockService{name: "test", delay: 50 * time.Millisecond},
				onSync: func(ctx context.Context) {
					ctxMu.Lock()
					receivedCtx = ctx
					ctxMu.Unlock()
				},
			}
			o.RegisterService("test", mock)

			// Parent context with no deadline
			parentCtx := context.Background()

			err := o.RunSingleSync(parentCtx, "test")
			if err != nil {
				t.Fatalf("RunSingleSync failed: %v", err)
			}

			// Wait for the sync goroutine to complete (virtual time advances past the mock's 50ms delay).
			time.Sleep(100 * time.Millisecond)

			ctxMu.Lock()
			ctx := receivedCtx
			ctxMu.Unlock()

			if ctx == nil {
				t.Fatal("service was never called with a context")
				return
			}

			// When parent has no deadline, sync should create a generous timeout
			deadline, hasDeadline := ctx.Deadline()
			if !hasDeadline {
				t.Error("expected sync context to have a deadline even when parent doesn't")
			} else {
				timeUntilDeadline := time.Until(deadline)
				// Should have at least 1 hour (the extended timeout for no-deadline parents)
				if timeUntilDeadline < 59*time.Minute {
					t.Errorf("sync context deadline too short for no-deadline parent: %v remaining", timeUntilDeadline)
				}
			}
		})
	})
}

// contextCaptureMockService wraps MockService to capture the context passed to Sync
type contextCaptureMockService struct {
	*MockService
	onSync func(ctx context.Context)
}

func (c *contextCaptureMockService) Sync(ctx context.Context) error {
	if c.onSync != nil {
		c.onSync(ctx)
	}
	return c.MockService.Sync(ctx)
}

// TestRunSyncWithOptionsChecksGlobalTables verifies that RunSyncWithOptions
// checks if global tables are empty and runs weekly sync first if needed.
// This ensures fresh DB setups triggered via API (not just RunDailySync)
// get required global definitions before any year-specific syncs.
func TestRunSyncWithOptionsChecksGlobalTables(t *testing.T) {
	t.Parallel()
	t.Run("documents that global check should run for API-triggered syncs", func(t *testing.T) {
		// This test verifies the expected behavior: RunSyncWithOptions should
		// call checkGlobalTablesEmpty() at the start, just like RunDailySync does.
		//
		// The check is located in RunDailySync at lines 349-354:
		//   if o.checkGlobalTablesEmpty() {
		//       slog.Info("Global tables empty - running weekly sync first")
		//       if err := o.RunWeeklySync(ctx); err != nil {
		//           slog.Error("Weekly sync failed, continuing with daily", "error", err)
		//       }
		//   }
		//
		// RunSyncWithOptions should have the same check to ensure consistent
		// behavior regardless of how the sync was triggered.

		// Verify checkGlobalTablesEmpty method exists and uses person_tag_defs
		// (testing the method signature/behavior is covered by this being a valid call)
		o := NewOrchestrator(nil)
		// Note: With nil app, checkGlobalTablesEmpty will panic or return true
		// This is expected - we're just documenting the expected behavior

		// The actual integration test would require a real PocketBase app
		// to verify: empty person_tag_defs -> weekly sync runs first
		_ = o
	})
}

// TestGetStatusWeeklySyncPending tests that queued weekly sync jobs show pending status
func TestGetStatusWeeklySyncPending(t *testing.T) {
	t.Parallel()
	o := NewOrchestrator(nil)

	// Set up weekly sync as running with jobs queued
	o.mu.Lock()
	o.weeklySyncRunning = true
	o.weeklySyncQueue = []string{"person_tag_defs", "custom_field_defs", "staff_lookups"}
	o.mu.Unlock()

	// Queued jobs should show as pending
	status := o.GetStatus("custom_field_defs")
	if status == nil {
		t.Fatal("expected non-nil status for queued weekly sync job")
		return
	}
	if status.Status != statusPending {
		t.Errorf("expected status 'pending', got %q", status.Status)
	}
	if status.Year != 0 {
		t.Errorf("expected year 0 (global sync), got %d", status.Year)
	}

	// Non-queued job should still return nil
	status = o.GetStatus("sessions")
	if status != nil {
		t.Error("expected nil status for non-queued job")
	}
}

// TestGetStatusWeeklySyncCompleted tests that completed weekly sync jobs show completed status
func TestGetStatusWeeklySyncCompleted(t *testing.T) {
	t.Parallel()
	o := NewOrchestrator(nil)

	// Set up weekly sync as running with jobs queued
	now := time.Now()
	o.mu.Lock()
	o.weeklySyncRunning = true
	o.weeklySyncQueue = []string{"person_tag_defs", "custom_field_defs", "staff_lookups"}
	// Mark one as completed
	o.lastCompletedStatus["person_tag_defs"] = &Status{
		Type:    "person_tag_defs",
		Status:  statusCompleted,
		EndTime: &now,
		Year:    0,
	}
	o.mu.Unlock()

	// Completed job should show completed, not pending
	status := o.GetStatus("person_tag_defs")
	if status == nil {
		t.Fatal("expected non-nil status for completed weekly sync job")
		return
	}
	if status.Status != statusCompleted {
		t.Errorf("expected status 'completed', got %q", status.Status)
	}

	// Other queued job should still show pending
	status = o.GetStatus("custom_field_defs")
	if status == nil {
		t.Fatal("expected non-nil status for queued weekly sync job")
		return
	}
	if status.Status != statusPending {
		t.Errorf("expected status 'pending', got %q", status.Status)
	}
}

// TestGetStatusCustomValuesSyncPending tests that queued custom values sync jobs show pending status
func TestGetStatusCustomValuesSyncPending(t *testing.T) {
	t.Parallel()
	o := NewOrchestrator(nil)

	// Set up custom values sync as running with jobs queued
	o.mu.Lock()
	o.customValuesSyncRunning = true
	o.customValuesSyncQueue = []string{"person_custom_values", "household_custom_values"}
	o.currentSyncYear = 2025
	o.mu.Unlock()

	// Queued jobs should show as pending
	status := o.GetStatus("household_custom_values")
	if status == nil {
		t.Fatal("expected non-nil status for queued custom values sync job")
		return
	}
	if status.Status != statusPending {
		t.Errorf("expected status 'pending', got %q", status.Status)
	}
	if status.Year != 2025 {
		t.Errorf("expected year 2025, got %d", status.Year)
	}

	// Non-queued job should still return nil
	status = o.GetStatus("sessions")
	if status != nil {
		t.Error("expected nil status for non-queued job")
	}
}

// TestGetStatusCustomValuesSyncCompleted tests that completed custom values sync jobs show completed status
func TestGetStatusCustomValuesSyncCompleted(t *testing.T) {
	t.Parallel()
	o := NewOrchestrator(nil)

	// Set up custom values sync as running with jobs queued
	now := time.Now()
	o.mu.Lock()
	o.customValuesSyncRunning = true
	o.customValuesSyncQueue = []string{"person_custom_values", "household_custom_values"}
	o.currentSyncYear = 2025
	// Mark one as completed
	o.lastCompletedStatus["person_custom_values"] = &Status{
		Type:    "person_custom_values",
		Status:  statusCompleted,
		EndTime: &now,
		Year:    2025,
	}
	o.mu.Unlock()

	// Completed job should show completed, not pending
	status := o.GetStatus("person_custom_values")
	if status == nil {
		t.Fatal("expected non-nil status for completed custom values sync job")
		return
	}
	if status.Status != statusCompleted {
		t.Errorf("expected status 'completed', got %q", status.Status)
	}

	// Other queued job should still show pending
	status = o.GetStatus("household_custom_values")
	if status == nil {
		t.Fatal("expected non-nil status for queued custom values sync job")
		return
	}
	if status.Status != statusPending {
		t.Errorf("expected status 'pending', got %q", status.Status)
	}
}

// TestGlobalTablesCheckBehavior documents the expected behavior of checkGlobalTablesEmpty
func TestGlobalTablesCheckBehavior(t *testing.T) {
	t.Parallel()
	// The checkGlobalTablesEmpty method:
	// 1. Queries person_tag_defs table with limit 1
	// 2. Returns true if no records found (global tables empty)
	// 3. Returns false if records exist (globals already populated)
	//
	// This is used to ensure weekly sync (which populates global definitions)
	// runs before daily/historical syncs that depend on those definitions.

	expectedGlobalTables := []string{
		"person_tag_defs",   // Quick check table (used by checkGlobalTablesEmpty)
		"custom_field_defs", // Also populated by weekly sync
		"staff_lookups",     // Also populated by weekly sync
		"financial_lookups", // Also populated by weekly sync
		"divisions",         // Also populated by weekly sync
	}

	weeklyJobs := GetWeeklySyncJobs()

	// Verify all expected global tables are in weekly sync
	for _, table := range expectedGlobalTables {
		found := false
		for _, job := range weeklyJobs {
			if job == table {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("expected global table %q to be in weekly sync jobs", table)
		}
	}
}

// =============================================================================
// Sync Queue Tests
// =============================================================================

// TestEnqueueUnifiedSync tests basic enqueueing functionality
func TestEnqueueUnifiedSync(t *testing.T) {
	t.Parallel()
	o := NewOrchestrator(nil)

	// Enqueue first item
	qs, err := o.EnqueueUnifiedSync(2025, "all", false, false, false, "user1@example.com")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if qs == nil {
		t.Fatal("expected non-nil QueuedSync")
		return
	}
	if qs.Year != 2025 {
		t.Errorf("expected Year=2025, got %d", qs.Year)
	}
	if qs.Service != "all" {
		t.Errorf("expected Service='all', got %q", qs.Service)
	}
	if qs.ID == "" {
		t.Error("expected non-empty ID")
	}

	// Verify it's in the queue
	queue := o.GetQueuedSyncs()
	if len(queue) != 1 {
		t.Errorf("expected 1 item in queue, got %d", len(queue))
	}
}

// TestEnqueueUnifiedSyncPosition tests queue position assignment
func TestEnqueueUnifiedSyncPosition(t *testing.T) {
	t.Parallel()
	o := NewOrchestrator(nil)

	// Enqueue multiple items
	qs1, _ := o.EnqueueUnifiedSync(2025, "all", false, false, false, "user1")
	qs2, _ := o.EnqueueUnifiedSync(2024, "all", false, false, false, "user2")
	qs3, _ := o.EnqueueUnifiedSync(2023, "all", false, false, false, "user3")

	queue := o.GetQueuedSyncs()
	if len(queue) != 3 {
		t.Fatalf("expected 3 items in queue, got %d", len(queue))
	}

	// Verify FIFO order (first enqueued should be first in list)
	if queue[0].ID != qs1.ID {
		t.Errorf("expected first item ID=%s, got %s", qs1.ID, queue[0].ID)
	}
	if queue[1].ID != qs2.ID {
		t.Errorf("expected second item ID=%s, got %s", qs2.ID, queue[1].ID)
	}
	if queue[2].ID != qs3.ID {
		t.Errorf("expected third item ID=%s, got %s", qs3.ID, queue[2].ID)
	}
}

// TestEnqueueUnifiedSyncDuplicateDetection tests that duplicate requests return existing queue item
func TestEnqueueUnifiedSyncDuplicateDetection(t *testing.T) {
	t.Parallel()
	o := NewOrchestrator(nil)

	// Enqueue first item (without custom values)
	qs1, err := o.EnqueueUnifiedSync(2025, "all", false, false, false, "user1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Try to enqueue duplicate (same year + service + includeCustomValues)
	qs2, err := o.EnqueueUnifiedSync(2025, "all", false, true, false, "user2") // Same includeCustomValues, different debug
	if err != nil {
		t.Fatalf("unexpected error for duplicate: %v", err)
	}

	// Should return the existing item, not create a new one
	if qs2.ID != qs1.ID {
		t.Errorf("expected duplicate to return existing ID=%s, got %s", qs1.ID, qs2.ID)
	}

	// Queue should still have only 1 item
	queue := o.GetQueuedSyncs()
	if len(queue) != 1 {
		t.Errorf("expected 1 item in queue after duplicate, got %d", len(queue))
	}

	// Now enqueue with different includeCustomValues - should create new item
	qs3, err := o.EnqueueUnifiedSync(2025, "all", true, false, false, "user3") // Different includeCustomValues
	if err != nil {
		t.Fatalf("unexpected error for different includeCustomValues: %v", err)
	}

	// Should create a new item
	if qs3.ID == qs1.ID {
		t.Error("expected different includeCustomValues to create new item, got same ID")
	}

	// Queue should now have 2 items
	queue = o.GetQueuedSyncs()
	if len(queue) != 2 {
		t.Errorf("expected 2 items in queue after different includeCustomValues, got %d", len(queue))
	}
}

// =============================================================================
// dry_run propagation (kindred#2334)
//
// handleUnifiedSync parsed year/service/includeCustomValues/debug but never dry_run: the
// parameter was accepted, echoed nowhere, and discarded, so ?dry_run=true against the unified
// endpoint performed a real write. The queued path (EnqueueUnifiedSync + the QueuedSync it
// stores) is a second, independently-broken carrier for the same flag — a test that only
// exercises the immediate path is not evidence the queued path works, so the two are covered
// by separate tests below rather than one shared one.
// =============================================================================

// TestEnqueueUnifiedSyncCarriesDryRun pins that DryRun survives onto the QueuedSync record
// EnqueueUnifiedSync returns and stores — the field a queued run reads back later.
func TestEnqueueUnifiedSyncCarriesDryRun(t *testing.T) {
	t.Parallel()
	o := NewOrchestrator(nil)

	wet, err := o.EnqueueUnifiedSync(2025, "all", false, false, false, "user1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if wet.DryRun {
		t.Error("expected DryRun=false to be stored for a wet request")
	}

	dry, err := o.EnqueueUnifiedSync(2024, "all", false, false, true, "user2")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !dry.DryRun {
		t.Error("expected DryRun=true to be stored for a dry_run=true request")
	}

	// Stored queue state (not just the returned pointer) must also carry it -- GetQueuedSyncs
	// backs the /status response's queue listing an operator actually reads.
	found := false
	for _, qs := range o.GetQueuedSyncs() {
		if qs.ID == dry.ID {
			found = true
			if !qs.DryRun {
				t.Error("GetQueuedSyncs lost DryRun=true for the queued item")
			}
		}
	}
	if !found {
		t.Fatal("queued dry-run item not found via GetQueuedSyncs")
	}
}

// TestEnqueueUnifiedSyncDedupRespectsDryRun is the queue-collision trap: without DryRun in the
// duplicate match, a dry_run=true request for the same year+service+includeCustomValues as an
// already-queued wet request would silently merge into that wet item and inherit its
// DryRun=false -- the operator asked for a dry run, got back a queue position, and the queued
// run would still write for real.
func TestEnqueueUnifiedSyncDedupRespectsDryRun(t *testing.T) {
	t.Parallel()
	o := NewOrchestrator(nil)

	wet, err := o.EnqueueUnifiedSync(2025, "all", false, false, false, "user1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	dry, err := o.EnqueueUnifiedSync(2025, "all", false, false, true, "user2")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if dry.ID == wet.ID {
		t.Fatal("dry_run=true request merged into an already-queued wet request -- it would run wet")
	}
	if !dry.DryRun {
		t.Error("expected the new queued item to carry DryRun=true")
	}
	if o.GetQueueLength() != 2 {
		t.Errorf("expected 2 distinct queue items (wet + dry), got %d", o.GetQueueLength())
	}

	// A second dry_run=true request for the same parameters must still dedup against the
	// first dry one, not create a third item.
	dry2, err := o.EnqueueUnifiedSync(2025, "all", false, false, true, "user3")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if dry2.ID != dry.ID {
		t.Error("expected a second identical dry_run=true request to dedup against the first")
	}
	if o.GetQueueLength() != 2 {
		t.Errorf("expected queue length to stay 2 after a duplicate dry request, got %d", o.GetQueueLength())
	}
}

// dryRunAwareService is a Service + DryRunnable double that records, for every Sync() call,
// whether DryRun was set at that moment -- and only counts a "write" when it was not. This is
// the sharpest available proxy for the acceptance criterion "writes nothing": a boolean flag
// being set is not itself evidence anything downstream honored it.
type dryRunAwareService struct {
	name string

	mu               sync.Mutex
	dryRun           bool
	dryRunAtSyncTime []bool
	wroteCount       int
}

func (s *dryRunAwareService) SetDryRun(dryRun bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.dryRun = dryRun
}

func (s *dryRunAwareService) Sync(_ context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.dryRunAtSyncTime = append(s.dryRunAtSyncTime, s.dryRun)
	if !s.dryRun {
		s.wroteCount++
	}
	return nil
}

func (s *dryRunAwareService) Name() string    { return s.name }
func (s *dryRunAwareService) GetStats() Stats { return Stats{} }

func (s *dryRunAwareService) snapshot() (calls []bool, wrote int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]bool(nil), s.dryRunAtSyncTime...), s.wroteCount
}

// notDryRunnableService is a plain Service with no DryRunnable support, standing in for the
// real services (session_groups, stranded_assignment_cleanup, ...) that cannot honor dry_run.
type notDryRunnableService struct {
	name      string
	callCount atomic.Int32
}

func (s *notDryRunnableService) Sync(_ context.Context) error {
	s.callCount.Add(1)
	return nil
}
func (s *notDryRunnableService) Name() string    { return s.name }
func (s *notDryRunnableService) GetStats() Stats { return Stats{} }

// newDryRunTestApp returns a test app with one person_tag_defs row already present, so
// RunSyncWithOptions's checkGlobalTablesEmpty() takes the "globals already ran" branch instead
// of kicking off a full weekly-sync bootstrap that these tests have no interest in.
func newDryRunTestApp(t *testing.T) *pbtests.TestApp {
	t.Helper()
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)

	col := core.NewBaseCollection("person_tag_defs")
	if err := app.Save(col); err != nil {
		t.Fatalf("save person_tag_defs collection: %v", err)
	}
	if err := app.Save(core.NewRecord(col)); err != nil {
		t.Fatalf("seed person_tag_defs record: %v", err)
	}
	return app
}

// TestRunSyncWithOptionsHonorsDryRun is the immediate-path mechanism test: DryRun=true must
// reach the service via SetDryRun before Sync runs, and Sync must not "write". DryRun=false is
// exercised as a control in the same test so a no-op SetDryRun implementation can't pass by
// always leaving wroteCount at zero.
func TestRunSyncWithOptionsHonorsDryRun(t *testing.T) {
	t.Parallel()
	app := newDryRunTestApp(t)
	o := NewOrchestrator(app)

	dry := &dryRunAwareService{name: "family_camp_derived"}
	o.RegisterService("family_camp_derived", dry)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := o.RunSyncWithOptions(ctx, Options{
		Year:     0, // current-year mode: skips the nil-baseClient year-override branch
		Services: []string{"family_camp_derived"},
		DryRun:   true,
	}); err != nil {
		t.Fatalf("RunSyncWithOptions (dry): %v", err)
	}

	calls, wrote := dry.snapshot()
	if len(calls) != 1 {
		t.Fatalf("expected Sync to run exactly once, ran %d times", len(calls))
	}
	if !calls[0] {
		t.Error("Sync ran with DryRun=false even though the request asked for dry_run=true")
	}
	if wrote != 0 {
		t.Errorf("expected 0 writes for a dry run, got %d", wrote)
	}

	// Control: a wet request against the same service must actually write, proving the
	// dry-run branch above is measuring something real.
	if err := o.RunSyncWithOptions(ctx, Options{
		Year:     0,
		Services: []string{"family_camp_derived"},
		DryRun:   false,
	}); err != nil {
		t.Fatalf("RunSyncWithOptions (wet): %v", err)
	}
	calls, wrote = dry.snapshot()
	if len(calls) != 2 || calls[1] {
		t.Fatalf("expected the second, wet run to run with DryRun=false; calls=%v", calls)
	}
	if wrote != 1 {
		t.Errorf("expected the wet control run to write once, got %d", wrote)
	}
}

// TestRunSyncWithOptionsRejectsUnsupportedDryRun is the defense-in-depth backstop: even if a
// caller other than handleUnifiedSync's pre-flight check ever invokes RunSyncWithOptions with
// DryRun=true against a service that cannot honor it, the run must refuse outright rather than
// silently execute Sync() wet (kindred#2334's "either honor it or reject the request").
func TestRunSyncWithOptionsRejectsUnsupportedDryRun(t *testing.T) {
	t.Parallel()
	app := newDryRunTestApp(t)
	o := NewOrchestrator(app)

	svc := &notDryRunnableService{name: "session_groups"}
	o.RegisterService("session_groups", svc)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	err := o.RunSyncWithOptions(ctx, Options{
		Year:     0,
		Services: []string{"session_groups"},
		DryRun:   true,
	})
	if err == nil {
		t.Fatal("expected an error rejecting dry_run against an unsupported service, got nil")
	}
	if !strings.Contains(err.Error(), "session_groups") {
		t.Errorf("expected the error to name the unsupported service, got: %v", err)
	}
	if got := svc.callCount.Load(); got != 0 {
		t.Errorf("expected Sync to never run against a rejected dry_run request, ran %d times", got)
	}
}

// TestProcessQueuedSyncsUnifiedHonorsDryRun is the queued-path mechanism test -- the half the
// issue calls out as the one that will be missed. It exercises the real dequeue-and-run path
// (processQueuedSyncs), not just the struct field EnqueueUnifiedSync stores, so a bug in wiring
// QueuedSync.DryRun through to Options.DryRun inside the "unified" case would fail this test
// even though TestRunSyncWithOptionsHonorsDryRun (the immediate path) passes clean.
func TestProcessQueuedSyncsUnifiedHonorsDryRun(t *testing.T) {
	// Not t.Parallel(): t.Setenv is incompatible with it.
	t.Setenv("CAMPMINDER_SEASON_ID", "2025")

	app := newDryRunTestApp(t)
	o := NewOrchestrator(app)

	dry := &dryRunAwareService{name: "family_camp_derived"}
	o.RegisterService("family_camp_derived", dry)

	o.mu.Lock()
	o.pendingUnifiedSyncs = append(o.pendingUnifiedSyncs, QueuedSync{
		ID:      "test-queued-dry-run",
		Year:    2025, // == CAMPMINDER_SEASON_ID, so this resolves to current-year mode
		Type:    "unified",
		Service: "family_camp_derived",
		DryRun:  true,
	})
	o.mu.Unlock()

	processQueuedSyncs(o)

	calls, wrote := dry.snapshot()
	if len(calls) != 1 {
		t.Fatalf("expected Sync to run exactly once via the queue, ran %d times", len(calls))
	}
	if !calls[0] {
		t.Error("queued sync ran with DryRun=false even though QueuedSync.DryRun was true -- " +
			"the flag was lost somewhere between the queue and RunSyncWithOptions")
	}
	if wrote != 0 {
		t.Errorf("expected 0 writes for a queued dry run, got %d", wrote)
	}

	// Control: a queued item with DryRun=false must still write, same reasoning as the
	// immediate-path control above.
	o.mu.Lock()
	o.pendingUnifiedSyncs = append(o.pendingUnifiedSyncs, QueuedSync{
		ID:      "test-queued-wet-run",
		Year:    2025,
		Type:    "unified",
		Service: "family_camp_derived",
		DryRun:  false,
	})
	o.mu.Unlock()

	processQueuedSyncs(o)

	calls, wrote = dry.snapshot()
	if len(calls) != 2 || calls[1] {
		t.Fatalf("expected the second, queued wet run to run with DryRun=false; calls=%v", calls)
	}
	if wrote != 1 {
		t.Errorf("expected the queued wet control run to write once, got %d", wrote)
	}
}

// TestUnsupportedDryRunServices pins the helper both handleUnifiedSync's pre-flight check and
// RunSyncWithOptions's defense-in-depth backstop share.
func TestUnsupportedDryRunServices(t *testing.T) {
	t.Parallel()
	o := NewOrchestrator(nil)

	o.RegisterService("family_camp_derived", &dryRunAwareService{name: "family_camp_derived"})
	o.RegisterService("session_groups", &notDryRunnableService{name: "session_groups"})

	got := o.UnsupportedDryRunServices([]string{"family_camp_derived", "session_groups"})
	if len(got) != 1 || got[0] != "session_groups" {
		t.Errorf("expected [session_groups], got %v", got)
	}

	// A fully-supported list returns nothing.
	if got := o.UnsupportedDryRunServices([]string{"family_camp_derived"}); len(got) != 0 {
		t.Errorf("expected no unsupported services, got %v", got)
	}

	// An unregistered name is not this helper's concern -- that is the caller's existing
	// "unknown service" handling, not a dry_run compatibility question.
	if got := o.UnsupportedDryRunServices([]string{"does_not_exist"}); len(got) != 0 {
		t.Errorf("expected an unregistered service to be silently skipped, got %v", got)
	}
}

// dryRunCapableRealServices are the concrete production types that already had a working
// DryRun field and internal skip-write logic before kindred#2334. Five of them were already
// reachable with it: handleFamilyCampDerivedSync, handleLodgingAssignmentsSync,
// handleStaffSkillsSync, handleFinancialAidApplicationsSync and
// handleHouseholdDemographicsSync each parse ?dry_run= on their own dedicated endpoint. The
// other seven had the field and the skip-write branch but no caller that could set it -- the
// unified endpoint is their first. This list is the actual
// blast radius of the incident in #2334: household_demographics/family_camp_derived are exactly
// the services that swapped medical narratives and adult attributes and deleted family_camp_adults
// rows. A DryRunnable mechanism that only a test double satisfies would leave every one of these
// rejecting dry_run=true with a 400 in production, contradicting the issue's ruled fix direction:
// honor dry_run end to end, for every service reachable through the unified endpoint -- not a
// 400. This list -- and the compile-time assertions below -- exist so a future
// service losing its SetDryRun method (e.g. during a refactor) fails a test instead of silently
// falling back to rejection.
var dryRunCapableRealServices = []string{
	"camper_dietary", "quest_registrations", "household_demographics",
	"financial_aid_applications", "lodging_assignments", "camper_transportation",
	"staff_vehicle_info", "enrollment_snapshots", "normalize_geographic", "family_camp_derived",
	"staff_applications", "staff_skills",
}

// Compile-time guarantee that the real production types stay wired to DryRunnable. If any of
// these stops compiling, a refactor silently dropped SetDryRun and dry_run=true for that
// service would start being rejected in production instead of honored.
var (
	_ DryRunnable = (*CamperDietarySync)(nil)
	_ DryRunnable = (*QuestRegistrationsSync)(nil)
	_ DryRunnable = (*HouseholdDemographicsSync)(nil)
	_ DryRunnable = (*FinancialAidApplicationsSync)(nil)
	_ DryRunnable = (*LodgingAssignmentsSync)(nil)
	_ DryRunnable = (*CamperTransportationSync)(nil)
	_ DryRunnable = (*StaffVehicleInfoSync)(nil)
	_ DryRunnable = (*EnrollmentSnapshotsSync)(nil)
	_ DryRunnable = (*NormalizeGeographicSync)(nil)
	_ DryRunnable = (*FamilyCampDerivedSync)(nil)
	_ DryRunnable = (*StaffApplicationsSync)(nil)
	_ DryRunnable = (*StaffSkillsSync)(nil)
)

// TestRealServicesHonorDryRunThroughUnifiedEndpoint proves the wiring against the actual
// registered production types (not dryRunAwareService test doubles): every service in
// dryRunCapableRealServices must be absent from UnsupportedDryRunServices' verdict on that
// list, while a service known to have no such logic (session_groups) must still be rejected.
// Without this, TestUnsupportedDryRunServices above could stay green forever while every real
// service in production silently lost its DryRunnable implementation.
//
// Interface satisfaction is all this proves. TestRealServicesSetDryRunStoresTheFlag below is
// the half that proves the setter actually stores anything -- a no-op SetDryRun passes this
// test and is worse than no support at all.
func TestRealServicesHonorDryRunThroughUnifiedEndpoint(t *testing.T) {
	t.Parallel()
	o := NewOrchestrator(nil)

	o.RegisterService("camper_dietary", NewCamperDietarySync(nil))
	o.RegisterService("quest_registrations", NewQuestRegistrationsSync(nil))
	o.RegisterService("household_demographics", NewHouseholdDemographicsSync(nil))
	o.RegisterService("financial_aid_applications", NewFinancialAidApplicationsSync(nil))
	o.RegisterService("lodging_assignments", NewLodgingAssignmentsSync(nil))
	o.RegisterService("camper_transportation", NewCamperTransportationSync(nil))
	o.RegisterService("staff_vehicle_info", NewStaffVehicleInfoSync(nil))
	o.RegisterService("enrollment_snapshots", NewEnrollmentSnapshotsSync(nil))
	o.RegisterService("normalize_geographic", NewNormalizeGeographicSync(nil))
	o.RegisterService("family_camp_derived", NewFamilyCampDerivedSync(nil))
	o.RegisterService("staff_applications", NewStaffApplicationsSync(nil))
	o.RegisterService("staff_skills", NewStaffSkillsSync(nil))
	// The real production type, not a double: the rejection path has to be proven against a
	// service that genuinely has no dry-run support, or nothing in the suite shows that a
	// wet-only service is actually caught. If session_groups ever gains a real SetDryRun and
	// a skip-write branch, this failing is the correct signal to move it into
	// dryRunCapableRealServices rather than to swap a double back in here.
	o.RegisterService(serviceNameSessionGroups, NewSessionGroupsSync(nil, nil))

	if got := o.UnsupportedDryRunServices(dryRunCapableRealServices); len(got) != 0 {
		t.Errorf("expected every real dry-run-capable service to be supported, got unsupported=%v", got)
	}

	got := o.UnsupportedDryRunServices(append(append([]string{}, dryRunCapableRealServices...), serviceNameSessionGroups))
	if len(got) != 1 || got[0] != serviceNameSessionGroups {
		t.Errorf("expected only [%s] unsupported alongside the real services, got %v", serviceNameSessionGroups, got)
	}
}

// TestRunSyncWithOptionsDryRunSkipsTheWeeklyBootstrap covers the one write inside
// RunSyncWithOptions that the DryRunnable plumbing never sees. Before any service runs,
// RunSyncWithOptions checks whether the global tables are empty and, if so, runs a full
// weekly sync -- real CampMinder fetches, real writes to person_tag_defs / custom_field_defs
// / divisions -- through RunWeeklySync, which takes no Options and so cannot know a dry run
// was asked for. A dry_run=true request landing on an unseeded database therefore wrote,
// while the 200 body told the operator "dry_run": true (kindred#2334).
func TestRunSyncWithOptionsDryRunSkipsTheWeeklyBootstrap(t *testing.T) {
	t.Parallel()

	// Deliberately NOT newDryRunTestApp: this test needs the empty-globals branch that
	// helper's person_tag_defs seed exists to avoid.
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)

	o := NewOrchestrator(app)
	o.SetJobSpacing(0)

	// person_tag_defs is the first job of the weekly bootstrap and is not part of the
	// requested run, so any call to it can only have come from that bootstrap.
	bootstrap := &notDryRunnableService{name: "person_tag_defs"}
	o.RegisterService("person_tag_defs", bootstrap)
	dry := &dryRunAwareService{name: "family_camp_derived"}
	o.RegisterService("family_camp_derived", dry)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := o.RunSyncWithOptions(ctx, Options{
		Year:     0,
		Services: []string{"family_camp_derived"},
		DryRun:   true,
	}); err != nil {
		t.Fatalf("RunSyncWithOptions (dry): %v", err)
	}

	if got := bootstrap.callCount.Load(); got != 0 {
		t.Errorf("dry run ran the weekly bootstrap %d time(s) -- it writes for real", got)
	}
	if calls, wrote := dry.snapshot(); len(calls) != 1 || !calls[0] || wrote != 0 {
		t.Errorf("expected one dry Sync and no writes; calls=%v wrote=%d", calls, wrote)
	}

	// Control: the bootstrap must still run for a wet request on the same empty database,
	// so the guard above is a dry-run gate and not an accidental removal of the bootstrap.
	if err := o.RunSyncWithOptions(ctx, Options{
		Year:     0,
		Services: []string{"family_camp_derived"},
		DryRun:   false,
	}); err != nil {
		t.Fatalf("RunSyncWithOptions (wet): %v", err)
	}
	if got := bootstrap.callCount.Load(); got == 0 {
		t.Error("wet run skipped the weekly bootstrap on an empty database")
	}
}

// TestRealServicesSetDryRunStoresTheFlag closes the gap the DryRunnable interface leaves open
// on its own: satisfying it is a compile-time property, and a SetDryRun whose body stores
// nothing satisfies it exactly as well as one that works. That mutant is strictly worse than
// having no dry-run support at all -- UnsupportedDryRunServices reports the service as
// supported, so handleUnifiedSync answers 200 with "dry_run": true, and the service then runs
// wet. That is the kindred#2334 incident again with an operator-visible "dry run" label on it.
//
// Verified by mutation while this test was written: with FamilyCampDerivedSync.SetDryRun's
// body replaced by a no-op, `go test ./sync/` stayed entirely green -- the compile-time
// DryRunnable assertions below still held, TestRealServicesHonorDryRunThroughUnifiedEndpoint
// still passed, and every existing per-service dry-run test set the field directly rather than
// through the setter, so nothing anywhere reached the production entry point.
//
// Reflection reads the same exported DryRun field each Sync() branches on before it writes, so
// a service that renames or drops that field fails here loudly instead of quietly ceasing to
// honor dry runs.
func TestRealServicesSetDryRunStoresTheFlag(t *testing.T) {
	t.Parallel()

	services := map[string]DryRunnable{
		"camper_dietary":             NewCamperDietarySync(nil),
		"quest_registrations":        NewQuestRegistrationsSync(nil),
		"household_demographics":     NewHouseholdDemographicsSync(nil),
		"financial_aid_applications": NewFinancialAidApplicationsSync(nil),
		"lodging_assignments":        NewLodgingAssignmentsSync(nil),
		"camper_transportation":      NewCamperTransportationSync(nil),
		"staff_vehicle_info":         NewStaffVehicleInfoSync(nil),
		"enrollment_snapshots":       NewEnrollmentSnapshotsSync(nil),
		"normalize_geographic":       NewNormalizeGeographicSync(nil),
		"family_camp_derived":        NewFamilyCampDerivedSync(nil),
		"staff_applications":         NewStaffApplicationsSync(nil),
		"staff_skills":               NewStaffSkillsSync(nil),
	}

	// Every name the orchestrator will hand SetDryRun(true) must be covered here, or a
	// service could be added to the wired list and never checked.
	if len(services) != len(dryRunCapableRealServices) {
		t.Fatalf("this test covers %d services but %d are wired to DryRunnable",
			len(services), len(dryRunCapableRealServices))
	}
	for _, name := range dryRunCapableRealServices {
		if _, ok := services[name]; !ok {
			t.Fatalf("%s is wired to DryRunnable but not covered here", name)
		}
	}

	for name, svc := range services {
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			field := reflect.ValueOf(svc).Elem().FieldByName("DryRun")
			if !field.IsValid() || field.Kind() != reflect.Bool {
				t.Fatalf("%s has no exported bool DryRun field for SetDryRun to reach", name)
			}

			svc.SetDryRun(true)
			if !field.Bool() {
				t.Fatalf("%s.SetDryRun(true) left DryRun false -- the unified endpoint would "+
					"report dry_run=true and the service would write for real", name)
			}

			// The orchestrator resets the flag on the registered singleton after a dry run;
			// a setter that only ever stores true would leak it into the next, wet run.
			svc.SetDryRun(false)
			if field.Bool() {
				t.Fatalf("%s.SetDryRun(false) left DryRun true -- a later wet run would "+
					"silently write nothing", name)
			}
		})
	}
}

// TestDequeueUnifiedSync tests basic dequeue functionality
func TestDequeueUnifiedSync(t *testing.T) {
	t.Parallel()
	o := NewOrchestrator(nil)

	// Enqueue items
	qs1, _ := o.EnqueueUnifiedSync(2025, "all", false, false, false, "user1")
	_, _ = o.EnqueueUnifiedSync(2024, "all", false, false, false, "user2")

	// Dequeue should return first item (FIFO)
	dequeued := o.DequeueUnifiedSync()
	if dequeued == nil {
		t.Fatal("expected non-nil dequeued item")
		return
	}
	if dequeued.ID != qs1.ID {
		t.Errorf("expected dequeued ID=%s, got %s", qs1.ID, dequeued.ID)
	}

	// Queue should now have 1 item
	queue := o.GetQueuedSyncs()
	if len(queue) != 1 {
		t.Errorf("expected 1 item in queue after dequeue, got %d", len(queue))
	}
}

// TestDequeueUnifiedSyncEmpty tests dequeue on empty queue
func TestDequeueUnifiedSyncEmpty(t *testing.T) {
	t.Parallel()
	o := NewOrchestrator(nil)

	// Dequeue from empty queue should return nil
	dequeued := o.DequeueUnifiedSync()
	if dequeued != nil {
		t.Error("expected nil when dequeuing from empty queue")
	}
}

// TestCancelQueuedSync tests canceling a queued sync
func TestCancelQueuedSync(t *testing.T) {
	t.Parallel()
	o := NewOrchestrator(nil)

	// Enqueue items
	qs1, _ := o.EnqueueUnifiedSync(2025, "all", false, false, false, "user1")
	qs2, _ := o.EnqueueUnifiedSync(2024, "all", false, false, false, "user2")
	qs3, _ := o.EnqueueUnifiedSync(2023, "all", false, false, false, "user3")

	// Cancel the middle item
	ok := o.CancelQueuedSync(qs2.ID)
	if !ok {
		t.Error("expected CancelQueuedSync to return true")
	}

	// Queue should now have 2 items
	queue := o.GetQueuedSyncs()
	if len(queue) != 2 {
		t.Fatalf("expected 2 items in queue after cancel, got %d", len(queue))
	}

	// Verify remaining items are correct
	if queue[0].ID != qs1.ID {
		t.Errorf("expected first item ID=%s, got %s", qs1.ID, queue[0].ID)
	}
	if queue[1].ID != qs3.ID {
		t.Errorf("expected second item ID=%s, got %s", qs3.ID, queue[1].ID)
	}
}

// TestCancelQueuedSyncNotFound tests canceling a non-existent sync
func TestCancelQueuedSyncNotFound(t *testing.T) {
	t.Parallel()
	o := NewOrchestrator(nil)

	// Enqueue an item
	_, _ = o.EnqueueUnifiedSync(2025, "all", false, false, false, "user1")

	// Try to cancel non-existent ID
	ok := o.CancelQueuedSync("non-existent-id")
	if ok {
		t.Error("expected CancelQueuedSync to return false for non-existent ID")
	}

	// Queue should still have 1 item
	queue := o.GetQueuedSyncs()
	if len(queue) != 1 {
		t.Errorf("expected 1 item in queue, got %d", len(queue))
	}
}

// TestGetQueuedSyncsReturnsCopy tests that GetQueuedSyncs returns a copy
func TestGetQueuedSyncsReturnsCopy(t *testing.T) {
	t.Parallel()
	o := NewOrchestrator(nil)

	_, _ = o.EnqueueUnifiedSync(2025, "all", false, false, false, "user1")

	// Get queue and modify it
	queue1 := o.GetQueuedSyncs()
	if len(queue1) != 1 {
		t.Fatalf("expected 1 item, got %d", len(queue1))
	}

	// Modify the returned slice
	queue1[0].Year = 9999

	// Get queue again - should not be affected by modification
	queue2 := o.GetQueuedSyncs()
	if queue2[0].Year == 9999 {
		t.Error("expected GetQueuedSyncs to return a copy, not the internal slice")
	}
}

// TestGetQueuePositionByID tests getting position of a queued item
func TestGetQueuePositionByID(t *testing.T) {
	t.Parallel()
	o := NewOrchestrator(nil)

	qs1, _ := o.EnqueueUnifiedSync(2025, "all", false, false, false, "user1")
	qs2, _ := o.EnqueueUnifiedSync(2024, "all", false, false, false, "user2")
	qs3, _ := o.EnqueueUnifiedSync(2023, "all", false, false, false, "user3")

	// Position is 1-based for user display
	pos1 := o.GetQueuePositionByID(qs1.ID)
	if pos1 != 1 {
		t.Errorf("expected position 1 for first item, got %d", pos1)
	}

	pos2 := o.GetQueuePositionByID(qs2.ID)
	if pos2 != 2 {
		t.Errorf("expected position 2 for second item, got %d", pos2)
	}

	pos3 := o.GetQueuePositionByID(qs3.ID)
	if pos3 != 3 {
		t.Errorf("expected position 3 for third item, got %d", pos3)
	}

	// Non-existent ID should return 0
	pos := o.GetQueuePositionByID("non-existent")
	if pos != 0 {
		t.Errorf("expected position 0 for non-existent ID, got %d", pos)
	}
}

// TestQueueConcurrentAccess tests thread safety of queue operations
func TestQueueConcurrentAccess(t *testing.T) {
	t.Parallel()
	o := NewOrchestrator(nil)

	done := make(chan bool)
	errChan := make(chan error, 100)

	// Writer goroutine - enqueue items
	go func() {
		for i := range 50 {
			_, err := o.EnqueueUnifiedSync(2020+i%10, "all", false, false, false, "writer")
			if err != nil {
				errChan <- err
			}
		}
		done <- true
	}()

	// Reader goroutine - read queue
	go func() {
		for range 50 {
			_ = o.GetQueuedSyncs()
		}
		done <- true
	}()

	// Cancel goroutine - try to cancel items
	go func() {
		for range 50 {
			o.CancelQueuedSync("random-id")
		}
		done <- true
	}()

	// Wait for all goroutines
	<-done
	<-done
	<-done

	close(errChan)
	for err := range errChan {
		t.Errorf("unexpected error during concurrent access: %v", err)
	}

	// No race conditions should have occurred
}

// TestIsUnifiedSyncQueued tests checking if a unified sync is already queued
func TestIsUnifiedSyncQueued(t *testing.T) {
	t.Parallel()
	o := NewOrchestrator(nil)

	// Nothing queued initially
	if o.IsUnifiedSyncQueued(2025, "all") {
		t.Error("expected no sync to be queued initially")
	}

	// Enqueue a sync
	_, _ = o.EnqueueUnifiedSync(2025, "all", false, false, false, "user1")

	// Now it should be queued
	if !o.IsUnifiedSyncQueued(2025, "all") {
		t.Error("expected sync to be queued after enqueue")
	}

	// Different year should not be queued
	if o.IsUnifiedSyncQueued(2024, "all") {
		t.Error("expected different year not to be queued")
	}

	// Different service should not be queued (if we ever support per-service queuing)
	// For now, unified syncs use "all" service, but test the logic anyway
	if o.IsUnifiedSyncQueued(2025, "sessions") {
		t.Error("expected different service not to be queued")
	}
}

// TestQueueLengthMethod tests the GetQueueLength method
func TestQueueLengthMethod(t *testing.T) {
	t.Parallel()
	o := NewOrchestrator(nil)

	// Empty queue
	if o.GetQueueLength() != 0 {
		t.Errorf("expected queue length 0, got %d", o.GetQueueLength())
	}

	// Add items
	_, _ = o.EnqueueUnifiedSync(2025, "all", false, false, false, "user1")
	if o.GetQueueLength() != 1 {
		t.Errorf("expected queue length 1, got %d", o.GetQueueLength())
	}

	_, _ = o.EnqueueUnifiedSync(2024, "all", false, false, false, "user2")
	if o.GetQueueLength() != 2 {
		t.Errorf("expected queue length 2, got %d", o.GetQueueLength())
	}

	// Dequeue
	o.DequeueUnifiedSync()
	if o.GetQueueLength() != 1 {
		t.Errorf("expected queue length 1 after dequeue, got %d", o.GetQueueLength())
	}
}

// =============================================================================
// Stats.IsNoOp Tests
// =============================================================================

// TestStats_IsNoOp tests the IsNoOp method on Stats
func TestStats_IsNoOp(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name     string
		stats    Stats
		expected bool
	}{
		{
			name:     "all zeros is no-op",
			stats:    Stats{Created: 0, Updated: 0, Deleted: 0, Errors: 0, Skipped: 0},
			expected: true,
		},
		{
			name:     "skipped only is still no-op",
			stats:    Stats{Created: 0, Updated: 0, Deleted: 0, Errors: 0, Skipped: 100},
			expected: true,
		},
		{
			name:     "created makes it not a no-op",
			stats:    Stats{Created: 1, Updated: 0, Deleted: 0, Errors: 0, Skipped: 0},
			expected: false,
		},
		{
			name:     "updated makes it not a no-op",
			stats:    Stats{Created: 0, Updated: 1, Deleted: 0, Errors: 0, Skipped: 0},
			expected: false,
		},
		{
			name:     "deleted makes it not a no-op",
			stats:    Stats{Created: 0, Updated: 0, Deleted: 1, Errors: 0, Skipped: 0},
			expected: false,
		},
		{
			name:     "errors make it not a no-op",
			stats:    Stats{Created: 0, Updated: 0, Deleted: 0, Errors: 1, Skipped: 0},
			expected: false,
		},
		{
			name:     "multiple changes is not a no-op",
			stats:    Stats{Created: 5, Updated: 10, Deleted: 2, Errors: 1, Skipped: 100},
			expected: false,
		},
		{
			name:     "duration and expanded fields don't affect no-op",
			stats:    Stats{Created: 0, Updated: 0, Deleted: 0, Errors: 0, Duration: 60, Expanded: 50},
			expected: true,
		},
		{
			// kindred#2267: a run that only dropped duplicate-status staff records made
			// no data change and must still report as a no-op.
			name:     "duplicate staff status only is still no-op",
			stats:    Stats{Created: 0, Updated: 0, Deleted: 0, Errors: 0, DuplicateStaffStatus: 3},
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := tt.stats.IsNoOp()
			if result != tt.expected {
				t.Errorf("Stats%+v.IsNoOp() = %v, want %v", tt.stats, result, tt.expected)
			}
		})
	}
}

// =============================================================================
// Orchestrator.GetChangedCollections Tests
// =============================================================================

// =============================================================================
// Sync Phase Architecture Tests
// =============================================================================

// TestJobMeta_AllJobsHavePhase tests that all sync jobs have a phase assigned
func TestJobMeta_AllJobsHavePhase(t *testing.T) {
	t.Parallel()
	meta := GetJobMeta()

	if len(meta) == 0 {
		t.Fatal("expected syncJobMeta to contain jobs")
		return
	}

	validPhases := map[Phase]bool{
		PhaseSource:    true,
		PhaseExpensive: true,
		PhaseTransform: true,
		PhaseProcess:   true,
		PhaseExport:    true,
	}

	for _, job := range meta {
		if job.ID == "" {
			t.Error("job ID should not be empty")
		}
		if job.Phase == "" {
			t.Errorf("job %q has empty phase", job.ID)
		}
		if !validPhases[job.Phase] {
			t.Errorf("job %q has invalid phase %q", job.ID, job.Phase)
		}
		if job.Description == "" {
			t.Errorf("job %q has empty description", job.ID)
		}
	}
}

// TestJobMeta_SourcePhaseJobs tests that expected source jobs are in source phase
func TestJobMeta_SourcePhaseJobs(t *testing.T) {
	t.Parallel()
	expectedSourceJobs := []string{
		"session_groups",
		"sessions",
		"attendees",
		"persons",
		"bunks",
		"bunk_plans",
		"bunk_assignments",
		"staff",
		"financial_transactions",
	}

	meta := GetJobMeta()
	jobPhases := make(map[string]Phase)
	for _, job := range meta {
		jobPhases[job.ID] = job.Phase
	}

	for _, jobID := range expectedSourceJobs {
		phase, exists := jobPhases[jobID]
		if !exists {
			t.Errorf("expected job %q to be in syncJobMeta", jobID)
			continue
		}
		if phase != PhaseSource {
			t.Errorf("expected job %q to be in source phase, got %q", jobID, phase)
		}
	}
}

// TestJobMeta_ExpensivePhaseJobs tests that custom values jobs are in expensive phase
func TestJobMeta_ExpensivePhaseJobs(t *testing.T) {
	t.Parallel()
	expectedExpensiveJobs := []string{
		"person_custom_values",
		"household_custom_values",
	}

	meta := GetJobMeta()
	jobPhases := make(map[string]Phase)
	for _, job := range meta {
		jobPhases[job.ID] = job.Phase
	}

	for _, jobID := range expectedExpensiveJobs {
		phase, exists := jobPhases[jobID]
		if !exists {
			t.Errorf("expected job %q to be in syncJobMeta", jobID)
			continue
		}
		if phase != PhaseExpensive {
			t.Errorf("expected job %q to be in expensive phase, got %q", jobID, phase)
		}
	}
}

// TestJobMeta_TransformPhaseJobs tests that derived tables are in transform phase
func TestJobMeta_TransformPhaseJobs(t *testing.T) {
	t.Parallel()
	expectedTransformJobs := []string{
		"lodging_assignments",
		"family_camp_derived",
		"household_demographics",
	}

	meta := GetJobMeta()
	jobPhases := make(map[string]Phase)
	for _, job := range meta {
		jobPhases[job.ID] = job.Phase
	}

	for _, jobID := range expectedTransformJobs {
		phase, exists := jobPhases[jobID]
		if !exists {
			t.Errorf("expected job %q to be in syncJobMeta", jobID)
			continue
		}
		if phase != PhaseTransform {
			t.Errorf("expected job %q to be in transform phase, got %q", jobID, phase)
		}
	}
}

// TestJobMeta_IncludesStrandedAssignmentCleanup asserts the cleanup is
// registered in syncJobMeta so the phase API (?phase=transform) and the sync
// dashboard surface it like every other sync job. Its predecessor
// reconcile_request_lifecycle is registered there; stranded_assignment_cleanup
// must be too.
func TestJobMeta_IncludesStrandedAssignmentCleanup(t *testing.T) {
	t.Parallel()
	if got := GetPhaseForJob("stranded_assignment_cleanup"); got != PhaseTransform {
		t.Errorf("GetPhaseForJob(\"stranded_assignment_cleanup\") = %q, want %q", got, PhaseTransform)
	}

	jobs := GetJobsForPhase(PhaseTransform)
	found := false
	for _, j := range jobs {
		if j == "stranded_assignment_cleanup" {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("stranded_assignment_cleanup missing from GetJobsForPhase(PhaseTransform): %v", jobs)
	}
}

// TestJobMeta_ProcessPhaseJobs tests that CSV/AI jobs are in process phase
func TestJobMeta_ProcessPhaseJobs(t *testing.T) {
	t.Parallel()
	expectedProcessJobs := []string{
		"bunk_requests",
		"process_requests",
	}

	meta := GetJobMeta()
	jobPhases := make(map[string]Phase)
	for _, job := range meta {
		jobPhases[job.ID] = job.Phase
	}

	for _, jobID := range expectedProcessJobs {
		phase, exists := jobPhases[jobID]
		if !exists {
			t.Errorf("expected job %q to be in syncJobMeta", jobID)
			continue
		}
		if phase != PhaseProcess {
			t.Errorf("expected job %q to be in process phase, got %q", jobID, phase)
		}
	}
}

// TestJobMeta_ExportPhaseJobs tests that export jobs are in export phase
func TestJobMeta_ExportPhaseJobs(t *testing.T) {
	t.Parallel()
	expectedExportJobs := []string{
		"multi_workbook_export",
	}

	meta := GetJobMeta()
	jobPhases := make(map[string]Phase)
	for _, job := range meta {
		jobPhases[job.ID] = job.Phase
	}

	for _, jobID := range expectedExportJobs {
		phase, exists := jobPhases[jobID]
		if !exists {
			t.Errorf("expected job %q to be in syncJobMeta", jobID)
			continue
		}
		if phase != PhaseExport {
			t.Errorf("expected job %q to be in export phase, got %q", jobID, phase)
		}
	}
}

// TestGetJobsForPhase_ReturnsCorrectJobs tests that GetJobsForPhase returns jobs for specified phase
func TestGetJobsForPhase_ReturnsCorrectJobs(t *testing.T) {
	t.Parallel()
	tests := []struct {
		phase         Phase
		expectedCount int // Minimum expected count
		expectedJobs  []string
	}{
		{
			phase:         PhaseSource,
			expectedCount: 9, // At least 9 source jobs
			expectedJobs:  []string{"sessions", "attendees", "persons"},
		},
		{
			phase:         PhaseExpensive,
			expectedCount: 2,
			expectedJobs:  []string{"person_custom_values", "household_custom_values"},
		},
		{
			phase:         PhaseTransform,
			expectedCount: 3,
			expectedJobs:  []string{"lodging_assignments", "family_camp_derived", "household_demographics"},
		},
		{
			phase:         PhaseProcess,
			expectedCount: 2,
			expectedJobs:  []string{"bunk_requests", "process_requests"},
		},
		{
			phase:         PhaseExport,
			expectedCount: 1,
			expectedJobs:  []string{"multi_workbook_export"},
		},
	}

	for _, tt := range tests {
		t.Run(string(tt.phase), func(t *testing.T) {
			jobs := GetJobsForPhase(tt.phase)

			if len(jobs) < tt.expectedCount {
				t.Errorf("expected at least %d jobs for phase %q, got %d: %v",
					tt.expectedCount, tt.phase, len(jobs), jobs)
			}

			jobSet := make(map[string]bool)
			for _, j := range jobs {
				jobSet[j] = true
			}

			for _, expected := range tt.expectedJobs {
				if !jobSet[expected] {
					t.Errorf("expected job %q in phase %q, got jobs: %v", expected, tt.phase, jobs)
				}
			}
		})
	}
}

// TestGetJobsForPhase_InvalidPhase tests that GetJobsForPhase returns empty for invalid phase
func TestGetJobsForPhase_InvalidPhase(t *testing.T) {
	t.Parallel()
	jobs := GetJobsForPhase("invalid_phase")
	if len(jobs) != 0 {
		t.Errorf("expected empty slice for invalid phase, got %v", jobs)
	}
}

// TestGetJobsForPhase_PreservesOrder tests that GetJobsForPhase returns jobs in definition order
func TestGetJobsForPhase_PreservesOrder(t *testing.T) {
	t.Parallel()
	// Source jobs should be in a sensible order (sessions before attendees, etc.)
	sourceJobs := GetJobsForPhase(PhaseSource)

	// Build position map
	positions := make(map[string]int)
	for i, job := range sourceJobs {
		positions[job] = i
	}

	// Verify sessions comes before attendees (sessions is a dependency)
	if sessions, ok := positions["sessions"]; ok {
		if attendees, ok := positions["attendees"]; ok {
			if sessions > attendees {
				t.Error("sessions should come before attendees in source phase")
			}
		}
	}

	// Verify attendees comes before persons
	if attendees, ok := positions["attendees"]; ok {
		if persons, ok := positions["persons"]; ok {
			if attendees > persons {
				t.Error("attendees should come before persons in source phase")
			}
		}
	}
}

// TestGetAllPhases tests that GetAllPhases returns all valid phases
func TestGetAllPhases(t *testing.T) {
	t.Parallel()
	phases := GetAllPhases()

	if len(phases) != 5 {
		t.Errorf("expected 5 phases, got %d", len(phases))
	}

	expected := map[Phase]bool{
		PhaseSource:    true,
		PhaseExpensive: true,
		PhaseTransform: true,
		PhaseProcess:   true,
		PhaseExport:    true,
	}

	for _, phase := range phases {
		if !expected[phase] {
			t.Errorf("unexpected phase %q in GetAllPhases", phase)
		}
		delete(expected, phase)
	}

	for phase := range expected {
		t.Errorf("missing phase %q in GetAllPhases", phase)
	}
}

// TestGetPhaseForJob tests that GetPhaseForJob returns correct phase for each job
func TestGetPhaseForJob(t *testing.T) {
	t.Parallel()
	tests := []struct {
		jobID    string
		expected Phase
	}{
		{"sessions", PhaseSource},
		{"attendees", PhaseSource},
		{"person_custom_values", PhaseExpensive},
		{"household_custom_values", PhaseExpensive},
		{"lodging_assignments", PhaseTransform},
		{"family_camp_derived", PhaseTransform},
		{"household_demographics", PhaseTransform},
		{"bunk_requests", PhaseProcess},
		{"process_requests", PhaseProcess},
		{"multi_workbook_export", PhaseExport},
	}

	for _, tt := range tests {
		t.Run(tt.jobID, func(t *testing.T) {
			phase := GetPhaseForJob(tt.jobID)
			if phase != tt.expected {
				t.Errorf("GetPhaseForJob(%q) = %q, want %q", tt.jobID, phase, tt.expected)
			}
		})
	}
}

// TestGetPhaseForJob_UnknownJob tests that GetPhaseForJob returns empty for unknown job
func TestGetPhaseForJob_UnknownJob(t *testing.T) {
	t.Parallel()
	phase := GetPhaseForJob("unknown_job")
	if phase != "" {
		t.Errorf("expected empty phase for unknown job, got %q", phase)
	}
}

// TestPhaseExecutionOrder tests that phases follow correct execution order
func TestPhaseExecutionOrder(t *testing.T) {
	t.Parallel()
	// Expected order: source -> expensive -> transform -> process -> export
	phases := GetAllPhases()

	expectedOrder := []Phase{
		PhaseSource,
		PhaseExpensive,
		PhaseTransform,
		PhaseProcess,
		PhaseExport,
	}

	if len(phases) != len(expectedOrder) {
		t.Fatalf("expected %d phases, got %d", len(expectedOrder), len(phases))
	}

	for i, expected := range expectedOrder {
		if phases[i] != expected {
			t.Errorf("phase at position %d: expected %q, got %q", i, expected, phases[i])
		}
	}
}

// TestJobMeta_HouseholdDemographicsIncluded tests that household_demographics is in metadata
func TestJobMeta_HouseholdDemographicsIncluded(t *testing.T) {
	t.Parallel()
	meta := GetJobMeta()

	found := false
	for _, job := range meta {
		if job.ID == "household_demographics" {
			found = true
			if job.Phase != PhaseTransform {
				t.Errorf("expected household_demographics in transform phase, got %q", job.Phase)
			}
			if job.Description == "" {
				t.Error("expected household_demographics to have a description")
			}
			break
		}
	}

	if !found {
		t.Error("expected household_demographics to be in syncJobMeta")
	}
}

// TestJobMeta_NoDuplicateIDs tests that all job IDs are unique
func TestJobMeta_NoDuplicateIDs(t *testing.T) {
	t.Parallel()
	meta := GetJobMeta()

	seen := make(map[string]bool)
	for _, job := range meta {
		if seen[job.ID] {
			t.Errorf("duplicate job ID: %q", job.ID)
		}
		seen[job.ID] = true
	}
}

// =============================================================================
// GetChangedCollections Tests
// =============================================================================

// TestOrchestrator_GetChangedCollections tests the GetChangedCollections method
func TestOrchestrator_GetChangedCollections(t *testing.T) {
	t.Parallel()
	t.Run("empty when no completed syncs", func(t *testing.T) {
		o := NewOrchestrator(nil)

		changed := o.GetChangedCollections()
		if len(changed) != 0 {
			t.Errorf("expected empty map, got %d entries", len(changed))
		}
	})

	t.Run("includes collections from syncs with changes", func(t *testing.T) {
		o := NewOrchestrator(nil)

		// Simulate completed sync with changes
		now := time.Now()
		o.mu.Lock()
		o.lastCompletedStatus["sessions"] = &Status{
			Type:    "sessions",
			Status:  statusCompleted,
			EndTime: &now,
			Summary: Stats{Created: 5, Updated: 2},
		}
		o.mu.Unlock()

		changed := o.GetChangedCollections()

		// sessions sync should map to camp_sessions collection
		if !changed["camp_sessions"] {
			t.Error("expected camp_sessions to be in changed collections")
		}
	})

	t.Run("excludes collections from no-op syncs", func(t *testing.T) {
		o := NewOrchestrator(nil)

		// Simulate completed sync with NO changes (no-op)
		now := time.Now()
		o.mu.Lock()
		o.lastCompletedStatus["sessions"] = &Status{
			Type:    "sessions",
			Status:  statusCompleted,
			EndTime: &now,
			Summary: Stats{Created: 0, Updated: 0, Deleted: 0, Errors: 0, Skipped: 100},
		}
		o.mu.Unlock()

		changed := o.GetChangedCollections()

		// sessions should NOT be in changed collections since it was a no-op
		if changed["camp_sessions"] {
			t.Error("expected camp_sessions NOT to be in changed collections for no-op sync")
		}
	})

	t.Run("handles sync that maps to multiple collections", func(t *testing.T) {
		o := NewOrchestrator(nil)

		// persons sync maps to both persons and households
		now := time.Now()
		o.mu.Lock()
		o.lastCompletedStatus["persons"] = &Status{
			Type:    "persons",
			Status:  statusCompleted,
			EndTime: &now,
			Summary: Stats{Created: 10, Updated: 5},
		}
		o.mu.Unlock()

		changed := o.GetChangedCollections()

		// Both persons and households should be marked as changed
		if !changed["persons"] {
			t.Error("expected persons to be in changed collections")
		}
		if !changed["households"] {
			t.Error("expected households to be in changed collections")
		}
	})

	t.Run("combines multiple syncs correctly", func(t *testing.T) {
		o := NewOrchestrator(nil)

		now := time.Now()
		o.mu.Lock()
		// sessions had changes
		o.lastCompletedStatus["sessions"] = &Status{
			Type:    "sessions",
			Status:  statusCompleted,
			EndTime: &now,
			Summary: Stats{Created: 5},
		}
		// attendees had no changes
		o.lastCompletedStatus["attendees"] = &Status{
			Type:    "attendees",
			Status:  statusCompleted,
			EndTime: &now,
			Summary: Stats{Skipped: 50},
		}
		// bunks had changes
		o.lastCompletedStatus["bunks"] = &Status{
			Type:    "bunks",
			Status:  statusCompleted,
			EndTime: &now,
			Summary: Stats{Updated: 3},
		}
		o.mu.Unlock()

		changed := o.GetChangedCollections()

		// camp_sessions should be changed
		if !changed["camp_sessions"] {
			t.Error("expected camp_sessions to be in changed collections")
		}
		// attendees should NOT be changed (no-op)
		if changed["attendees"] {
			t.Error("expected attendees NOT to be in changed collections")
		}
		// bunks should be changed
		if !changed["bunks"] {
			t.Error("expected bunks to be in changed collections")
		}
	})

	t.Run("handles unknown sync type gracefully", func(t *testing.T) {
		o := NewOrchestrator(nil)

		now := time.Now()
		o.mu.Lock()
		o.lastCompletedStatus["unknown_sync_type"] = &Status{
			Type:    "unknown_sync_type",
			Status:  statusCompleted,
			EndTime: &now,
			Summary: Stats{Created: 5},
		}
		o.mu.Unlock()

		// Should not panic, just return empty for unknown types
		changed := o.GetChangedCollections()
		// unknown_sync_type has no mapping, so nothing added
		if len(changed) != 0 {
			t.Errorf("expected empty map for unknown sync type, got %d entries", len(changed))
		}
	})
}

// TestDailySyncDoesNotIncludeTransformPhase tests that daily sync excludes all transform jobs
func TestUnifiedSyncAlwaysIncludesTransformPhase(t *testing.T) {
	t.Parallel()
	// Transform jobs should ALWAYS be included in unified sync,
	// regardless of IncludeCustomValues setting.
	// They run against existing custom values data (same as daily sync).
	transformJobs := GetJobsForPhase(PhaseTransform)

	t.Run("without custom values", func(t *testing.T) {
		jobs := GetDefaultUnifiedSyncJobs(false)
		jobSet := make(map[string]bool)
		for _, j := range jobs {
			jobSet[j] = true
		}

		for _, tj := range transformJobs {
			if !jobSet[tj] {
				t.Errorf("transform job %q missing from unified sync without CV", tj)
			}
		}
	})

	t.Run("with custom values", func(t *testing.T) {
		jobs := GetDefaultUnifiedSyncJobs(true)
		jobSet := make(map[string]bool)
		for _, j := range jobs {
			jobSet[j] = true
		}

		for _, tj := range transformJobs {
			if !jobSet[tj] {
				t.Errorf("transform job %q missing from unified sync with CV", tj)
			}
		}
	})
}

// TestRunSyncWithOptionsPhaseOrdering tests that phase ordering is correct
func TestRunSyncWithOptionsPhaseOrdering(t *testing.T) {
	t.Parallel()
	t.Run("with custom values - CV before transform", func(t *testing.T) {
		// When IncludeCustomValues=true, phases should be:
		// Source → Expensive (CV) → Transform → (Process added separately)
		jobs := GetDefaultUnifiedSyncJobs(true)

		// Find positions of CV and transform jobs
		posMap := make(map[string]int)
		for i, j := range jobs {
			posMap[j] = i
		}

		cvPos := posMap["household_custom_values"]
		firstTransformPos := posMap["family_camp_derived"]

		if cvPos >= firstTransformPos {
			t.Errorf("custom values (pos %d) must come before transform jobs (pos %d)",
				cvPos, firstTransformPos)
		}
	})

	t.Run("without custom values - transform still runs after source", func(t *testing.T) {
		// When IncludeCustomValues=false, transform jobs should still be present
		// and come after source jobs
		jobs := GetDefaultUnifiedSyncJobs(false)

		posMap := make(map[string]int)
		for i, j := range jobs {
			posMap[j] = i
		}

		// Last source job
		lastSourcePos := posMap["financial_transactions"]
		// First transform job
		firstTransformPos := posMap["family_camp_derived"]

		if lastSourcePos >= firstTransformPos {
			t.Errorf("source jobs (last at pos %d) must come before transform (pos %d)",
				lastSourcePos, firstTransformPos)
		}

		// CV jobs should NOT be present
		if _, found := posMap["person_custom_values"]; found {
			t.Error("person_custom_values should not be present without IncludeCustomValues")
		}
		if _, found := posMap["household_custom_values"]; found {
			t.Error("household_custom_values should not be present without IncludeCustomValues")
		}
	})

	t.Run("order matches daily sync", func(t *testing.T) {
		// The unified sync job order (without CV) should match the daily sync order
		// for all shared jobs: source → transform
		jobs := GetDefaultUnifiedSyncJobs(false)

		expectedOrder := []string{
			// Source phase
			"session_groups", "sessions", "attendees", "persons",
			"bunks", "bunk_plans", "bunk_assignments", "staff", "financial_transactions",
			// Transform phase (same order as RunDailySync)
			"family_camp_derived", "lodging_assignments", "staff_skills",
			"financial_aid_applications", "household_demographics",
			"camper_dietary", "camper_transportation", "quest_registrations",
			"staff_applications", "staff_vehicle_info", "normalize_geographic",
			"enrollment_snapshots", "stranded_assignment_cleanup",
		}

		if len(jobs) != len(expectedOrder) {
			t.Fatalf("expected %d jobs, got %d: %v", len(expectedOrder), len(jobs), jobs)
		}

		for i, expected := range expectedOrder {
			if jobs[i] != expected {
				t.Errorf("job[%d] = %q, want %q", i, jobs[i], expected)
			}
		}
	})
}

// TestUnifiedSyncCustomValuesOnlyAffectsCVJobs tests that IncludeCustomValues
// only controls whether person_custom_values and household_custom_values run,
// not whether transform phase runs.
func TestUnifiedSyncCustomValuesOnlyAffectsCVJobs(t *testing.T) {
	t.Parallel()
	withCV := GetDefaultUnifiedSyncJobs(true)
	withoutCV := GetDefaultUnifiedSyncJobs(false)

	// The only difference should be the 2 CV jobs
	withCVSet := make(map[string]bool)
	for _, j := range withCV {
		withCVSet[j] = true
	}
	withoutCVSet := make(map[string]bool)
	for _, j := range withoutCV {
		withoutCVSet[j] = true
	}

	// Jobs in withCV but not withoutCV should be exactly the CV jobs
	var onlyInCV []string
	for _, j := range withCV {
		if !withoutCVSet[j] {
			onlyInCV = append(onlyInCV, j)
		}
	}

	expectedCVOnly := []string{"person_custom_values", "household_custom_values"}
	if len(onlyInCV) != len(expectedCVOnly) {
		t.Fatalf("expected %d CV-only jobs, got %d: %v", len(expectedCVOnly), len(onlyInCV), onlyInCV)
	}
	for i, j := range onlyInCV {
		if j != expectedCVOnly[i] {
			t.Errorf("CV-only job[%d] = %q, want %q", i, j, expectedCVOnly[i])
		}
	}

	// Jobs in withoutCV but not withCV should be empty
	var onlyInWithout []string
	for _, j := range withoutCV {
		if !withCVSet[j] {
			onlyInWithout = append(onlyInWithout, j)
		}
	}
	if len(onlyInWithout) != 0 {
		t.Errorf("unexpected jobs only in without-CV list: %v", onlyInWithout)
	}
}

// TestRunSyncWithOptionsHistoricalMode documents historical sync behavior.
// Historical syncs always include transform phase (same as current year).
// They skip process phase (bunk_requests, process_requests) since those are current-year only.
func TestRunSyncWithOptionsHistoricalMode(t *testing.T) {
	t.Parallel()
	t.Run("transform phase runs regardless of CV flag", func(t *testing.T) {
		// Both with and without CV, transform jobs should be present
		withCV := GetDefaultUnifiedSyncJobs(true)
		withoutCV := GetDefaultUnifiedSyncJobs(false)

		transformJobs := GetJobsForPhase(PhaseTransform)
		for _, tj := range transformJobs {
			foundWith := false
			foundWithout := false
			for _, j := range withCV {
				if j == tj {
					foundWith = true
				}
			}
			for _, j := range withoutCV {
				if j == tj {
					foundWithout = true
				}
			}
			if !foundWith {
				t.Errorf("transform job %q missing from list with CV", tj)
			}
			if !foundWithout {
				t.Errorf("transform job %q missing from list without CV", tj)
			}
		}
	})
}

// =============================================================================
// Debug Flag Propagation Tests
// =============================================================================

// TestEnqueuePhaseSyncWithDebug tests that EnqueuePhaseSync accepts and stores debug flag
func TestEnqueuePhaseSyncWithDebug(t *testing.T) {
	t.Parallel()
	o := NewOrchestrator(nil)

	t.Run("debug flag is stored in queued sync", func(t *testing.T) {
		// Enqueue with debug=true
		qs, err := o.EnqueuePhaseSync(2025, PhaseSource, true, "user@test.com")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if !qs.Debug {
			t.Error("expected Debug=true to be stored in queued sync")
		}

		// Verify it's in the queue with debug flag
		queue := o.GetQueuedSyncs()
		if len(queue) != 1 {
			t.Fatalf("expected 1 item in queue, got %d", len(queue))
		}
		if !queue[0].Debug {
			t.Error("expected Debug=true in queued item")
		}
	})

	t.Run("debug flag defaults to false when not set", func(t *testing.T) {
		o2 := NewOrchestrator(nil)

		// Enqueue with debug=false
		qs, err := o2.EnqueuePhaseSync(2025, PhaseExpensive, false, "user@test.com")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if qs.Debug {
			t.Error("expected Debug=false to be stored in queued sync")
		}
	})
}

// TestEnqueueIndividualSyncWithDebug tests that EnqueueIndividualSync accepts and stores debug flag
func TestEnqueueIndividualSyncWithDebug(t *testing.T) {
	t.Parallel()
	o := NewOrchestrator(nil)

	t.Run("debug flag is stored in queued sync", func(t *testing.T) {
		// Enqueue with debug=true
		qs, err := o.EnqueueIndividualSync(2025, "sessions", nil, true, "user@test.com")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if !qs.Debug {
			t.Error("expected Debug=true to be stored in queued sync")
		}
	})

	t.Run("debug flag defaults to false when not set", func(t *testing.T) {
		o2 := NewOrchestrator(nil)

		// Enqueue with debug=false
		qs, err := o2.EnqueueIndividualSync(2025, "attendees", nil, false, "user@test.com")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if qs.Debug {
			t.Error("expected Debug=false to be stored in queued sync")
		}
	})
}

// DebuggableMockService implements both Service and Debuggable interfaces for testing
type DebuggableMockService struct {
	*MockService
	debugEnabled bool
	debugMu      sync.Mutex
}

func (d *DebuggableMockService) SetDebug(debug bool) {
	d.debugMu.Lock()
	defer d.debugMu.Unlock()
	d.debugEnabled = debug
}

func (d *DebuggableMockService) IsDebugEnabled() bool {
	d.debugMu.Lock()
	defer d.debugMu.Unlock()
	return d.debugEnabled
}

// TestProcessQueuedSyncsPhaseDebugPropagation tests that processQueuedSyncs
// propagates the debug flag to services when processing phase syncs
func TestProcessQueuedSyncsPhaseDebugPropagation(t *testing.T) {
	t.Parallel()
	// This test verifies the fix for the bug where debug flag was not
	// being set on services when processing queued phase syncs

	t.Run("debug flag should be set on services for queued phase sync", func(t *testing.T) {
		o := NewOrchestrator(nil)

		// Create a debuggable mock service
		mock := &DebuggableMockService{
			MockService: &MockService{name: "sessions", delay: 10 * time.Millisecond},
		}
		o.RegisterService("sessions", mock)

		// Manually add a queued phase sync with debug=true
		o.mu.Lock()
		o.pendingUnifiedSyncs = append(o.pendingUnifiedSyncs, QueuedSync{
			ID:      "test-phase-debug",
			Year:    2025,
			Type:    "phase",
			Service: string(PhaseSource),
			Debug:   true,
		})
		o.mu.Unlock()

		// The debug flag should be propagated to services when the queued sync runs
		// For now, document the expected behavior:
		// 1. processQueuedSyncs dequeues the phase sync
		// 2. For each job in the phase, it should:
		//    a. Set debug=true on the service if Debug flag is set
		//    b. Run the job
		//    c. Set debug=false on the service after completion

		// Verify the mock service starts with debug=false
		if mock.IsDebugEnabled() {
			t.Error("expected debug to be initially disabled")
		}

		// Note: Full integration test would require running processQueuedSyncs
		// which needs more setup. This test documents the expected interface.
	})
}

// TestProcessQueuedSyncsIndividualDebugPropagation tests that processQueuedSyncs
// propagates the debug flag to services when processing individual syncs
func TestProcessQueuedSyncsIndividualDebugPropagation(t *testing.T) {
	t.Parallel()
	t.Run("debug flag should be set on services for queued individual sync", func(t *testing.T) {
		o := NewOrchestrator(nil)

		// Create a debuggable mock service
		mock := &DebuggableMockService{
			MockService: &MockService{name: "sessions", delay: 10 * time.Millisecond},
		}
		o.RegisterService("sessions", mock)

		// Manually add a queued individual sync with debug=true
		o.mu.Lock()
		o.pendingUnifiedSyncs = append(o.pendingUnifiedSyncs, QueuedSync{
			ID:      "test-individual-debug",
			Year:    2025,
			Type:    "individual",
			Service: "sessions",
			Debug:   true,
		})
		o.mu.Unlock()

		// The debug flag should be propagated to the service when the queued sync runs
		// Expected behavior:
		// 1. processQueuedSyncs dequeues the individual sync
		// 2. It should set debug=true on the service if Debug flag is set
		// 3. Run the job
		// 4. Set debug=false on the service after completion

		// Verify the mock service starts with debug=false
		if mock.IsDebugEnabled() {
			t.Error("expected debug to be initially disabled")
		}
	})
}

// TestQueuedSyncDebugFieldSerialization tests that Debug field serializes correctly
func TestQueuedSyncDebugFieldSerialization(t *testing.T) {
	t.Parallel()
	qs := QueuedSync{
		ID:      "test-123",
		Year:    2025,
		Type:    "phase",
		Service: "source",
		Debug:   true,
	}

	// Debug field should be serializable in JSON (used in API responses)
	if !qs.Debug {
		t.Error("expected Debug field to be accessible and set to true")
	}
}

// =============================================================================
// GetCurrentRunProgress Tests - Progress tracking for current sync sequence
// =============================================================================

// TestGetCurrentRunProgress_NoSyncRunning tests that no progress is returned when nothing runs
func TestGetCurrentRunProgress_NoSyncRunning(t *testing.T) {
	t.Parallel()
	o := NewOrchestrator(nil)

	runType, remaining, total, completed := o.GetCurrentRunProgress()

	if runType != "" {
		t.Errorf("expected empty runType when no sync running, got %q", runType)
	}
	if remaining != nil {
		t.Errorf("expected nil remaining when no sync running, got %v", remaining)
	}
	if total != 0 {
		t.Errorf("expected 0 total when no sync running, got %d", total)
	}
	if completed != 0 {
		t.Errorf("expected 0 completed when no sync running, got %d", completed)
	}
}

// TestGetCurrentRunProgress_DailySyncRunning tests progress tracking during daily sync
func TestGetCurrentRunProgress_DailySyncRunning(t *testing.T) {
	t.Parallel()
	o := NewOrchestrator(nil)

	// Simulate daily sync in progress with 5 jobs, currently on job 2 (index 1)
	o.mu.Lock()
	o.dailySyncRunning = true
	o.dailySyncQueue = []string{"sessions", "attendees", "persons", "bunks", "bunk_plans"}
	o.currentRunIndex = 1 // Currently running job at index 1 (attendees)
	o.mu.Unlock()

	runType, remaining, total, completed := o.GetCurrentRunProgress()

	if runType != runTypeDaily {
		t.Errorf("expected runType %q, got %q", runTypeDaily, runType)
	}
	if total != 5 {
		t.Errorf("expected total 5, got %d", total)
	}
	if completed != 1 {
		t.Errorf("expected completed 1 (currentRunIndex), got %d", completed)
	}
	// Remaining should be jobs after current: persons, bunks, bunk_plans
	expectedRemaining := []string{"persons", "bunks", "bunk_plans"}
	if len(remaining) != len(expectedRemaining) {
		t.Errorf("expected %d remaining jobs, got %d", len(expectedRemaining), len(remaining))
	}
	for i, job := range expectedRemaining {
		if i < len(remaining) && remaining[i] != job {
			t.Errorf("expected remaining[%d] = %q, got %q", i, job, remaining[i])
		}
	}
}

// TestGetCurrentRunProgress_HistoricalSyncRunning tests progress tracking during historical sync
func TestGetCurrentRunProgress_HistoricalSyncRunning(t *testing.T) {
	t.Parallel()
	o := NewOrchestrator(nil)

	// Simulate historical sync in progress
	o.mu.Lock()
	o.historicalSyncRunning = true
	o.historicalSyncQueue = []string{"sessions", "attendees", "persons"}
	o.currentRunIndex = 2 // On last job
	o.mu.Unlock()

	runType, remaining, total, completed := o.GetCurrentRunProgress()

	if runType != runTypeHistorical {
		t.Errorf("expected runType %q, got %q", runTypeHistorical, runType)
	}
	if total != 3 {
		t.Errorf("expected total 3, got %d", total)
	}
	if completed != 2 {
		t.Errorf("expected completed 2, got %d", completed)
	}
	// No remaining jobs after current — must be non-nil empty slice for JSON [] serialization
	if remaining == nil {
		t.Error("expected non-nil empty slice for remaining (JSON serializes nil as null), got nil")
	}
	if len(remaining) != 0 {
		t.Errorf("expected 0 remaining jobs, got %d", len(remaining))
	}
}

// TestGetCurrentRunProgress_WeeklySyncRunning tests progress tracking during weekly sync
func TestGetCurrentRunProgress_WeeklySyncRunning(t *testing.T) {
	t.Parallel()
	o := NewOrchestrator(nil)

	// Simulate weekly sync in progress
	o.mu.Lock()
	o.weeklySyncRunning = true
	o.weeklySyncQueue = []string{"person_tag_defs", "custom_field_defs", "divisions"}
	o.currentRunIndex = 0 // On first job
	o.mu.Unlock()

	runType, remaining, total, completed := o.GetCurrentRunProgress()

	if runType != runTypeWeekly {
		t.Errorf("expected runType %q, got %q", runTypeWeekly, runType)
	}
	if total != 3 {
		t.Errorf("expected total 3, got %d", total)
	}
	if completed != 0 {
		t.Errorf("expected completed 0, got %d", completed)
	}
	// Remaining should be: custom_field_defs, divisions
	if len(remaining) != 2 {
		t.Errorf("expected 2 remaining jobs, got %d", len(remaining))
	}
}

// TestGetCurrentRunProgress_CustomValuesSyncRunning tests progress tracking during CV sync
func TestGetCurrentRunProgress_CustomValuesSyncRunning(t *testing.T) {
	t.Parallel()
	o := NewOrchestrator(nil)

	// Simulate custom values sync in progress
	o.mu.Lock()
	o.customValuesSyncRunning = true
	o.customValuesSyncQueue = []string{"person_custom_values", "household_custom_values"}
	o.currentRunIndex = 1 // On second job
	o.mu.Unlock()

	runType, remaining, total, completed := o.GetCurrentRunProgress()

	if runType != runTypeCustomValues {
		t.Errorf("expected runType %q, got %q", runTypeCustomValues, runType)
	}
	if total != 2 {
		t.Errorf("expected total 2, got %d", total)
	}
	if completed != 1 {
		t.Errorf("expected completed 1, got %d", completed)
	}
	// No remaining jobs after current — must be non-nil empty slice for JSON [] serialization
	if remaining == nil {
		t.Error("expected non-nil empty slice for remaining (JSON serializes nil as null), got nil")
	}
	if len(remaining) != 0 {
		t.Errorf("expected 0 remaining jobs (last job running), got %d", len(remaining))
	}
}

// TestGetCurrentRunProgress_IndexOutOfBounds tests handling when index exceeds queue
func TestGetCurrentRunProgress_IndexOutOfBounds(t *testing.T) {
	t.Parallel()
	o := NewOrchestrator(nil)

	// Simulate edge case where index is at queue length
	o.mu.Lock()
	o.dailySyncRunning = true
	o.dailySyncQueue = []string{"sessions", "attendees"}
	o.currentRunIndex = 2 // Beyond queue length
	o.mu.Unlock()

	runType, remaining, total, completed := o.GetCurrentRunProgress()

	if runType != runTypeDaily {
		t.Errorf("expected runType %q, got %q", runTypeDaily, runType)
	}
	if total != 2 {
		t.Errorf("expected total 2, got %d", total)
	}
	if completed != 2 {
		t.Errorf("expected completed 2 (out of bounds index), got %d", completed)
	}
	// remaining must be non-nil empty slice when index >= total, for JSON [] serialization
	if remaining == nil {
		t.Error("expected non-nil empty slice for remaining (JSON serializes nil as null), got nil")
	}
	if len(remaining) != 0 {
		t.Errorf("expected 0 remaining jobs when index >= total, got %d", len(remaining))
	}
}

// TestGetCurrentRunProgress_PriorityOrder tests which sync type takes precedence
func TestGetCurrentRunProgress_PriorityOrder(t *testing.T) {
	t.Parallel()
	o := NewOrchestrator(nil)

	// Set multiple sync flags (shouldn't happen in practice, but tests priority)
	o.mu.Lock()
	o.dailySyncRunning = true
	o.dailySyncQueue = []string{"daily_job"}
	o.historicalSyncRunning = true
	o.historicalSyncQueue = []string{"historical_job"}
	o.currentRunIndex = 0
	o.mu.Unlock()

	runType, _, _, _ := o.GetCurrentRunProgress()

	// Daily should take priority (checked first in implementation)
	if runType != runTypeDaily {
		t.Errorf("expected %q to take priority, got %q", runTypeDaily, runType)
	}
}

func TestFinalizeSyncStatusSuccess(t *testing.T) {
	t.Parallel()
	synctest.Test(t, func(t *testing.T) {
		o := NewOrchestrator(nil)
		mock := &MockService{name: "test", delay: 0}
		o.RegisterService("test", mock)

		err := o.MarkSyncRunning("test")
		if err != nil {
			t.Fatalf("MarkSyncRunning failed: %v", err)
		}

		// Advance virtual time so EndTime - StartTime rounds to a non-zero Duration (int seconds).
		time.Sleep(1010 * time.Millisecond)

		stats := Stats{Created: 5, Updated: 3, Skipped: 2, Errors: 0}
		o.FinalizeSyncStatus("test", stats, nil)

		o.mu.RLock()
		_, stillRunning := o.runningJobs["test"]
		completed := o.lastCompletedStatus["test"]
		o.mu.RUnlock()

		if stillRunning {
			t.Error("expected test to be removed from runningJobs")
		}
		if completed == nil {
			t.Fatal("expected test to be in lastCompletedStatus")
			return
		}
		if completed.Status != statusSuccess {
			t.Errorf("expected status 'success', got %q", completed.Status)
		}
		if completed.EndTime == nil {
			t.Error("expected EndTime to be set")
		}
		if completed.Summary.Created != 5 {
			t.Errorf("expected Created=5, got %d", completed.Summary.Created)
		}
		if completed.Summary.Duration <= 0 {
			t.Error("expected Duration > 0")
		}
		if completed.Error != "" {
			t.Errorf("expected no error, got %q", completed.Error)
		}
	})
}

func TestFinalizeSyncStatusError(t *testing.T) {
	t.Parallel()
	o := NewOrchestrator(nil)
	mock := &MockService{name: "test", delay: 0}
	o.RegisterService("test", mock)

	err := o.MarkSyncRunning("test")
	if err != nil {
		t.Fatalf("MarkSyncRunning failed: %v", err)
	}

	syncErr := fmt.Errorf("api processing failed: connection refused")
	o.FinalizeSyncStatus("test", Stats{Errors: 1}, syncErr)

	o.mu.RLock()
	_, stillRunning := o.runningJobs["test"]
	completed := o.lastCompletedStatus["test"]
	o.mu.RUnlock()

	if stillRunning {
		t.Error("expected test to be removed from runningJobs")
	}
	if completed == nil {
		t.Fatal("expected test to be in lastCompletedStatus")
		return
	}
	if completed.Status != statusFailed {
		t.Errorf("expected status 'failed', got %q", completed.Status)
	}
	if completed.Error != "api processing failed: connection refused" {
		t.Errorf("unexpected error message: %q", completed.Error)
	}
}

func TestFinalizeSyncStatusNoopWhenNotTracked(t *testing.T) {
	t.Parallel()
	o := NewOrchestrator(nil)
	mock := &MockService{name: "test", delay: 0}
	o.RegisterService("test", mock)

	o.FinalizeSyncStatus("test", Stats{Created: 1}, nil)

	o.mu.RLock()
	_, inRunning := o.runningJobs["test"]
	_, inCompleted := o.lastCompletedStatus["test"]
	o.mu.RUnlock()

	if inRunning {
		t.Error("should not be in runningJobs")
	}
	if inCompleted {
		t.Error("should not be in lastCompletedStatus when never tracked")
	}
}

func TestFinalizeSyncStatusCalledFromPanicRecovery(t *testing.T) {
	t.Parallel()
	o := NewOrchestrator(nil)
	mock := &MockService{name: "test", delay: 0}
	o.RegisterService("test", mock)

	err := o.MarkSyncRunning("test")
	if err != nil {
		t.Fatalf("MarkSyncRunning failed: %v", err)
	}

	panicErr := fmt.Errorf("panic: runtime error: index out of range")
	o.FinalizeSyncStatus("test", Stats{}, panicErr)

	o.mu.RLock()
	_, stillRunning := o.runningJobs["test"]
	completed := o.lastCompletedStatus["test"]
	o.mu.RUnlock()

	if stillRunning {
		t.Error("expected test to be removed from runningJobs after panic recovery")
	}
	if completed == nil {
		t.Fatal("expected test to be in lastCompletedStatus")
		return
	}
	if completed.Status != statusFailed {
		t.Errorf("expected status 'failed', got %q", completed.Status)
	}
	if !strings.Contains(completed.Error, "panic:") {
		t.Errorf("expected error to contain 'panic:', got %q", completed.Error)
	}
}

// TestFinalizeSyncStatusAtomicTransition tests that concurrent readers never see
// a partially-written status during FinalizeSyncStatus.
func TestFinalizeSyncStatusAtomicTransition(t *testing.T) {
	t.Parallel()
	o := NewOrchestrator(nil)
	mock := &MockService{name: "test", delay: 0}
	o.RegisterService("test", mock)

	err := o.MarkSyncRunning("test")
	if err != nil {
		t.Fatalf("MarkSyncRunning failed: %v", err)
	}

	// Start concurrent readers that poll GetStatus
	done := make(chan struct{})
	var inconsistent int64
	for range 5 {
		go func() {
			for {
				select {
				case <-done:
					return
				default:
					status := o.GetStatus("test")
					if status == nil {
						continue
					}
					// If status is "success" or "failed", EndTime must be set
					if (status.Status == statusSuccess || status.Status == statusFailed) && status.EndTime == nil {
						atomic.AddInt64(&inconsistent, 1)
					}
				}
			}
		}()
	}

	// Finalize while readers are polling
	time.Sleep(5 * time.Millisecond)
	stats := Stats{Created: 10, Updated: 5}
	o.FinalizeSyncStatus("test", stats, nil)

	// Let readers observe the final state
	time.Sleep(10 * time.Millisecond)
	close(done)

	if atomic.LoadInt64(&inconsistent) > 0 {
		t.Errorf("detected %d inconsistent status reads", inconsistent)
	}
}

// TestRunSingleSyncAtomicStatusTransition tests that RunSingleSync's goroutine
// produces consistent status — no partial writes visible to concurrent readers.
func TestRunSingleSyncAtomicStatusTransition(t *testing.T) {
	t.Parallel()
	o := NewOrchestrator(nil)
	mock := &MockService{name: "test", delay: 10 * time.Millisecond}
	o.RegisterService("test", mock)

	err := o.RunSingleSync(context.Background(), "test")
	if err != nil {
		t.Fatalf("RunSingleSync failed: %v", err)
	}

	// Poll until sync completes, checking for inconsistent state.
	// NOTE: GetStatus returns non-nil even after completion (from lastCompletedStatus),
	// so we break on success/failed status, not nil.
	var inconsistent int64
	deadline := time.After(5 * time.Second)
	for {
		status := o.GetStatus("test")
		if status != nil && status.Status == statusSuccess {
			if status.EndTime == nil {
				atomic.AddInt64(&inconsistent, 1)
			}
			break
		}
		if status != nil && status.Status == statusFailed {
			t.Fatalf("sync failed unexpectedly: %s", status.Error)
		}

		select {
		case <-deadline:
			t.Fatal("timeout waiting for sync to complete")
			return
		default:
			time.Sleep(1 * time.Millisecond)
		}
	}

	if atomic.LoadInt64(&inconsistent) > 0 {
		t.Errorf("detected %d inconsistent status reads", inconsistent)
	}
}

// TestRunTokenPopulated tests that RunSingleSync populates RunToken on the status
func TestRunTokenPopulated(t *testing.T) {
	t.Parallel()
	synctest.Test(t, func(t *testing.T) {
		o := NewOrchestrator(nil)

		mock := &MockService{name: "test_service", delay: 50 * time.Millisecond}
		o.RegisterService("test", mock)

		ctx := context.Background()
		err := o.RunSingleSync(ctx, "test")
		if err != nil {
			t.Fatalf("RunSingleSync failed: %v", err)
		}

		// While running, status should have a non-empty RunToken.
		// The sync goroutine is durably blocked in MockService.Sync's time.After,
		// so virtual time has not advanced and the running status is still present.
		o.mu.RLock()
		status := o.runningJobs["test"]
		o.mu.RUnlock()

		if status == nil {
			t.Fatal("expected running status")
			return
		}

		if status.RunToken == "" {
			t.Error("expected RunToken to be populated, got empty string")
		}

		// Wait for the sync goroutine to complete (virtual time advances past the mock's 50ms delay).
		time.Sleep(100 * time.Millisecond)

		// Completed status should also have the token
		o.mu.RLock()
		completed := o.lastCompletedStatus["test"]
		o.mu.RUnlock()

		if completed == nil {
			t.Fatal("expected completed status")
			return
		}

		if completed.RunToken == "" {
			t.Error("expected completed status to preserve RunToken")
		}

		if completed.RunToken != status.RunToken {
			t.Errorf("RunToken mismatch: running=%q completed=%q", status.RunToken, completed.RunToken)
		}
	})
}

// TestRunTokenPreservedByFinalizeSyncStatus tests that FinalizeSyncStatus preserves
// the RunToken from the running status
func TestRunTokenPreservedByFinalizeSyncStatus(t *testing.T) {
	t.Parallel()
	o := NewOrchestrator(nil)

	mock := &MockService{name: "test_service"}
	o.RegisterService("test", mock)

	// Mark as running
	err := o.MarkSyncRunning("test")
	if err != nil {
		t.Fatalf("MarkSyncRunning failed: %v", err)
	}

	// MarkSyncRunning should also set a RunToken
	o.mu.RLock()
	runningStatus := o.runningJobs["test"]
	token := runningStatus.RunToken
	o.mu.RUnlock()

	if token == "" {
		t.Fatal("expected MarkSyncRunning to set RunToken")
	}

	// Finalize the status
	o.FinalizeSyncStatus("test", Stats{Created: 5}, nil)

	// Check that the token is preserved
	o.mu.RLock()
	completed := o.lastCompletedStatus["test"]
	o.mu.RUnlock()

	if completed == nil {
		t.Fatal("expected completed status")
		return
	}

	if completed.RunToken != token {
		t.Errorf("FinalizeSyncStatus did not preserve RunToken: expected %q, got %q", token, completed.RunToken)
	}
}

// TestRunSyncAndWaitMatchesToken tests the core race condition fix:
// runSyncAndWait should only unblock when the completed status has a matching token,
// not when a different run of the same syncType completes.
func TestRunSyncAndWaitMatchesToken(t *testing.T) {
	t.Parallel()
	o := NewOrchestrator(nil)

	// Register a slow service
	mock := &MockService{name: "test_service", delay: 200 * time.Millisecond}
	o.RegisterService("test", mock)

	// Simulate the race condition:
	// 1. Pre-populate lastCompletedStatus with a STALE token from a previous run
	o.mu.Lock()
	staleToken := "stale-run-token"
	o.lastCompletedStatus["test"] = &Status{
		Type:     "test",
		Status:   statusSuccess,
		RunToken: staleToken,
	}
	o.mu.Unlock()

	// 2. Start runSyncAndWait - it should NOT unblock on the stale completed status
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	errCh := make(chan error, 1)
	go func() {
		errCh <- o.runSyncAndWait(ctx, "test", newBatch(triggerManual))
	}()

	// 3. Wait for it to complete - it should wait for the NEW run, not return immediately
	//    from seeing the stale completed status
	select {
	case err := <-errCh:
		if err != nil {
			t.Fatalf("runSyncAndWait returned error: %v", err)
		}
		// Verify it actually ran the sync (didn't just return from stale status)
		if mock.GetCallCount() != 1 {
			t.Errorf("expected service to be called once, got %d", mock.GetCallCount())
		}

		// Verify the completed status has a NEW token, not the stale one
		o.mu.RLock()
		completed := o.lastCompletedStatus["test"]
		o.mu.RUnlock()

		if completed.RunToken == staleToken {
			t.Error("runSyncAndWait unblocked on stale token - race condition not fixed")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("runSyncAndWait timed out")
	}
}

// TestRunSyncAndWaitZeroDelayNoDeadlock reproduces the exact race from issue #789:
// with an instant-completing service, runSyncAndWait must not deadlock.
// The goroutine may complete before the token is captured from runningJobs,
// leaving expectedToken="" which never matches — causing an infinite loop.
func TestRunSyncAndWaitZeroDelayNoDeadlock(t *testing.T) {
	t.Parallel()
	// Run multiple iterations to increase race likelihood
	for i := range 5 {
		t.Run(fmt.Sprintf("iteration_%d", i), func(t *testing.T) {
			t.Parallel()
			o := NewOrchestrator(nil)
			mock := &MockService{name: "test_service"} // zero delay — instant completion
			o.RegisterService("test", mock)

			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()

			err := o.runSyncAndWait(ctx, "test", newBatch(triggerManual))
			if err != nil {
				t.Fatalf("runSyncAndWait failed: %v (likely deadlocked and hit timeout)", err)
			}

			if mock.GetCallCount() != 1 {
				t.Errorf("expected service called once, got %d", mock.GetCallCount())
			}
		})
	}
}

// TestGenerateQueueID verifies the queue ID helper returns non-empty, unique IDs
// with a random hex suffix. Regression test for #853 — same collision vulnerability
// as #833 fixed in generateRunToken.
func TestGenerateQueueID(t *testing.T) {
	t.Parallel()
	t.Run("returns non-empty string", func(t *testing.T) {
		id := generateQueueID()
		if id == "" {
			t.Error("generateQueueID() returned empty string")
		}
	})

	t.Run("returns unique values on successive calls", func(t *testing.T) {
		seen := make(map[string]bool)
		for i := range 100 {
			id := generateQueueID()
			if seen[id] {
				t.Errorf("duplicate queue ID on iteration %d: %s", i, id)
			}
			seen[id] = true
		}
	})

	t.Run("contains random hex suffix", func(t *testing.T) {
		id := generateQueueID()
		// ID format should be "{nanoseconds}-{4-char hex}"
		parts := strings.SplitN(id, "-", 2)
		if len(parts) != 2 {
			t.Fatalf("expected ID format 'nanos-hex', got %q", id)
		}
		hexPart := parts[1]
		if len(hexPart) != 4 {
			t.Errorf("expected 4-char hex suffix, got %q (len %d)", hexPart, len(hexPart))
		}
		for _, c := range hexPart {
			if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
				t.Errorf("non-hex character %q in suffix %q", string(c), hexPart)
			}
		}
	})
}

// TestGenerateRunToken verifies the extracted helper returns non-empty, unique tokens.
// Regression test for #791 — two inline fmt.Sprintf("%d", time.Now().UnixNano()) calls
// are consolidated into this single helper.
func TestGenerateRunToken(t *testing.T) {
	t.Parallel()
	t.Run("returns non-empty string", func(t *testing.T) {
		token := generateRunToken()
		if token == "" {
			t.Error("generateRunToken() returned empty string")
		}
	})

	t.Run("returns unique values on successive calls", func(t *testing.T) {
		seen := make(map[string]bool)
		for i := range 100 {
			token := generateRunToken()
			if seen[token] {
				t.Errorf("duplicate token on iteration %d: %s", i, token)
			}
			seen[token] = true
		}
	})

	t.Run("contains random hex suffix", func(t *testing.T) {
		token := generateRunToken()
		// Token format should be "{nanoseconds}-{4-char hex}"
		parts := strings.SplitN(token, "-", 2)
		if len(parts) != 2 {
			t.Fatalf("expected token format 'nanos-hex', got %q", token)
		}
		hexPart := parts[1]
		if len(hexPart) != 4 {
			t.Errorf("expected 4-char hex suffix, got %q (len %d)", hexPart, len(hexPart))
		}
		// Verify it's valid hex
		for _, c := range hexPart {
			if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
				t.Errorf("non-hex character %q in suffix %q", string(c), hexPart)
			}
		}
	})
}

// TestRunSingleSyncWithServiceIgnoresRegisteredSingleton pins the fix for #1881: the ten
// individual-sync handlers (family_camp_derived, lodging_assignments,
// staff_skills, financial_aid_applications, household_demographics, camper_dietary,
// camper_transportation, quest_registrations, staff_applications, staff_vehicle_info) used to
// fetch the orchestrator's registered singleton and mutate its Year/DryRun fields in place —
// which let DryRun stick across runs and let concurrent requests race on Year. The fix has
// handlers build a private, request-scoped instance and hand it to
// RunSingleSyncWithService, which must run *that* instance and never touch (or even require)
// a registered singleton.
func TestRunSingleSyncWithServiceIgnoresRegisteredSingleton(t *testing.T) {
	t.Parallel()
	synctest.Test(t, func(t *testing.T) {
		o := NewOrchestrator(nil)

		// The registered singleton, as left over from server startup. Its Year must stay at
		// its zero-value default — a request-scoped run must never write onto shared state.
		registered := &mockYearService{name: "test", year: 0}
		o.RegisterService("test", registered)

		// A private instance built fresh per request, carrying only this request's Year —
		// exactly what a fixed handler does with e.g. NewFamilyCampDerivedSync(e.App).
		requestScoped := &mockYearService{name: "test", year: 2027, stats: Stats{Created: 5}}

		origin := newBatch(triggerManual)
		if err := o.RunSingleSyncWithService(context.Background(), "test", requestScoped, origin); err != nil {
			t.Fatalf("RunSingleSyncWithService failed: %v", err)
		}

		time.Sleep(50 * time.Millisecond)

		if requestScoped.callCount.Load() != 1 {
			t.Errorf("expected the request-scoped instance's Sync to run once, got %d",
				requestScoped.callCount.Load())
		}
		if registered.callCount.Load() != 0 {
			t.Errorf("the registered singleton must never execute for a request-scoped run, got %d calls",
				registered.callCount.Load())
		}
		if registered.year != 0 {
			t.Errorf("the registered singleton's Year must stay at its default (0), got %d", registered.year)
		}

		// Status/stats visible to pollers (e.g. SyncTab) must come from the instance that
		// actually ran, not from the untouched registered singleton.
		o.mu.RLock()
		completed := o.lastCompletedStatus["test"]
		o.mu.RUnlock()
		if completed == nil {
			t.Fatal("expected a completed status to be recorded")
		}
		if completed.Summary.Created != 5 {
			t.Errorf("expected completed status to reflect the request-scoped instance's stats, got %+v",
				completed.Summary)
		}
		if completed.Status != statusSuccess {
			t.Errorf("expected status %q, got %q", statusSuccess, completed.Status)
		}
	})
}

// TestRunSingleSyncWithServiceRejectsConcurrentRunForSameType checks the simple, sequential
// case: once a run for syncType has been reserved, a later call for the same syncType is
// rejected outright and its service instance is never executed.
func TestRunSingleSyncWithServiceRejectsConcurrentRunForSameType(t *testing.T) {
	t.Parallel()
	synctest.Test(t, func(t *testing.T) {
		o := NewOrchestrator(nil)

		first := &mockYearService{name: "test", year: 2026, delay: 100 * time.Millisecond}
		if err := o.RunSingleSyncWithService(context.Background(), "test", first, newBatch(triggerManual)); err != nil {
			t.Fatalf("first call should succeed, got: %v", err)
		}

		second := &mockYearService{name: "test", year: 2027}
		err := o.RunSingleSyncWithService(context.Background(), "test", second, newBatch(triggerManual))
		if err == nil {
			t.Fatal("expected the second concurrent call for the same syncType to be rejected")
		}
		if second.callCount.Load() != 0 {
			t.Error("a rejected call must never execute Sync on its service instance")
		}

		// Let the first run finish so its status settles.
		time.Sleep(200 * time.Millisecond)
		if first.callCount.Load() != 1 {
			t.Errorf("expected the first call to have run exactly once, got %d", first.callCount.Load())
		}
	})
}

// TestRunSingleSyncWithServiceConcurrentCallsExactlyOneWins pins the atomicity half of
// #1881 under real concurrency: the old per-handler pattern checked
// orchestrator.IsRunning(syncType) and only later, unguarded, wrote fields onto the shared
// service — the check was not atomic with the write, so two concurrent requests could both
// pass the check. RunSingleSyncWithService reserves the run under a single lock, so however
// many goroutines race to start the same syncType at once, exactly one may win and execute —
// everyone else must be rejected before their service instance ever runs.
func TestRunSingleSyncWithServiceConcurrentCallsExactlyOneWins(t *testing.T) {
	t.Parallel()
	o := NewOrchestrator(nil)

	const attempts = 50
	services := make([]*mockYearService, attempts)
	errs := make([]error, attempts)

	var start sync.WaitGroup
	start.Add(1)
	var done sync.WaitGroup
	done.Add(attempts)

	for i := range attempts {
		services[i] = &mockYearService{name: "test", year: i, delay: 20 * time.Millisecond}
		go func(i int) {
			defer done.Done()
			start.Wait() // release all goroutines together to maximize interleaving
			errs[i] = o.RunSingleSyncWithService(context.Background(), "test", services[i], newBatch(triggerManual))
		}(i)
	}
	start.Done()
	done.Wait()

	wins := 0
	for i := range attempts {
		if errs[i] == nil {
			wins++
		}
	}
	if wins != 1 {
		t.Errorf("expected exactly 1 winning reservation among %d concurrent attempts, got %d", attempts, wins)
	}

	// Give the winner's background goroutine time to actually invoke Sync.
	time.Sleep(200 * time.Millisecond)
	ranCount := 0
	for i := range attempts {
		ranCount += int(services[i].callCount.Load())
	}
	if ranCount != 1 {
		t.Errorf("expected exactly 1 service instance to have run, got %d", ranCount)
	}
}

// TestCustomFieldValuesHandlersReserveBeforeMutatingSharedState pins the fix for #2105.
//
// Both on-demand custom-field-values handlers (person and household) used to fetch the
// orchestrator's registered singleton and call SetSession/SetDebug on it *before* calling
// MarkSyncRunning to reserve the run. A second request that lost the reservation race still
// got to mutate the singleton on its way to a 409 response. That mutation is not cosmetic:
// person_custom_field_values.go:225 (and the household twin) read Session mid-run to decide
// which persons/households to sync, so a rejected request could silently narrow whatever
// session a still-running request had asked for.
//
// The fix builds a private, request-scoped service instance per request and hands it to
// RunSingleSyncWithService instead of writing onto the shared registered singleton. This test
// simulates "request A is already running an all-sessions sync" by reserving directly via
// MarkSyncRunning (mirroring exactly what a real in-flight run leaves behind), then drives
// the real handler for "request B" (a single-session request that must lose the race) and
// asserts the registered singleton's Session field is untouched by B, no matter how B is
// rejected.
func TestCustomFieldValuesHandlersReserveBeforeMutatingSharedState(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name     string
		syncType string
		register func(o *Orchestrator)
		handler  func(e *core.RequestEvent, scheduler *Scheduler) error
		session  func(svc Service) (session string, ok bool)
	}{
		{
			name:     "person",
			syncType: "person_custom_values",
			register: func(o *Orchestrator) {
				o.RegisterService("person_custom_values", NewPersonCustomFieldValuesSync(nil, nil))
			},
			handler: handlePersonCustomFieldValuesSync,
			session: func(svc Service) (string, bool) {
				s, ok := svc.(*PersonCustomFieldValuesSync)
				if !ok {
					return "", false
				}
				return s.Session, true
			},
		},
		{
			name:     "household",
			syncType: "household_custom_values",
			register: func(o *Orchestrator) {
				o.RegisterService("household_custom_values", NewHouseholdCustomFieldValuesSync(nil, nil))
			},
			handler: handleHouseholdCustomFieldValuesSync,
			session: func(svc Service) (string, bool) {
				s, ok := svc.(*HouseholdCustomFieldValuesSync)
				if !ok {
					return "", false
				}
				return s.Session, true
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			scheduler := NewScheduler(nil)
			orchestrator := scheduler.GetOrchestrator()
			tc.register(orchestrator)

			// Simulate request A: an all-sessions sync already reserved and running. We don't
			// need its goroutine to actually execute a real Sync() -- only that
			// runningJobs[syncType] is occupied, exactly as it would be while a real request-A
			// sync is in flight.
			if err := orchestrator.MarkSyncRunning(tc.syncType); err != nil {
				t.Fatalf("MarkSyncRunning: %v", err)
			}

			singleton := orchestrator.GetService(tc.syncType)
			sessionBefore, ok := tc.session(singleton)
			if !ok {
				t.Fatalf("registered singleton has unexpected type %T", singleton)
			}
			if sessionBefore != DefaultSession {
				t.Fatalf("test setup: expected registered singleton Session=%q, got %q", DefaultSession, sessionBefore)
			}

			// Request B: a single-session request that must lose the reservation race and be
			// rejected with 409, since request A already occupies syncType.
			re := &core.RequestEvent{}
			re.Request = httptest.NewRequest(http.MethodPost, "/?session=1", http.NoBody)
			rec := httptest.NewRecorder()
			re.Response = rec

			if err := tc.handler(re, scheduler); err != nil {
				t.Fatalf("handler returned error: %v", err)
			}
			if rec.Code != http.StatusConflict {
				t.Errorf("expected %d (already running), got %d: %s", http.StatusConflict, rec.Code, rec.Body.String())
			}

			sessionAfter, _ := tc.session(orchestrator.GetService(tc.syncType))
			if sessionAfter != sessionBefore {
				t.Errorf("rejected request B mutated the shared singleton's Session from %q to %q -- "+
					"request A's in-flight run would silently narrow to it", sessionBefore, sessionAfter)
			}
		})
	}
}
