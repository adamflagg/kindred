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
