package sync

import (
	"slices"
	"testing"
)

// TestRegistryIntegrity pins the structural rules every row must satisfy. It is the guard
// that makes one table safe as the chokepoint for four surfaces.
func TestRegistryIntegrity(t *testing.T) {
	t.Parallel()

	seen := map[string]bool{}
	for _, m := range syncJobMeta {
		if seen[m.ID] {
			t.Errorf("duplicate job id %q", m.ID)
		}
		seen[m.ID] = true

		if m.Phase == "" {
			t.Errorf("%s: no phase", m.ID)
		}
		if m.Description == "" {
			t.Errorf("%s: no description", m.ID)
		}
		if m.Base != "" {
			if GetPhaseForJob(m.Base) == "" {
				t.Errorf("%s: Base %q is not a registered job", m.ID, m.Base)
			}
			if GetPhaseForJob(m.Base) != m.Phase {
				t.Errorf("%s: phase %q != Base %s's %q",
					m.ID, m.Phase, m.Base, GetPhaseForJob(m.Base))
			}
			if m.Scope == ScopeAll {
				t.Errorf("%s: has a Base but ScopeAll -- a variant must name its scope", m.ID)
			}
		}
		if m.Scope != ScopeAll && m.Base == "" {
			t.Errorf("%s: has a Scope but no Base", m.ID)
		}
		if m.Cadences == 0 && m.Triggers == 0 {
			t.Errorf("%s: no cadence and no trigger -- nothing can ever run it", m.ID)
		}
	}
}

// TestCadenceBitsetOverlap pins the one job on two crons. A slice-per-cadence cannot express
// this without listing the job twice, which is why the bitset exists.
func TestCadenceBitsetOverlap(t *testing.T) {
	t.Parallel()

	hourly := jobsWithCadence(CadenceHourly)
	if len(hourly) != 1 || hourly[0] != "bunk_assignments" {
		t.Fatalf("hourly cadence = %v, want [bunk_assignments]", hourly)
	}
	if !slices.Contains(jobsWithCadence(CadenceDaily), "bunk_assignments") {
		t.Error("bunk_assignments must carry Daily as well as Hourly")
	}
}

// TestTriggerFilters pins the trigger-bit lookups against known rows. Tasks 6-8 build derived
// queues on top of these; a wiring mistake here would silently drop or add a job to every one
// of them.
func TestTriggerFilters(t *testing.T) {
	t.Parallel()

	if got := allJobIDs(); len(got) != len(syncJobMeta) {
		t.Errorf("allJobIDs() returned %d ids, want %d", len(got), len(syncJobMeta))
	}

	route := jobsWithTrigger(TriggerIndividualRoute)
	if !slices.Contains(route, "sessions") {
		t.Error("sessions must carry TriggerIndividualRoute")
	}
	for _, id := range []string{
		"person_custom_values_family_camp", "household_custom_values_family_camp",
		"reconcile_request_lifecycle",
	} {
		if slices.Contains(route, id) {
			t.Errorf("%s: must not carry TriggerIndividualRoute -- it has no individual POST route", id)
		}
	}

	sourceFullRun := inPhaseWithTrigger(PhaseSource, TriggerFullRun)
	if !slices.Contains(sourceFullRun, "sessions") {
		t.Error("sessions must be in a PhaseSource full run")
	}

	if !hasTrigger("bunk_requests", TriggerFullRun) {
		t.Error("bunk_requests must carry TriggerFullRun")
	}
	if hasTrigger("nonexistent_job", TriggerFullRun) {
		t.Error("an id absent from the registry must carry no trigger")
	}
}

// TestAvailableAndOrderQueue pins the two runtime concerns cadenceQueue composes: the
// environment Gate (available) and the one execution-order exception (orderQueue).
func TestAvailableAndOrderQueue(t *testing.T) {
	t.Parallel()

	// Named once and reused below rather than repeating the literal, which is what orderQueue's
	// own unexported `last` constant already does inside registry.go (goconst).
	const strandedCleanup = "stranded_assignment_cleanup"

	avail := available([]string{"multi_workbook_export", "sessions"})
	// Cross-checked against the live Gate rather than a hardcoded true/false so the
	// assertion holds regardless of whether GOOGLE_SHEETS_ENABLED is set in this
	// environment -- what is pinned is that available() actually consults the Gate.
	wantExport := jobGate("multi_workbook_export")()
	if slices.Contains(avail, "multi_workbook_export") != wantExport {
		t.Errorf("available() must include multi_workbook_export iff its Gate returns true, got %v want %v",
			slices.Contains(avail, "multi_workbook_export"), wantExport)
	}
	if !slices.Contains(avail, "sessions") {
		t.Error("sessions has no Gate and must always be available")
	}

	ordered := orderQueue([]string{strandedCleanup, "sessions", "bunks"})
	if ordered[len(ordered)-1] != strandedCleanup {
		t.Errorf("orderQueue must move %s last, got %v", strandedCleanup, ordered)
	}
	if !slices.Equal(orderQueue([]string{"sessions", "bunks"}), []string{"sessions", "bunks"}) {
		t.Errorf("orderQueue must leave a queue without %s unchanged", strandedCleanup)
	}

	daily := cadenceQueue(CadenceDaily)
	if len(daily) == 0 {
		t.Fatal("cadenceQueue(CadenceDaily) returned no jobs")
	}
	if daily[len(daily)-1] != strandedCleanup {
		t.Errorf("cadenceQueue(CadenceDaily) must end with %s, got last=%q", strandedCleanup, daily[len(daily)-1])
	}
}

// assertSeq fails with both whole slices when got != want -- a "differs at [9]" message is
// not a diagnosis for a 27-element queue. Task 7 builds assertSeqIgnoring on top of this.
func assertSeq(t *testing.T, label string, got, want []string) {
	t.Helper()
	if !slices.Equal(got, want) {
		t.Errorf("%s: got  %v\n%s: want %v", label, got, label, want)
	}
}

// TestPhaseGlobalIsNotAnExecutionPhase pins the distinction that makes PhaseGlobal safe.
// Global jobs need a registry row so statusSyncTypes and GetWeeklySyncJobs can be derived,
// but "global" is a CLASSIFICATION, not something Run Phase can target -- the frontend
// already renders them in their own "Global Definitions" section and never through
// getSyncTypesByPhase. Adding PhaseGlobal to GetAllPhases would put a sixth phase section
// and a sixth Run Phase button on the Sync tab.
func TestPhaseGlobalIsNotAnExecutionPhase(t *testing.T) {
	t.Parallel()
	for _, p := range GetAllPhases() {
		if p == PhaseGlobal {
			t.Fatal("PhaseGlobal must not be in GetAllPhases -- it is a classification, " +
				"not an execution phase")
		}
	}
	if got := len(GetJobsForPhase(PhaseGlobal)); got != 5 {
		t.Errorf("PhaseGlobal has %d jobs, want 5", got)
	}
}

// TestDerivedQueuesMatchTodaysLists pins the derived queues against the exact lists they
// replace. Written as literals on purpose: deriving the expectation from the same helper the
// production code uses would pass vacuously.
func TestDerivedQueuesMatchTodaysLists(t *testing.T) {
	t.Parallel()

	t.Run("weekly", func(t *testing.T) {
		t.Parallel()
		assertSeq(t, "weekly", GetWeeklySyncJobs(), []string{
			"person_tag_defs", "custom_field_defs", "staff_lookups",
			"financial_lookups", "divisions",
		})
	})
	assertSeq(t, "custom values", GetCustomValuesSyncJobs(), []string{
		"person_custom_values", "household_custom_values",
	})
	assertSeq(t, "expensive phase run", phaseExecutionJobs(PhaseExpensive), []string{
		"person_custom_values", "household_custom_values",
	})
	// Every other phase runs its whole membership -- only Expensive filters (#2489).
	for _, p := range []Phase{PhaseSource, PhaseTransform, PhaseProcess, PhaseExport} {
		assertSeq(t, string(p)+" phase run", phaseExecutionJobs(p), GetJobsForPhase(p))
	}
}

// assertSeqIgnoring delegates to assertSeq after dropping `ignore` from got. Built for
// TestDailyQueueDerivation: multi_workbook_export's presence depends on google.IsEnabled(),
// which this test does not control, so its membership is left out of the pinned sequence
// rather than asserted here.
func assertSeqIgnoring(t *testing.T, label string, got, want []string, ignore ...string) {
	t.Helper()
	filtered := make([]string, 0, len(got))
	for _, id := range got {
		if !slices.Contains(ignore, id) {
			filtered = append(filtered, id)
		}
	}
	assertSeq(t, label, filtered, want)
}

// TestDailyQueueDerivation pins the daily cron's exact sequence. Literal on purpose: this is
// the derivation most likely to silently reorder, and the ordering is load-bearing (#2482
// wants the bounded pass between source and transform; #1416/#1417 want the cleanup last).
func TestDailyQueueDerivation(t *testing.T) {
	t.Setenv("IS_DOCKER", "true")
	want := []string{
		"session_groups", "sessions", "attendees", "persons", "bunks", "bunk_plans",
		"bunk_assignments", "staff", "financial_transactions",
		"person_custom_values_family_camp", "household_custom_values_family_camp",
		"family_camp_derived", "lodging_assignments", "staff_skills",
		"financial_aid_applications", "household_demographics", "camper_dietary",
		"camper_transportation", "quest_registrations", "staff_applications",
		"staff_vehicle_info", "normalize_geographic", "enrollment_snapshots",
		"reconcile_request_lifecycle", "bunk_requests", "process_requests",
		// multi_workbook_export lands before the cleanup only when google.IsEnabled();
		// ignored here and asserted by TestDailyQueueGate instead.
		"stranded_assignment_cleanup",
	}
	assertSeqIgnoring(t, "daily", getDailySyncJobs(), want, "multi_workbook_export")
}

// TestDailyQueueGate pins that a closed gate removes exactly one job.
func TestDailyQueueGate(t *testing.T) {
	t.Setenv("IS_DOCKER", "")
	if slices.Contains(getDailySyncJobs(), "process_requests") {
		t.Error("process_requests must be gated out when IS_DOCKER is unset")
	}
	t.Setenv("IS_DOCKER", "true")
	if !slices.Contains(getDailySyncJobs(), "process_requests") {
		t.Error("process_requests must be present when IS_DOCKER=true")
	}
}

// TestMultiWorkbookExportWithholdsFullRunTrigger pins ruling F4: multi_workbook_export must
// NOT carry TriggerFullRun while RunSyncWithOptions' hardcoded Google Sheets export epilogue
// still fires on every unified run -- setting the bit before Stage 4 removes that epilogue
// would export twice per run. Asserts the raw bit rather than derived-queue membership:
// available() also filters multi_workbook_export on google.IsEnabled, so with Google disabled
// in this environment the job would be absent from the full-run queue for the WRONG reason,
// and a membership check could not tell a withheld bit from a closed gate.
//
// Stage 4's Task 13 deletes this assertion in the same commit that deletes the epilogue and
// sets TriggerFullRun on this row for real.
func TestMultiWorkbookExportWithholdsFullRunTrigger(t *testing.T) {
	t.Parallel()
	if hasTrigger("multi_workbook_export", TriggerFullRun) {
		t.Fatal("multi_workbook_export must not carry TriggerFullRun until Stage 4 removes " +
			"RunSyncWithOptions' export epilogue, or a unified run double-exports Google Sheets")
	}
}

// TestUnifiedRunDerivation pins the full run, including both conditionals and the ordering
// change this task makes: stranded_assignment_cleanup now runs dead-last on a full run,
// matching the daily cron, instead of mid-Transform (#1416, #1417).
//
// t.Setenv, so this cannot run t.Parallel() -- see main_test_parallelism_test.go's
// serialGroups.
func TestUnifiedRunDerivation(t *testing.T) {
	t.Setenv("IS_DOCKER", "")

	full := ResolveUnifiedSyncServices(DefaultService, true, true)
	for _, id := range []string{"person_custom_values", "household_custom_values"} {
		if !slices.Contains(full, id) {
			t.Errorf("includeCustomValues=true must include %s", id)
		}
	}
	// process_requests' Gate (IS_DOCKER) is closed here, independent of CurrentYearOnly --
	// isCurrentYear is true, so this is what pins available() being consulted inside
	// GetDefaultUnifiedSyncJobs rather than only the CurrentYearOnly filter the historical
	// block below exercises.
	if slices.Contains(full, "process_requests") {
		t.Error("process_requests must be gated out of a current-year full run when IS_DOCKER is unset")
	}
	noCV := ResolveUnifiedSyncServices(DefaultService, false, true)
	for _, id := range []string{"person_custom_values", "household_custom_values"} {
		if slices.Contains(noCV, id) {
			t.Errorf("includeCustomValues=false must exclude %s", id)
		}
	}
	historical := ResolveUnifiedSyncServices(DefaultService, true, false)
	for _, id := range []string{"reconcile_request_lifecycle", "bunk_requests", "process_requests"} {
		if slices.Contains(historical, id) {
			t.Errorf("%s is CurrentYearOnly and must not be in a historical replay", id)
		}
	}
	if got := full[len(full)-1]; got != "stranded_assignment_cleanup" {
		t.Errorf("full run ends with %q, want stranded_assignment_cleanup", got)
	}

	// process_requests' CurrentYearOnly bit and its Gate are independent controls and both
	// must hold for it to run. Re-run under IS_DOCKER=true so the CurrentYearOnly clause is
	// pinned non-vacuously -- the block above already proves the Gate half, but with the gate
	// closed there process_requests is absent for the gate's reason regardless of what
	// CurrentYearOnly says, so removing that flag from the registry row would leave every
	// assertion above green.
	t.Setenv("IS_DOCKER", "true")
	dockerFull := ResolveUnifiedSyncServices(DefaultService, true, true)
	if !slices.Contains(dockerFull, "process_requests") {
		t.Error("process_requests must be present in a current-year full run when IS_DOCKER=true")
	}
	dockerHistorical := ResolveUnifiedSyncServices(DefaultService, true, false)
	if slices.Contains(dockerHistorical, "process_requests") {
		t.Error("process_requests is CurrentYearOnly and must not be in a historical replay, even when IS_DOCKER=true")
	}

	// The full ordered sequence, pinned the same way TestDailyQueueDerivation pins the daily
	// cron's: as a literal derived from syncJobMeta by hand, not from GetDefaultUnifiedSyncJobs
	// itself. This is the one queue this branch actually reorders (stranded_assignment_cleanup
	// moves from mid-Transform to dead-last), and until now only its membership and last
	// element were asserted anywhere. multi_workbook_export needs no ignore-list entry here:
	// it carries no TriggerFullRun (TestMultiWorkbookExportWithholdsFullRunTrigger pins that),
	// so it can never appear in dockerFull regardless of its Gate.
	assertSeq(t, "current-year full run", dockerFull, []string{
		"session_groups", "sessions", "attendees", "persons", "bunks", "bunk_plans",
		"bunk_assignments", "staff", "financial_transactions",
		"person_custom_values", "household_custom_values",
		"family_camp_derived", "lodging_assignments", "staff_skills",
		"financial_aid_applications", "household_demographics", "camper_dietary",
		"camper_transportation", "quest_registrations", "staff_applications",
		"staff_vehicle_info", "normalize_geographic", "enrollment_snapshots",
		"reconcile_request_lifecycle", "bunk_requests", "process_requests",
		"stranded_assignment_cleanup",
	})
}
