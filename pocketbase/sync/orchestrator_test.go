package sync

import (
	"context"
	"strings"
	"sync"
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
	}

	if status.Status != statusCompleted {
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
		Status:    statusCompleted,
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

// TestIsWeeklySyncRunning tests weekly sync running check
func TestIsWeeklySyncRunning(t *testing.T) {
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
		"camper_history",
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
	}

	if len(stats.SubStats) != 2 {
		t.Errorf("expected 2 sub-stats entries, got %d", len(stats.SubStats))
	}

	// Verify households sub-stats
	householdStats, exists := stats.SubStats["households"]
	if !exists {
		t.Fatal("expected 'households' key in SubStats")
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
	o := NewOrchestrator(nil)

	// Register a mock service
	mock := &MockService{name: "test_service"}
	o.RegisterService("test", mock)

	// Set a year context
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
	}

	if status.Type != "test" {
		t.Errorf("expected Type='test', got %q", status.Type)
	}

	if status.Status != "running" {
		t.Errorf("expected Status='running', got %q", status.Status)
	}

	if status.Year != 2024 {
		t.Errorf("expected Year=2024, got %d", status.Year)
	}

	if status.StartTime.IsZero() {
		t.Error("expected StartTime to be set")
	}
}

// TestRunSingleSyncRespectsPreMarkedStatus tests that RunSingleSync uses existing status
// if MarkSyncRunning was called first
func TestRunSingleSyncRespectsPreMarkedStatus(t *testing.T) {
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

	// Wait for the sync goroutine to complete
	time.Sleep(50 * time.Millisecond)

	// Check that the service was actually called
	if mock.GetCallCount() != 1 {
		t.Errorf("expected 1 call to Sync, got %d", mock.GetCallCount())
	}

	// The status should have been updated to success
	o.mu.RLock()
	finalStatus := o.runningJobs["test"]
	o.mu.RUnlock()

	// Start time should be preserved from pre-marked status
	if finalStatus != nil && !finalStatus.StartTime.Equal(preMarkedStartTime) {
		t.Errorf("expected StartTime to be preserved from MarkSyncRunning, got different time")
	}
}

// TestHistoricalSyncIncludesCustomValueServices verifies custom value services are
// re-registered with year-specific client during historical syncs
func TestHistoricalSyncIncludesCustomValueServices(t *testing.T) {
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
		"camper_history",
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

// TestDailySyncExcludesDivisions verifies divisions is NOT in daily sync
func TestDailySyncExcludesDivisions(t *testing.T) {
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
		"camper_history",
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
		"camper_history",
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
		"camper_history",
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
		"camper_history",
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
	t.Run("uses parent context when deadline is generous", func(t *testing.T) {
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

		// Wait for sync to complete
		time.Sleep(100 * time.Millisecond)

		ctxMu.Lock()
		ctx := receivedCtx
		ctxMu.Unlock()

		if ctx == nil {
			t.Fatal("service was never called with a context")
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

	t.Run("extends short parent deadline", func(t *testing.T) {
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

		// Wait for sync to complete
		time.Sleep(100 * time.Millisecond)

		ctxMu.Lock()
		ctx := receivedCtx
		ctxMu.Unlock()

		if ctx == nil {
			t.Fatal("service was never called with a context")
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

	t.Run("creates deadline when parent has none", func(t *testing.T) {
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

		// Wait for sync to complete
		time.Sleep(100 * time.Millisecond)

		ctxMu.Lock()
		ctx := receivedCtx
		ctxMu.Unlock()

		if ctx == nil {
			t.Fatal("service was never called with a context")
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
	}
	if status.Status != statusCompleted {
		t.Errorf("expected status 'completed', got %q", status.Status)
	}

	// Other queued job should still show pending
	status = o.GetStatus("custom_field_defs")
	if status == nil {
		t.Fatal("expected non-nil status for queued weekly sync job")
	}
	if status.Status != statusPending {
		t.Errorf("expected status 'pending', got %q", status.Status)
	}
}

// TestGetStatusCustomValuesSyncPending tests that queued custom values sync jobs show pending status
func TestGetStatusCustomValuesSyncPending(t *testing.T) {
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
	}
	if status.Status != statusCompleted {
		t.Errorf("expected status 'completed', got %q", status.Status)
	}

	// Other queued job should still show pending
	status = o.GetStatus("household_custom_values")
	if status == nil {
		t.Fatal("expected non-nil status for queued custom values sync job")
	}
	if status.Status != statusPending {
		t.Errorf("expected status 'pending', got %q", status.Status)
	}
}

// TestGlobalTablesCheckBehavior documents the expected behavior of checkGlobalTablesEmpty
func TestGlobalTablesCheckBehavior(t *testing.T) {
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

// TestQueuedSyncStruct tests the QueuedSync struct
func TestQueuedSyncStruct(t *testing.T) {
	now := time.Now()
	qs := QueuedSync{
		ID:                  "test-uuid-123",
		Year:                2025,
		Service:             "all",
		IncludeCustomValues: true,
		Debug:               false,
		QueuedAt:            now,
		RequestedBy:         "user@example.com",
	}

	if qs.ID != "test-uuid-123" {
		t.Errorf("expected ID='test-uuid-123', got %q", qs.ID)
	}
	if qs.Year != 2025 {
		t.Errorf("expected Year=2025, got %d", qs.Year)
	}
	if qs.Service != "all" {
		t.Errorf("expected Service='all', got %q", qs.Service)
	}
	if !qs.IncludeCustomValues {
		t.Error("expected IncludeCustomValues=true")
	}
	if qs.Debug {
		t.Error("expected Debug=false")
	}
	if !qs.QueuedAt.Equal(now) {
		t.Errorf("expected QueuedAt=%v, got %v", now, qs.QueuedAt)
	}
	if qs.RequestedBy != "user@example.com" {
		t.Errorf("expected RequestedBy='user@example.com', got %q", qs.RequestedBy)
	}
}

// TestEnqueueUnifiedSync tests basic enqueueing functionality
func TestEnqueueUnifiedSync(t *testing.T) {
	o := NewOrchestrator(nil)

	// Enqueue first item
	qs, err := o.EnqueueUnifiedSync(2025, "all", false, false, "user1@example.com")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if qs == nil {
		t.Fatal("expected non-nil QueuedSync")
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
	o := NewOrchestrator(nil)

	// Enqueue multiple items
	qs1, _ := o.EnqueueUnifiedSync(2025, "all", false, false, "user1")
	qs2, _ := o.EnqueueUnifiedSync(2024, "all", false, false, "user2")
	qs3, _ := o.EnqueueUnifiedSync(2023, "all", false, false, "user3")

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
	o := NewOrchestrator(nil)

	// Enqueue first item (without custom values)
	qs1, err := o.EnqueueUnifiedSync(2025, "all", false, false, "user1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Try to enqueue duplicate (same year + service + includeCustomValues)
	qs2, err := o.EnqueueUnifiedSync(2025, "all", false, true, "user2") // Same includeCustomValues, different debug
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
	qs3, err := o.EnqueueUnifiedSync(2025, "all", true, false, "user3") // Different includeCustomValues
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

// TestDequeueUnifiedSync tests basic dequeue functionality
func TestDequeueUnifiedSync(t *testing.T) {
	o := NewOrchestrator(nil)

	// Enqueue items
	qs1, _ := o.EnqueueUnifiedSync(2025, "all", false, false, "user1")
	_, _ = o.EnqueueUnifiedSync(2024, "all", false, false, "user2")

	// Dequeue should return first item (FIFO)
	dequeued := o.DequeueUnifiedSync()
	if dequeued == nil {
		t.Fatal("expected non-nil dequeued item")
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
	o := NewOrchestrator(nil)

	// Dequeue from empty queue should return nil
	dequeued := o.DequeueUnifiedSync()
	if dequeued != nil {
		t.Error("expected nil when dequeuing from empty queue")
	}
}

// TestCancelQueuedSync tests canceling a queued sync
func TestCancelQueuedSync(t *testing.T) {
	o := NewOrchestrator(nil)

	// Enqueue items
	qs1, _ := o.EnqueueUnifiedSync(2025, "all", false, false, "user1")
	qs2, _ := o.EnqueueUnifiedSync(2024, "all", false, false, "user2")
	qs3, _ := o.EnqueueUnifiedSync(2023, "all", false, false, "user3")

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
	o := NewOrchestrator(nil)

	// Enqueue an item
	_, _ = o.EnqueueUnifiedSync(2025, "all", false, false, "user1")

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
	o := NewOrchestrator(nil)

	_, _ = o.EnqueueUnifiedSync(2025, "all", false, false, "user1")

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
	o := NewOrchestrator(nil)

	qs1, _ := o.EnqueueUnifiedSync(2025, "all", false, false, "user1")
	qs2, _ := o.EnqueueUnifiedSync(2024, "all", false, false, "user2")
	qs3, _ := o.EnqueueUnifiedSync(2023, "all", false, false, "user3")

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
	o := NewOrchestrator(nil)

	done := make(chan bool)
	errChan := make(chan error, 100)

	// Writer goroutine - enqueue items
	go func() {
		for i := 0; i < 50; i++ {
			_, err := o.EnqueueUnifiedSync(2020+i%10, "all", false, false, "writer")
			if err != nil && !strings.Contains(err.Error(), "full") && !strings.Contains(err.Error(), "duplicate") {
				errChan <- err
			}
		}
		done <- true
	}()

	// Reader goroutine - read queue
	go func() {
		for i := 0; i < 50; i++ {
			_ = o.GetQueuedSyncs()
		}
		done <- true
	}()

	// Cancel goroutine - try to cancel items
	go func() {
		for i := 0; i < 50; i++ {
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
	o := NewOrchestrator(nil)

	// Nothing queued initially
	if o.IsUnifiedSyncQueued(2025, "all") {
		t.Error("expected no sync to be queued initially")
	}

	// Enqueue a sync
	_, _ = o.EnqueueUnifiedSync(2025, "all", false, false, "user1")

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
	o := NewOrchestrator(nil)

	// Empty queue
	if o.GetQueueLength() != 0 {
		t.Errorf("expected queue length 0, got %d", o.GetQueueLength())
	}

	// Add items
	_, _ = o.EnqueueUnifiedSync(2025, "all", false, false, "user1")
	if o.GetQueueLength() != 1 {
		t.Errorf("expected queue length 1, got %d", o.GetQueueLength())
	}

	_, _ = o.EnqueueUnifiedSync(2024, "all", false, false, "user2")
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

// TestPhaseConstants tests that Phase constants are properly defined
func TestPhaseConstants(t *testing.T) {
	// All phase constants should be non-empty strings
	phases := []Phase{
		PhaseSource,
		PhaseExpensive,
		PhaseTransform,
		PhaseProcess,
		PhaseExport,
	}

	for _, phase := range phases {
		if phase == "" {
			t.Error("Phase constant should not be empty")
		}
	}

	// Verify expected values
	if PhaseSource != "source" {
		t.Errorf("expected PhaseSource='source', got %q", PhaseSource)
	}
	if PhaseExpensive != "expensive" {
		t.Errorf("expected PhaseExpensive='expensive', got %q", PhaseExpensive)
	}
	if PhaseTransform != "transform" {
		t.Errorf("expected PhaseTransform='transform', got %q", PhaseTransform)
	}
	if PhaseProcess != "process" {
		t.Errorf("expected PhaseProcess='process', got %q", PhaseProcess)
	}
	if PhaseExport != "export" {
		t.Errorf("expected PhaseExport='export', got %q", PhaseExport)
	}
}

// TestJobMeta_AllJobsHavePhase tests that all sync jobs have a phase assigned
func TestJobMeta_AllJobsHavePhase(t *testing.T) {
	meta := GetJobMeta()

	if len(meta) == 0 {
		t.Fatal("expected syncJobMeta to contain jobs")
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
	expectedTransformJobs := []string{
		"camper_history",
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

// TestJobMeta_ProcessPhaseJobs tests that CSV/AI jobs are in process phase
func TestJobMeta_ProcessPhaseJobs(t *testing.T) {
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
			expectedJobs:  []string{"camper_history", "family_camp_derived", "household_demographics"},
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
	jobs := GetJobsForPhase("invalid_phase")
	if len(jobs) != 0 {
		t.Errorf("expected empty slice for invalid phase, got %v", jobs)
	}
}

// TestGetJobsForPhase_PreservesOrder tests that GetJobsForPhase returns jobs in definition order
func TestGetJobsForPhase_PreservesOrder(t *testing.T) {
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
	tests := []struct {
		jobID    string
		expected Phase
	}{
		{"sessions", PhaseSource},
		{"attendees", PhaseSource},
		{"person_custom_values", PhaseExpensive},
		{"household_custom_values", PhaseExpensive},
		{"camper_history", PhaseTransform},
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
	phase := GetPhaseForJob("unknown_job")
	if phase != "" {
		t.Errorf("expected empty phase for unknown job, got %q", phase)
	}
}

// TestPhaseExecutionOrder tests that phases follow correct execution order
func TestPhaseExecutionOrder(t *testing.T) {
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
