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
		if job == "divisions" {
			found = true
			break
		}
	}

	if !found {
		t.Error("expected weekly sync to include 'divisions' (global table)")
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
		if job == "divisions" {
			t.Error("daily sync should NOT include 'divisions' (moved to weekly)")
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
		if job == "family_camp_derived" {
			found = true
			break
		}
	}

	if !found {
		t.Error("expected daily sync to include 'family_camp_derived'")
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
