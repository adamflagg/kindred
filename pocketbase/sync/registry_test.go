package sync

import (
	"context"
	"regexp"
	"slices"
	"strings"
	"testing"
	"testing/synctest"
	"time"

	"github.com/camp/kindred/pocketbase/campminder"
	pbtests "github.com/pocketbase/pocketbase/tests"
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

// registeredServiceNames parses orchestrator.go for every literal o.RegisterService("name", ...)
// call and returns the set of names found. Modeled on scope_test.go's postRouteSegments: a
// t.Fatal floor check rather than a partial result, so a parser broken by a future refactor
// fails loudly instead of silently matching nothing.
func registeredServiceNames(t *testing.T) map[string]bool {
	t.Helper()

	src := readSourceFile(t, "orchestrator.go")
	re := regexp.MustCompile(`\.RegisterService\(\s*"([a-z0-9_]+)"`)
	matches := re.FindAllStringSubmatch(src, -1)
	// 60 RegisterService calls exist as of this writing: 33 unique names, most registered
	// twice because RunSyncWithOptions' historical-year path re-registers a subset of the
	// same names under a year-scoped client (orchestrator.go:1937-2056). 40 is comfortably
	// below that but well above what a parser matching only one of the two registration
	// blocks would still find (~34 or ~26), so a regex narrowed by a future refactor fails
	// loudly here instead of silently passing over an unreachable row.
	if len(matches) < 40 {
		t.Fatalf("registeredServiceNames: parsed only %d RegisterService call(s) out of "+
			"orchestrator.go -- the regex is broken or the registration shape changed; "+
			"update it to match rather than trust a partial result", len(matches))
	}

	names := make(map[string]bool, len(matches))
	for _, m := range matches {
		names[m[1]] = true
	}
	return names
}

// TestRegistryIDsAreRegisteredServices pins spec §7 test 1's registered-service half: every
// syncJobMeta row's ID must be a name something actually constructs, not merely a row in the
// table. TestRegistryIntegrity already pins uniqueness; this pins reachability. A row whose ID
// no RegisterService call and no scopedServiceRegistrations entry ever produces can be
// scheduled, queued and published on the status payload, but has no backing Service -- it
// fails at run time, not at registration time, and this is the check that would have caught
// it instead.
func TestRegistryIDsAreRegisteredServices(t *testing.T) {
	t.Parallel()

	registered := registeredServiceNames(t)
	for _, reg := range scopedServiceRegistrations(nil, nil) {
		registered[scopedID(reg.base, reg.scope)] = true
	}

	for _, m := range syncJobMeta {
		if !registered[m.ID] {
			t.Errorf("%s: syncJobMeta row names no RegisterService call and is not a scoped "+
				"variant -- the job can never actually run", m.ID)
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
	// it now carries TriggerFullRun (Task 13), but this test never sets GOOGLE_SHEETS_ENABLED,
	// so available()'s Gate (google.IsEnabled) keeps it out of dockerFull regardless -- see
	// TestExportRunsExactlyOnceInAFullRun for the Gate-open case.
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

// TestStatusSyncTypesIsTheWholeRegistry pins the payload as complete by construction. Its
// absences are what kindred#2591 and #2593 were: a 13-minute job the client could not see
// running, and a job that had never fired a completion toast.
func TestStatusSyncTypesIsTheWholeRegistry(t *testing.T) {
	t.Parallel()

	status := statusSyncTypes()
	if len(status) != len(syncJobMeta) {
		t.Fatalf("status payload lists %d jobs, registry has %d", len(status), len(syncJobMeta))
	}
	for _, m := range syncJobMeta {
		if !slices.Contains(status, m.ID) {
			t.Errorf("%s: registered but not published on the status payload", m.ID)
		}
	}
}

// TestCurrentYearOnlyMatchesTheFrontend pins the Go flag to syncTypes.ts's, the way #2593
// pinned manualTrigger to the route table. The frontend flag gates both the card grid and the
// Full-mode dropdown; a job current-year-only on one side and not the other means Run Sync
// submits a current-year-only service against a historical year.
func TestCurrentYearOnlyMatchesTheFrontend(t *testing.T) {
	t.Parallel()

	frontend := frontendCurrentYearOnlyIDs(t)
	var registry []string
	for _, m := range syncJobMeta {
		if m.CurrentYearOnly {
			registry = append(registry, m.ID)
		}
	}
	assertSameSet(t, "currentYearOnly", registry, frontend)
}

// frontendSyncTypesPath is syncTypes.ts relative to this package's working directory, which
// `go test` sets to pocketbase/sync.
const frontendSyncTypesPath = "../../frontend/src/components/admin/syncTypes.ts"

// frontendCurrentYearOnlyIDs parses the ids carrying `currentYearOnly: true` out of
// frontend/src/components/admin/syncTypes.ts, so the Go flag can be pinned against the
// TypeScript one across a language boundary nothing else crosses.
//
// Like postRouteSegments (scope_test.go) and the mirror-image parser on the TypeScript side
// (frontend/src/test/backendSyncJobIds.ts), it FATALS on anything it does not recognize
// rather than returning a plausible-but-wrong set. TestCurrentYearOnlyMatchesTheFrontend is
// anchored to what this returns, so a parser that silently missed a flagged entry would turn
// that assertion green over exactly the drift it exists to catch -- the two sides would
// "agree" because neither the frontend list nor the parse mentioned the job.
//
// Three shapes therefore fail loudly: an entry whose `id:` line is not a plain lowercase
// string literal, a `currentYearOnly:` that is not `true,`/`false,`, and an entry list whose
// markers have moved. Comments are truncated at their `//` first -- syncTypes.ts's own prose
// says "currentYearOnly:" in at least one comment, and a naive substring count trips on it.
func frontendCurrentYearOnlyIDs(t *testing.T) []string {
	t.Helper()

	src := readSourceFile(t, frontendSyncTypesPath)

	const flagToken = "currentYearOnly:"
	idLine := regexp.MustCompile(`^\s+id: '([a-z0-9_]+)',$`)
	flagLine := regexp.MustCompile(`^\s+currentYearOnly: (true|false),$`)

	var ids []string
	entries := 0
	for _, marker := range []string{"GLOBAL_SYNC_TYPES", "YEAR_SYNC_TYPES"} {
		body := frontendSyncTypeEntries(t, src, marker)
		current := ""
		for n, raw := range strings.Split(body, "\n") {
			// An entry's own lines never contain "//", so truncating at the first one strips
			// a trailing or whole-line comment without ever eating part of a line that matters.
			line := raw
			if i := strings.Index(line, "//"); i != -1 {
				line = line[:i]
			}
			switch strings.TrimSpace(line) {
			case "{":
				current = ""
				continue
			case "},", "}":
				current = ""
				continue
			}
			if m := idLine.FindStringSubmatch(line); m != nil {
				current = m[1]
				entries++
				continue
			}
			if !strings.Contains(line, flagToken) {
				continue
			}
			m := flagLine.FindStringSubmatch(line)
			if m == nil {
				t.Fatalf("%s, in %s, line %d: unparseable %q -- this parser understands only "+
					"`currentYearOnly: true,` or `: false,` and refuses to guess, because "+
					"TestCurrentYearOnlyMatchesTheFrontend is anchored to what it returns",
					frontendSyncTypesPath, marker, n+1, strings.TrimSpace(raw))
			}
			if current == "" {
				t.Fatalf("%s, in %s, line %d: currentYearOnly with no `id:` line before it in "+
					"this entry -- the flag cannot be attributed to a job",
					frontendSyncTypesPath, marker, n+1)
			}
			if m[1] == "true" {
				ids = append(ids, current)
			}
		}
	}

	// 35 entries are declared as of this writing. 30 is comfortably below that and well above
	// what a broken or over-narrow regex would still fluke-match, so a genuine parse failure
	// fails loudly here instead of silently returning a partial set -- the same floor, for the
	// same reason, as postRouteSegments'.
	if entries < 30 {
		t.Fatalf("%s: parsed only %d sync-type entries -- the `id:` shape changed and this "+
			"parser needs updating to match rather than trusting a partial result",
			frontendSyncTypesPath, entries)
	}
	if len(ids) == 0 {
		t.Fatalf("%s: parsed zero currentYearOnly ids -- the comparison anchored to this "+
			"would be vacuous", frontendSyncTypesPath)
	}
	return ids
}

// frontendSyncTypeEntries returns the body of one `export const <name> = [ ... ] as const`
// array. Bounding the scan to the two entry lists is what keeps SYNC_PHASES' own `id:` lines
// (source, expensive, transform, ...) out of the parse: they are phase names, not job ids,
// and counting them would inflate the plausibility floor above into a check that passes while
// the real lists are unread.
func frontendSyncTypeEntries(t *testing.T, src, name string) string {
	t.Helper()

	start := "export const " + name + " = [\n"
	at := strings.Index(src, start)
	if at == -1 {
		t.Fatalf("%s: %q not found -- the entry list was renamed or reshaped, and this parser "+
			"needs updating to match", frontendSyncTypesPath, strings.TrimSuffix(start, "\n"))
	}
	body := src[at+len(start):]
	end := strings.Index(body, "\n] as const")
	if end == -1 {
		t.Fatalf("%s: no `] as const` closing %s -- this parser needs updating to match",
			frontendSyncTypesPath, name)
	}
	return body[:end]
}

// assertSameSet compares two id lists as SETS -- order-independent, unlike assertSeq, because
// its two sides are declared in different languages and there is no reason their declaration
// orders should agree. Reports both sides in full plus each side's surplus: "differs at [3]"
// is not a diagnosis when the question is which job one side forgot.
func assertSameSet(t *testing.T, label string, got, want []string) {
	t.Helper()

	sortedGot, sortedWant := slices.Clone(got), slices.Clone(want)
	slices.Sort(sortedGot)
	slices.Sort(sortedWant)
	if slices.Equal(sortedGot, sortedWant) {
		return
	}

	var onlyGot, onlyWant []string
	for _, id := range sortedGot {
		if !slices.Contains(sortedWant, id) {
			onlyGot = append(onlyGot, id)
		}
	}
	for _, id := range sortedWant {
		if !slices.Contains(sortedGot, id) {
			onlyWant = append(onlyWant, id)
		}
	}
	t.Errorf("%s: sets differ\n  got  %v\n  want %v\n  only in got:  %v\n  only in want: %v",
		label, sortedGot, sortedWant, onlyGot, onlyWant)
}

// TestUnifiedServiceWhitelist pins the rule spec §4 states and Stage 2 could not yet enforce:
// a job may be named individually on POST /api/custom/sync/run?service=<id> only if it
// declares TriggerIndividualRoute.
//
// nil is the rejection, and the distinction from empty is load-bearing: handleUnifiedSync
// answers 400 on nil, so an unknown or cron-only service is refused rather than resolved to a
// run of nothing. Before this, ResolveUnifiedSyncServices passed ANY ?service= name straight
// through, which is why TestScopedVariantContract's no-individual-route clause had to describe
// itself as a convention rather than a server guarantee.
//
// The five PhaseGlobal jobs are the reason this waited for Task 9. They have real POST routes
// and are runnable today, but had no registry row until then -- a whitelist derived from the
// incomplete table would have answered 400 for all five, which is a wrong answer, not merely
// an early one (Stage 2 ledger, ruling F5). divisions is named below for exactly that.
func TestUnifiedServiceWhitelist(t *testing.T) {
	t.Parallel()

	// A routed job resolves to itself. divisions is the deferral's own regression case; the
	// other two are an ordinary source job and the one job with an environment Gate -- a Gate
	// is a RUNTIME check and must not make a declared route unreachable.
	for _, id := range []string{"sessions", "divisions", "multi_workbook_export"} {
		if got := ResolveUnifiedSyncServices(id, true, true); !slices.Equal(got, []string{id}) {
			t.Errorf("ResolveUnifiedSyncServices(%q) = %v, want [%s]", id, got, id)
		}
	}

	// Everything else is nil: the two scoped variants and reconcile_request_lifecycle are
	// registered but declare no route (they run only from the daily cron and, for the latter,
	// a phase or full run); the last two are not jobs at all.
	for _, id := range []string{
		"person_custom_values_family_camp", "household_custom_values_family_camp",
		"reconcile_request_lifecycle", "not_a_service", "",
	} {
		if got := ResolveUnifiedSyncServices(id, true, true); got != nil {
			t.Errorf("ResolveUnifiedSyncServices(%q) = %v, want nil -- an unrouted service must "+
				"be refused, never resolved to a run of nothing", id, got)
		}
	}

	// DefaultService is not a job id and must never be caught by the whitelist.
	if got := ResolveUnifiedSyncServices(DefaultService, true, true); len(got) == 0 {
		t.Errorf("ResolveUnifiedSyncServices(%q) = %v, want the full-run queue", DefaultService, got)
	}
}

// TestEveryRoutedJobIsIndividuallyResolvable is the whitelist's non-vacuity guard and the
// deferral's real regression test: every job carrying TriggerIndividualRoute must still
// resolve to itself. A row that lost the bit -- or was added without it -- turns a working Run
// button into a 400, which is precisely what adding this whitelist during Stage 2 would have
// done to all five global jobs.
func TestEveryRoutedJobIsIndividuallyResolvable(t *testing.T) {
	t.Parallel()

	routed := jobsWithTrigger(TriggerIndividualRoute)
	if len(routed) == 0 {
		t.Fatal("no job carries TriggerIndividualRoute -- the loop below would be vacuous")
	}
	for _, id := range routed {
		if got := ResolveUnifiedSyncServices(id, true, true); !slices.Equal(got, []string{id}) {
			t.Errorf("%s declares TriggerIndividualRoute but resolves to %v -- its Run button 400s", id, got)
		}
	}
}

// nonJobPostRouteSegments is the eight POST segments under /api/custom/sync/ that are not
// jobs: five aggregate entry points (the unified run, a phase run, and the three cron
// endpoints), the two RunSyncSequence refresh chains, and the multipart CSV upload.
//
// bunk_requests_upload is a DIFFERENT endpoint from the bunk_requests job's own
// /sync/bunk-requests route -- it takes a file, the job takes a year -- and it is the one
// segment api.go registers with underscores rather than hyphens.
//
// Named as a literal because the exclusion is a judgement about what a route MEANS, which no
// parser can make. Every entry is checked to still exist below: a stale exclusion silently
// widens the filter, which is the one way this set could turn the test green over real drift.
var nonJobPostRouteSegments = []string{
	"run", "run-phase", "hourly", "weekly", "custom-values",
	"refresh-bunking", "refresh-family-camp", "bunk_requests_upload",
}

// TestTriggerIndividualRouteMatchesTheRouteTable pins spec §7 test 4 in BOTH directions:
// TriggerIndividualRoute is a DECLARED FACT (see the Trigger type's comment -- the handlers
// genuinely differ, so generating them would cost more than it saves), and a declared fact is
// only worth declaring if something checks it.
//
// Each direction has its own failure mode. A row carrying the bit with no route makes
// ResolveUnifiedSyncServices accept a ?service= that then 404s from the frontend's Run button;
// a route with no bit is the reverse -- since Stage 3 Task 10's whitelist, that Run button
// gets a 400 from an endpoint that is genuinely registered. Before the whitelist the second
// direction was harmless, which is why this test and the whitelist arrived together.
//
// The arithmetic closes exactly, which is what makes it worth having: api.go registers 40 POST
// segments, 8 of them the aggregates above; the registry declares 35 jobs, 32 carrying the bit
// (all but the two _family_camp variants and reconcile_request_lifecycle). 32 + 8 = 40, with
// nothing left over on either side.
func TestTriggerIndividualRouteMatchesTheRouteTable(t *testing.T) {
	t.Parallel()

	segments := postRouteSegments(t)
	for _, seg := range nonJobPostRouteSegments {
		if !slices.Contains(segments, seg) {
			t.Errorf("the exclusion set names %q, which api.go no longer registers -- a stale "+
				"exclusion widens this filter silently", seg)
		}
	}

	// Routes are hyphenated and ids underscored, so the comparison is made in the route
	// spelling. A job whose route were registered underscored would fail here rather than
	// match, which is correct: useRunIndividualSync.ts POSTs the hyphenated form.
	withRoute := jobsWithTrigger(TriggerIndividualRoute)
	declared := make([]string, 0, len(withRoute))
	for _, id := range withRoute {
		declared = append(declared, strings.ReplaceAll(id, "_", "-"))
	}
	var routed []string
	for _, seg := range segments {
		if !slices.Contains(nonJobPostRouteSegments, seg) {
			routed = append(routed, seg)
		}
	}
	if len(declared) == 0 || len(routed) == 0 {
		t.Fatalf("nothing to compare: %d declared, %d routed", len(declared), len(routed))
	}
	assertSameSet(t, "TriggerIndividualRoute vs api.go's POST route table", declared, routed)
}

// =============================================================================
// Task 12: Batch-scoped changed collections
// =============================================================================

// newTestOrchestrator builds a bare Orchestrator for tests that only need in-memory batch
// bookkeeping -- no PocketBase app, matching the NewOrchestrator(nil) pattern used throughout
// orchestrator_test.go.
func newTestOrchestrator(t *testing.T) *Orchestrator {
	t.Helper()
	return NewOrchestrator(nil)
}

// TestBatchScopedChangedCollections pins the filter to the BATCH, not the process.
//
// The process-lifetime approach this replaces (the deleted GetChangedCollections) read
// lastCompletedStatus -- every service's most recent completion since process START. A
// collection stayed marked changed until its job completed again as a no-op, so on a
// long-lived container most of the 18 sheets were rewritten on most runs and "only if changed"
// did not mean it. Batch-scoping is where the API-cost saving lands.
//
// registerBatch is called first for both batches -- fix-round-1 correction: recordBatchChange
// now only writes into a batch registerBatch initialized, so an un-registered batchID is
// silently dropped (see registerBatch's doc comment for why: closing the leak that a fresh,
// never-cleaned-up batch id -- RunSingleSync, RunSingleSyncWithService, RunSyncSequence --
// otherwise accumulated into forever).
func TestBatchScopedChangedCollections(t *testing.T) {
	t.Parallel()
	o := newTestOrchestrator(t)

	o.registerBatch("batch-a")
	o.registerBatch("batch-b")

	o.recordBatchChange("batch-a", "persons", Stats{Created: 1})
	o.recordBatchChange("batch-b", "bunks", Stats{Updated: 2})
	o.recordBatchChange("batch-a", "staff", Stats{}) // no-op: must not mark

	gotA := o.batchChangedCollections("batch-a")
	for _, c := range []string{"persons", "households"} { // the persons job writes both
		if !gotA[c] {
			t.Errorf("batch A missing %s", c)
		}
	}
	if gotA["bunks"] {
		t.Error("batch A must not see batch B's changes")
	}
	if gotA["staff"] {
		t.Error("a no-op completion must not mark its collections changed")
	}
}

// TestStandaloneRunClearsTheFilter pins that a manual click exports everything. The service
// instance is long-lived, so not-setting is not enough -- it would carry the previous queue's
// filter into the click.
//
// Registered in serialGroups (main_test_parallelism_test.go): newExportWithFakeWriter calls
// t.Setenv.
func TestStandaloneRunClearsTheFilter(t *testing.T) {
	o := newTestOrchestrator(t)
	exp := newExportWithFakeWriter(t)
	o.RegisterService("multi_workbook_export", exp)

	exp.SetChangedCollections(map[string]bool{"persons": true}) // leftover from a queue
	if err := o.RunSingleSync(context.Background(), "multi_workbook_export"); err != nil {
		t.Fatal(err)
	}
	if exp.changed != nil {
		t.Errorf("RunSingleSync must CLEAR the filter, got %v", exp.changed)
	}

	// RunSingleSync never waits for its background Sync() to finish (see runSingleSyncInternal),
	// and newExportWithFakeWriter's throwaway app registers t.Cleanup(app.Cleanup). Without this
	// wait, the test can return and let that cleanup tear the app down concurrently with the
	// still-running Sync() reading it -- a real, -race-catchable hazard, not merely theoretical
	// (reproduced empirically while writing this test).
	waitForSyncToFinish(t, o, "multi_workbook_export")
}

// TestStandaloneRunResetsYear is TestStandaloneRunClearsTheFilter's twin for YearSetter -- the
// controller correction requiring RunSingleSync to set BOTH the filter and the year
// explicitly, not just the changed-collections filter. MultiWorkbookExport is reachable both
// from the dedicated multi-workbook-export button (fixed by
// TestHandleMultiWorkbookExportDefaultBranchResetsYear) and from the generic "run any single
// sync service" endpoint (api.go's handleIndividualSync, which calls
// orchestrator.RunSingleSync directly) -- this is that second, previously-unfixed read path.
//
// Registered in serialGroups: newExportWithFakeWriter calls t.Setenv.
func TestStandaloneRunResetsYear(t *testing.T) {
	o := newTestOrchestrator(t)
	exp := newExportWithFakeWriter(t) // CAMPMINDER_SEASON_ID=2025, exp.year starts at 2025

	exp.SetYear(2019) // leftover historical year from a prior queued run
	o.RegisterService("multi_workbook_export", exp)

	if err := o.RunSingleSync(context.Background(), "multi_workbook_export"); err != nil {
		t.Fatal(err)
	}
	if exp.year != 2025 {
		t.Errorf("RunSingleSync must reset the year to the current season (2025), got %d", exp.year)
	}

	// See TestStandaloneRunClearsTheFilter's identical wait for why this is needed.
	waitForSyncToFinish(t, o, "multi_workbook_export")
}

// waitForSyncToFinish blocks until syncType's currently-running background sync (as started by
// RunSingleSync, which never waits for its own goroutine) completes, polling the orchestrator's
// own mutex-guarded IsRunning rather than sleeping blind. RunSingleSync returns as soon as it
// has spawned the goroutine; a t.Setenv/t.Cleanup test that returns before that goroutine
// finishes lets the harness's cleanup (env restore, or here app.Cleanup() tearing down the
// throwaway PocketBase app) race the still-running Sync() against the very state it reads --
// exactly the class of bug TestHandleMultiWorkbookExportDefaultBranchResetsYear's
// signalingWorkbookManager exists to avoid for the same reason.
func waitForSyncToFinish(t *testing.T, o *Orchestrator, syncType string) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for o.IsRunning(syncType) {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s's background sync to finish", syncType)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// changedCollectionsSpy is a minimal Service + ChangedCollectionsAware fake that records what
// the orchestrator passed into SetChangedCollections before Sync() ran, distinguishing "never
// called" from "called with an empty map" -- the same nil-vs-empty distinction
// ChangedCollectionsAware's own doc comment is about.
type changedCollectionsSpy struct {
	name          string
	changed       map[string]bool
	changedWasSet bool
}

func (s *changedCollectionsSpy) Sync(context.Context) error { return nil }
func (s *changedCollectionsSpy) Name() string               { return s.name }
func (s *changedCollectionsSpy) GetStats() Stats            { return Stats{} }
func (s *changedCollectionsSpy) SetChangedCollections(changed map[string]bool) {
	s.changed = changed
	s.changedWasSet = true
}

// TestQueueScopesChangedCollectionsToItsBatch drives two real completions through the same
// batch via runSyncAndWait -- the function every queue in this file (and both of api.go's
// queued-run handlers) routes through -- and proves two things at once: that
// runSingleSyncInternal's completion path (applyCompletionStatus call site 1) records the
// first job's change into the batch, and that runSyncAndWait then hands exactly that batch's
// own set, not the process's whole history, to the next ChangedCollectionsAware job in the
// same batch.
func TestQueueScopesChangedCollectionsToItsBatch(t *testing.T) {
	t.Parallel()
	o := newTestOrchestrator(t)

	o.RegisterService("persons", &MockService{name: "persons", stats: Stats{Created: 2}})
	spy := &changedCollectionsSpy{name: "export_spy"}
	o.RegisterService("export_spy", spy)

	// registerBatch simulates what a real queue function does before its first job runs (see
	// registerBatch's doc comment) -- runSyncAndWait itself never registers, since it's shared
	// by both real queues and RunSingleSync-style batches of one that must NOT accumulate.
	origin := newBatch(triggerManual)
	o.registerBatch(origin.batchID)
	if err := o.runSyncAndWait(context.Background(), "persons", origin); err != nil {
		t.Fatalf("persons: %v", err)
	}
	if err := o.runSyncAndWait(context.Background(), "export_spy", origin); err != nil {
		t.Fatalf("export_spy: %v", err)
	}

	if !spy.changedWasSet {
		t.Fatal("expected SetChangedCollections to be called before Sync")
	}
	if !spy.changed["persons"] || !spy.changed["households"] {
		t.Errorf("expected the batch's own change (persons job writes persons+households), got %v", spy.changed)
	}
}

// yearSetterSpy is a minimal Service + YearSetter fake, mirroring changedCollectionsSpy's
// shape for the identical reason: distinguishing "never called" from "called with 0".
type yearSetterSpy struct {
	name       string
	year       int
	yearWasSet bool
}

func (s *yearSetterSpy) Sync(context.Context) error { return nil }
func (s *yearSetterSpy) Name() string               { return s.name }
func (s *yearSetterSpy) GetStats() Stats            { return Stats{} }
func (s *yearSetterSpy) SetYear(year int) {
	s.year = year
	s.yearWasSet = true
}

// TestRunSyncAndWaitSetsYearFromOrigin pins the structural fix (Task 13 fix round 2):
// runSyncAndWait -- the one function every queue in this file routes through -- sets a
// YearSetter service's year from origin.year before Sync() runs, the same way it already
// sets a ChangedCollectionsAware service's changed-collections filter from the same origin.
// 0 means "the current season" (runOrigin.year's own doc comment) and resolves via
// ParseSeasonYear(); a non-zero origin.year (a historical replay, or an explicit-year
// phase/individual run) sets that exact year directly. This is what makes the fix apply
// uniformly to every queue -- including RunWeeklySync and RunDailySync, which had the
// identical exposure and no fix at all before this -- instead of needing a matching call at
// each one.
//
// Registered in serialGroups: CAMPMINDER_SEASON_ID is t.Setenv.
func TestRunSyncAndWaitSetsYearFromOrigin(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "2025")
	o := newTestOrchestrator(t)

	t.Run("origin.year == 0 resolves to the current season", func(t *testing.T) {
		spy := &yearSetterSpy{name: "current_spy"}
		o.RegisterService("current_spy", spy)
		origin := newBatch(triggerManual)
		o.registerBatch(origin.batchID)
		if err := o.runSyncAndWait(context.Background(), "current_spy", origin); err != nil {
			t.Fatalf("runSyncAndWait: %v", err)
		}
		if !spy.yearWasSet || spy.year != 2025 {
			t.Errorf("expected SetYear(2025), got yearWasSet=%v year=%d", spy.yearWasSet, spy.year)
		}
	})

	t.Run("origin.year != 0 sets that exact year", func(t *testing.T) {
		spy := &yearSetterSpy{name: "historical_spy"}
		o.RegisterService("historical_spy", spy)
		origin := newBatch(triggerHistorical).forYear(2020)
		o.registerBatch(origin.batchID)
		if err := o.runSyncAndWait(context.Background(), "historical_spy", origin); err != nil {
			t.Fatalf("runSyncAndWait: %v", err)
		}
		if !spy.yearWasSet || spy.year != 2020 {
			t.Errorf("expected SetYear(2020), got yearWasSet=%v year=%d", spy.yearWasSet, spy.year)
		}
	})
}

// TestWeeklySyncResetsAStaleExportYear pins the fifth stale-year path fix round 2 found:
// RunWeeklySync (the Sunday-2am cron) reaches Sync() through runSyncAndWait exactly like
// RunSyncWithOptions does, and before this fix nothing set the export's year there either.
// This is the exposure this task itself created -- CadenceWeeklyGlobal is what makes the
// export reachable from this queue at all, and the first thing a stale year kills is exactly
// the globals export that bit exists to add (Sync()'s globals gate is `m.year ==
// currentSeason`).
//
// Registered in serialGroups: GOOGLE_SHEETS_ENABLED and newExportWithFakeWriter's
// CAMPMINDER_SEASON_ID are both t.Setenv.
func TestWeeklySyncResetsAStaleExportYear(t *testing.T) {
	t.Setenv("GOOGLE_SHEETS_ENABLED", "true")

	app := newDryRunTestApp(t)
	o := NewOrchestrator(app)
	o.SetJobSpacing(0)

	exp := newExportWithFakeWriter(t) // constructed at year 2025 (CAMPMINDER_SEASON_ID)
	exp.SetYear(2020)                 // simulate a prior historical replay's leftover pin
	o.RegisterService("multi_workbook_export", exp)
	// divisions, not person_tag_defs -- see TestCurrentYearRunResetsAStaleExportYear's
	// identical note on why.
	o.RegisterService("divisions", &MockService{name: "divisions", stats: Stats{Created: 1}})

	if err := o.RunWeeklySync(context.Background()); err != nil {
		t.Fatalf("RunWeeklySync: %v", err)
	}

	if exp.year != 2025 {
		t.Errorf("the weekly-global cron must reset a stale export year, got %d, want 2025", exp.year)
	}
	if !fakeWriterGlobalsWritten(exp) {
		t.Error("expected globals to be exported once the year was correctly reset to the current season")
	}
}

// TestRunSingleSyncWithServiceRecordsBatchChange pins applyCompletionStatus call site 2:
// RunSingleSyncWithService must route its completion through recordBatchChange exactly like
// runSingleSyncInternal does, or a request-scoped run (kindred#1881/#2105's pattern) silently
// under-reports its own batch's changes.
func TestRunSingleSyncWithServiceRecordsBatchChange(t *testing.T) {
	t.Parallel()
	synctest.Test(t, func(t *testing.T) {
		o := NewOrchestrator(nil)

		// Registered explicitly: this test is about whether site 2 records correctly INTO a
		// real queue batch, which is a distinct question from whether an unregistered
		// RunSingleSyncWithService caller leaks (see
		// TestRunSingleSyncWithServiceDoesNotLeakIntoBatchChanged for that).
		svc := &mockYearService{name: "sessions", stats: Stats{Created: 4}}
		origin := newBatch(triggerManual)
		o.registerBatch(origin.batchID)
		if err := o.RunSingleSyncWithService(context.Background(), "sessions", svc, origin); err != nil {
			t.Fatalf("RunSingleSyncWithService: %v", err)
		}
		time.Sleep(50 * time.Millisecond)

		got := o.batchChangedCollections(origin.batchID)
		if !got["camp_sessions"] {
			t.Errorf("expected camp_sessions recorded via RunSingleSyncWithService's completion path, got %v", got)
		}
	})
}

// TestFinalizeSyncStatusRecordsBatchChange pins applyCompletionStatus call site 3.
// FinalizeSyncStatus is the odd one out: unlike the other two call sites it runs entirely
// under o.mu (see publishCompletedLocked), so recordBatchChange -- which takes the lock
// itself -- has to fire after the unlock. Getting that placement wrong deadlocks this test
// rather than merely failing an assertion.
func TestFinalizeSyncStatusRecordsBatchChange(t *testing.T) {
	t.Parallel()
	o := NewOrchestrator(nil)

	const batchID = "finalize-test-batch"
	o.registerBatch(batchID) // simulates the owning queue having registered it at start
	o.mu.Lock()
	o.runningJobs["persons"] = &Status{
		Type:      "persons",
		Status:    statusRunning,
		StartTime: time.Now(),
		BatchID:   batchID,
	}
	o.mu.Unlock()

	o.FinalizeSyncStatus("persons", Stats{Created: 3}, nil)

	got := o.batchChangedCollections(batchID)
	if !got["persons"] || !got["households"] {
		t.Errorf("expected persons+households recorded via FinalizeSyncStatus's completion path, got %v", got)
	}
}

// TestBatchChangedEntryDeletedWhenQueueCompletes pins C4: each queue's defer must delete its
// own batch's entry from batchChanged, or the map grows without bound in a long-lived
// container -- a smaller version of the exact problem this task exists to fix. Every subtest
// registers one real job name (so recordBatchChange has something to write) and asserts the
// map is empty again once the queue function returns.
func TestBatchChangedEntryDeletedWhenQueueCompletes(t *testing.T) {
	t.Parallel()

	assertEmpty := func(t *testing.T, o *Orchestrator) {
		t.Helper()
		o.mu.RLock()
		n := len(o.batchChanged)
		o.mu.RUnlock()
		if n != 0 {
			t.Errorf("expected batchChanged empty after the queue completed, got %d entries", n)
		}
	}

	t.Run("RunHourlySync", func(t *testing.T) {
		t.Parallel()
		// RunHourlySync has no *SyncRunning flag/defer of its own to piggyback on (see its
		// doc comment), so its batchChanged cleanup is a standalone defer added specifically
		// for this -- worth its own subtest rather than trusting it by association with the
		// other four.
		o := NewOrchestrator(nil)
		o.RegisterService("bunk_assignments", &MockService{name: "bunk_assignments", stats: Stats{Updated: 1}})

		if err := o.RunHourlySync(context.Background()); err != nil {
			t.Fatalf("RunHourlySync: %v", err)
		}
		assertEmpty(t, o)
	})

	t.Run("RunWeeklySync", func(t *testing.T) {
		t.Parallel()
		o := NewOrchestrator(nil)
		o.SetJobSpacing(0)
		o.RegisterService("person_tag_defs", &MockService{name: "person_tag_defs", stats: Stats{Created: 1}})

		if err := o.RunWeeklySync(context.Background()); err != nil {
			t.Fatalf("RunWeeklySync: %v", err)
		}
		assertEmpty(t, o)
	})

	t.Run("RunCustomValuesSync", func(t *testing.T) {
		t.Parallel()
		o := NewOrchestrator(nil)
		o.SetJobSpacing(0)
		// Both jobs run in parallel (see RunCustomValuesSync's doc comment) and its errors
		// are errors.Join'd rather than logged-and-continued like the other queues, so both
		// need a registered service or the run itself returns a non-nil error.
		o.RegisterService("person_custom_values", &MockService{name: "person_custom_values", stats: Stats{Created: 1}})
		o.RegisterService("household_custom_values", &MockService{name: "household_custom_values", stats: Stats{}})

		if err := o.RunCustomValuesSync(context.Background()); err != nil {
			t.Fatalf("RunCustomValuesSync: %v", err)
		}
		assertEmpty(t, o)
	})

	t.Run("RunDailySync", func(t *testing.T) {
		t.Parallel()
		// newDryRunTestApp seeds person_tag_defs so checkGlobalTablesEmpty's weekly-sync
		// bootstrap doesn't also fire and complicate the assertion.
		app := newDryRunTestApp(t)
		o := NewOrchestrator(app)
		o.SetJobSpacing(0)
		o.RegisterService("sessions", &MockService{name: "sessions", stats: Stats{Created: 1}})

		if err := o.RunDailySync(context.Background()); err != nil {
			t.Fatalf("RunDailySync: %v", err)
		}
		assertEmpty(t, o)
	})

	t.Run("RunSyncWithOptions current-year mode", func(t *testing.T) {
		t.Parallel()
		app := newDryRunTestApp(t)
		o := NewOrchestrator(app)
		o.SetJobSpacing(0)
		o.RegisterService("sessions", &MockService{name: "sessions", stats: Stats{Created: 1}})

		if err := o.RunSyncWithOptions(context.Background(), Options{
			Year:     0,
			Services: []string{"sessions"},
		}); err != nil {
			t.Fatalf("RunSyncWithOptions: %v", err)
		}
		assertEmpty(t, o)
	})

	// The historical branch (opts.Year > 0) is not exercised here: it requires a non-nil
	// baseClient, which no other test in this suite sets up either (see
	// TestRunSyncWithOptionsHonorsDryRun's "skips the nil-baseClient year-override branch").
	// Its defer adds delete(o.batchChanged, batch.batchID) in the exact same shape as the
	// current-year branch just above -- verified by code inspection, not a live test.
}

// =============================================================================
// Task 12 fix round 1: close the batchChanged leak, fail closed on the season
// =============================================================================

// TestRunSingleSyncDoesNotLeakIntoBatchChanged pins fix-round-1 correction #1 (Critical).
// applyCompletionStatus's three callers all route through recordBatchChange, so every
// completion -- not just a queue's -- used to write into batchChanged. RunSingleSync mints a
// fresh batch id (batch of one) per call and never registers or cleans it up, so before this
// fix every standalone run leaked one entry forever: the exact unbounded-growth bug this task
// exists to fix, reintroduced through the one path C4's "each queue's existing defer" wording
// excluded. registerBatch's gate is what closes it: recordBatchChange is now a no-op for any
// batch nothing registered.
func TestRunSingleSyncDoesNotLeakIntoBatchChanged(t *testing.T) {
	t.Parallel()
	o := newTestOrchestrator(t)
	o.RegisterService("sessions", &MockService{name: "sessions", stats: Stats{Created: 1}})

	if err := o.RunSingleSync(context.Background(), "sessions"); err != nil {
		t.Fatalf("RunSingleSync: %v", err)
	}
	waitForSyncToFinish(t, o, "sessions")

	o.mu.RLock()
	n := len(o.batchChanged)
	o.mu.RUnlock()
	if n != 0 {
		t.Errorf("expected batchChanged to hold no entries after a non-queue completion, got %d", n)
	}
}

// TestRunSingleSyncWithServiceDoesNotLeakIntoBatchChanged is
// TestRunSingleSyncDoesNotLeakIntoBatchChanged's twin for applyCompletionStatus call site 2 --
// the correction named RunSingleSyncWithService explicitly ("12+ call sites across api.go").
func TestRunSingleSyncWithServiceDoesNotLeakIntoBatchChanged(t *testing.T) {
	t.Parallel()
	synctest.Test(t, func(t *testing.T) {
		o := NewOrchestrator(nil)

		svc := &mockYearService{name: "sessions", stats: Stats{Created: 4}}
		origin := newBatch(triggerManual) // deliberately never registered
		if err := o.RunSingleSyncWithService(context.Background(), "sessions", svc, origin); err != nil {
			t.Fatalf("RunSingleSyncWithService: %v", err)
		}
		time.Sleep(50 * time.Millisecond)

		o.mu.RLock()
		n := len(o.batchChanged)
		o.mu.RUnlock()
		if n != 0 {
			t.Errorf("expected batchChanged to hold no entries after a non-queue completion, got %d", n)
		}
	})
}

// TestStandaloneRunFailsClosedOnUnresolvableSeason pins fix-round-1 correction #2 (Important).
// Swallowing ParseSeasonYear()'s error and proceeding would leave a YearSetter service pinned
// to whatever year a prior queue left on it -- the exact insufficiency Task 11 established as
// not good enough, and the reason RunSingleSync resets the year explicitly at all. A run that
// can't resolve the current season must refuse outright, matching every other season-resolving
// caller in this file (handleIndividualSync, the "unified" queue branch) and
// MultiWorkbookExport.Sync() itself.
func TestStandaloneRunFailsClosedOnUnresolvableSeason(t *testing.T) {
	o := newTestOrchestrator(t)
	exp := newExportWithFakeWriter(t) // sets CAMPMINDER_SEASON_ID=2025 momentarily; exp.year=2025
	o.RegisterService("multi_workbook_export", exp)

	exp.SetYear(2019)                    // leftover historical year from a prior queued run
	t.Setenv("CAMPMINDER_SEASON_ID", "") // now unresolvable

	err := o.RunSingleSync(context.Background(), "multi_workbook_export")
	if err == nil {
		t.Fatal("expected RunSingleSync to refuse when the current season can't be resolved")
	}
	if exp.year != 2019 {
		t.Errorf("a refused run must not touch the stale year, got %d, want 2019", exp.year)
	}
	if o.IsRunning("multi_workbook_export") {
		t.Error("a refused run must never start -- IsRunning should be false")
	}
}

// =============================================================================
// Task 13: delete the epilogue, queue the export
// =============================================================================

// TestExportRunsExactlyOnceInAFullRun is the regression guard for this task's sharpest risk:
// the deleted epilogue plus the new TriggerFullRun membership would double-export.
//
// GOOGLE_SHEETS_ENABLED must be set: multi_workbook_export's Gate (google.IsEnabled) is
// applied by available() inside GetDefaultUnifiedSyncJobs like every other gated row, so
// without it the job is filtered out of the full-run queue entirely and the count assertion
// below would be vacuously satisfied by n=0, not by the exactly-once property it's meant to
// pin.
func TestExportRunsExactlyOnceInAFullRun(t *testing.T) {
	t.Setenv("IS_DOCKER", "")
	t.Setenv("GOOGLE_SHEETS_ENABLED", "true")
	n := 0
	for _, id := range ResolveUnifiedSyncServices(DefaultService, true, true) {
		if id == "multi_workbook_export" {
			n++
		}
	}
	if n != 1 {
		t.Errorf("multi_workbook_export appears %d times in a full run's service LIST, want 1", n)
	}
	src := readSourceFile(t, "orchestrator.go")
	if strings.Contains(src, "Sync with options: Exporting to Google Sheets") {
		t.Error("the hardcoded export epilogue is still in RunSyncWithOptions")
	}

	// List membership cannot see a second execution path: checkGlobalTablesEmpty's
	// weekly-sync bootstrap (called from both RunDailySync and RunSyncWithOptions, on any
	// database with an empty person_tag_defs table -- a fresh deploy, or a database reset
	// mid-season) used to run RunWeeklySync, whose job list is GetWeeklySyncJobs() --
	// exactly the list multi_workbook_export joined via CadenceWeeklyGlobal this task added.
	// A fresh-DB full run would export once from the bootstrap and once from its own
	// service list -- two Sync() calls, invisible to the membership count above. Drive a
	// REAL run against a database with NO person_tag_defs rows (so the bootstrap actually
	// fires) and count executions directly, via a spy registered under the export's name
	// rather than the real *MultiWorkbookExport -- the derivation functions only care about
	// the registered NAME, not the concrete type.
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)

	o := NewOrchestrator(app)
	o.SetJobSpacing(0)

	spy := &MockService{name: "multi_workbook_export"}
	o.RegisterService("multi_workbook_export", spy)

	if err := o.RunSyncWithOptions(context.Background(), Options{Year: 0}); err != nil {
		t.Fatalf("RunSyncWithOptions: %v", err)
	}

	if got := spy.callCount.Load(); got != 1 {
		t.Errorf("multi_workbook_export.Sync() ran %d times in a full run, want 1 "+
			"(checkGlobalTablesEmpty's bootstrap must not export -- spec §3)", got)
	}
}

// TestEveryExportedCollectionHasASyncJob pins the invariant changed-only silently depends on.
// If an ExportConfig names a collection no job writes, that sheet becomes permanently
// unexportable and the only symptom is a "Skipping export - no sync changes" log line.
//
// The reverse is NOT required: staff_lookups maps to no exported collection, and that is
// correct -- it feeds lookups nothing exports.
func TestEveryExportedCollectionHasASyncJob(t *testing.T) {
	t.Parallel()
	written := map[string]bool{}
	for _, cols := range SyncJobToCollections {
		for _, c := range cols {
			written[c] = true
		}
	}
	configs := append(GetReadableGlobalExports(), GetReadableYearExports()...)
	if len(configs) == 0 {
		t.Fatal("no export configs -- this test would pass vacuously")
	}
	for _, cfg := range configs {
		if !written[cfg.Collection] {
			t.Errorf("exported collection %q is written by no sync job: changed-only export "+
				"will skip it forever", cfg.Collection)
		}
	}
}

// TestFullRunWithGoogleEnabledRejectsDryRun is the C4 mechanism check: once
// multi_workbook_export carries TriggerFullRun, a dry_run=true request against a full run
// must still be rejected outright, never silently skip the export, because MultiWorkbookExport
// implements no SetDryRun (DryRunnable) method. UnsupportedDryRunServices -- called
// synchronously by handleUnifiedSync before either the immediate or queued path starts, and
// again as RunSyncWithOptions' own defense-in-depth backstop -- is what stops it: this test
// pins that multi_workbook_export shows up in its result once it's actually part of the
// full-run service list, which it only is when Google Sheets is enabled.
func TestFullRunWithGoogleEnabledRejectsDryRun(t *testing.T) {
	t.Setenv("IS_DOCKER", "true")
	t.Setenv("GOOGLE_SHEETS_ENABLED", "true")

	o := NewOrchestrator(nil)
	// A MockService implements Service but not DryRunnable -- the same shape
	// *MultiWorkbookExport has (it declares no SetDryRun method).
	o.RegisterService("multi_workbook_export", &MockService{name: "multi_workbook_export"})

	services := ResolveUnifiedSyncServices(DefaultService, true, true)
	if !slices.Contains(services, "multi_workbook_export") {
		t.Fatal("multi_workbook_export must be part of a full run when Google Sheets is enabled")
	}

	got := o.UnsupportedDryRunServices(services)
	if !slices.Contains(got, "multi_workbook_export") {
		t.Errorf("expected multi_workbook_export in UnsupportedDryRunServices(full run), got %v", got)
	}
}

// TestHistoricalRunSetsTheExportsYear pins a regression this task's own change would
// otherwise introduce. The OLD hardcoded historical epilogue never touched the exporter's own
// .year field -- it called exporter.SyncForYears(ctx, []int{opts.Year}, false, changed), which
// takes the year as an explicit parameter. Sync(), the queued-job entry point used since this
// task, has no such parameter: it reads m.year directly for both the year-data export and the
// globals gate. RunSyncWithOptions' historical re-registration block re-registers a long list
// of services with year-specific clients, but never multi_workbook_export -- it stays the
// same long-lived singleton every other trigger shares -- so without an explicit SetYear call
// here, a historical replay of, say, 2020 would export against whatever year the singleton's
// .year field already held (almost certainly the current season), not the year being replayed.
//
// Registered in serialGroups: CAMPMINDER_PRIMARY_KEY and newExportWithFakeWriter's
// CAMPMINDER_SEASON_ID are both t.Setenv.
func TestHistoricalRunSetsTheExportsYear(t *testing.T) {
	t.Setenv("CAMPMINDER_PRIMARY_KEY", "test-key")

	app := newDryRunTestApp(t)
	o := NewOrchestrator(app)
	o.SetJobSpacing(0)

	client, err := campminder.NewClient(&campminder.Config{APIKey: "k", ClientID: "c", SeasonID: 2025})
	if err != nil {
		t.Fatalf("campminder.NewClient: %v", err)
	}
	o.baseClient = client

	exp := newExportWithFakeWriter(t) // constructed at year 2025 (CAMPMINDER_SEASON_ID)
	o.RegisterService("multi_workbook_export", exp)

	if err := o.RunSyncWithOptions(context.Background(), Options{
		Year:     2020,
		Services: []string{"multi_workbook_export"},
	}); err != nil {
		t.Fatalf("RunSyncWithOptions: %v", err)
	}

	if exp.year != 2020 {
		t.Errorf("a historical run must target the replayed year, got %d, want 2020", exp.year)
	}
}

// TestCurrentYearRunResetsAStaleExportYear is TestHistoricalRunSetsTheExportsYear's symmetric
// twin, pinning the risk that fix itself introduced (Task 13 fix round 1). The historical
// branch's SetYear(opts.Year) pins the shared, long-lived singleton away from the current
// season -- and before this fix, nothing in the current-year branch ever set it back. So the
// very next current-year unified run would read m.year still holding the stale historical
// year, export that year's workbook instead of the current one, and silently skip globals too
// (Sync()'s gate is `m.year == currentSeason`) -- with no error, just quietly stale data. This
// is the fourth instance of one hazard in this stage: a long-lived singleton with a read path
// that does not set (Task 11's standalone handler, Task 12's RunSingleSync, the historical
// branch, and now this) -- "whoever ran before us probably set it" is the assumption that
// failed every time.
//
// Drives it the way production actually would: pin the singleton to a historical year first
// (simulating a prior historical replay), then run a current-year unified sync that also
// writes a real change to a global collection (divisions) so the changed-collections
// filter doesn't itself suppress the globals write this test checks for -- an empty-but-non-nil
// filter means "export nothing", same as ChangedCollectionsAware's own nil-vs-empty contract.
//
// Registered in serialGroups: CAMPMINDER_PRIMARY_KEY and newExportWithFakeWriter's
// CAMPMINDER_SEASON_ID are both t.Setenv.
func TestCurrentYearRunResetsAStaleExportYear(t *testing.T) {
	t.Setenv("CAMPMINDER_PRIMARY_KEY", "test-key")

	app := newDryRunTestApp(t)
	o := NewOrchestrator(app)
	o.SetJobSpacing(0)

	client, err := campminder.NewClient(&campminder.Config{APIKey: "k", ClientID: "c", SeasonID: 2025})
	if err != nil {
		t.Fatalf("campminder.NewClient: %v", err)
	}
	o.baseClient = client

	exp := newExportWithFakeWriter(t) // constructed at year 2025 (CAMPMINDER_SEASON_ID)
	exp.SetYear(2020)                 // simulate a prior historical replay's leftover pin
	o.RegisterService("multi_workbook_export", exp)
	// divisions, not person_tag_defs: newExportSchemaApp only seeds a "divisions" collection
	// on the export's own throwaway app (its ExportConfig.Filter is "", so an unfiltered
	// query against a fieldless, rowless collection still succeeds and writes a sheet with
	// zero records) -- person_tag_defs isn't seeded there, so querying it errors and the
	// write is skipped regardless of the changed-collections filter, which would make this
	// assertion fail for a reason unrelated to what it's checking.
	o.RegisterService("divisions", &MockService{name: "divisions", stats: Stats{Created: 1}})

	if err := o.RunSyncWithOptions(context.Background(), Options{
		Year:     0, // current-year mode
		Services: []string{"divisions", "multi_workbook_export"},
	}); err != nil {
		t.Fatalf("RunSyncWithOptions: %v", err)
	}

	if exp.year != 2025 {
		t.Errorf("a current-year run must reset a stale export year, got %d, want 2025", exp.year)
	}
	if !fakeWriterGlobalsWritten(exp) {
		t.Error("expected globals to be exported once the year was correctly reset to the current season")
	}
}

// TestWeeklySyncJobsGatesExportOnGoogleEnabled and its sibling below pin a gap this task's
// change exposes: GetWeeklySyncJobs (orchestrator.go) reads jobsWithCadence directly instead
// of going through cadenceQueue, so it skips available()'s Gate filtering entirely. That was a
// no-op until now -- none of the five PhaseGlobal rows carries a Gate -- but multi_workbook_export
// gaining CadenceWeeklyGlobal makes it live: left unfixed, a google-disabled environment would
// have the Sunday-2am cron try to run an unregistered "multi_workbook_export" every week and
// log "sync service not found", exactly the failure available()'s own doc comment says
// uniform Gate filtering exists to prevent.
func TestWeeklySyncJobsGatesExportOnGoogleEnabled(t *testing.T) {
	t.Setenv("GOOGLE_SHEETS_ENABLED", "true")
	if !slices.Contains(GetWeeklySyncJobs(), "multi_workbook_export") {
		t.Error("expected multi_workbook_export in the weekly-global queue when Google Sheets is enabled")
	}
}

func TestWeeklySyncJobsGatesExportOnGoogleDisabled(t *testing.T) {
	t.Setenv("GOOGLE_SHEETS_ENABLED", "")
	if slices.Contains(GetWeeklySyncJobs(), "multi_workbook_export") {
		t.Error("expected multi_workbook_export gated OUT of the weekly-global queue when Google Sheets is disabled")
	}
}

// TestBatchChangedCollectionsEmptyWhenRegisteredButUntouched preserves a property the deleted
// TestOrchestrator_GetChangedCollections pinned ("empty when no completed syncs"): a batch
// nothing has recorded a change into yet answers with an empty, non-nil map -- never nil,
// which means something entirely different per ChangedCollectionsAware's own doc comment
// ("export everything").
func TestBatchChangedCollectionsEmptyWhenRegisteredButUntouched(t *testing.T) {
	t.Parallel()
	o := newTestOrchestrator(t)
	o.registerBatch("batch-empty")

	got := o.batchChangedCollections("batch-empty")
	if got == nil {
		t.Fatal("a registered batch must answer with a non-nil map, not nil")
	}
	if len(got) != 0 {
		t.Errorf("expected no changes recorded, got %v", got)
	}
}

// TestRecordBatchChangeIgnoresUnknownSyncType preserves a property the deleted
// TestOrchestrator_GetChangedCollections pinned ("handles unknown sync type gracefully"): a
// service name with no SyncJobToCollections entry must not panic and must contribute nothing.
func TestRecordBatchChangeIgnoresUnknownSyncType(t *testing.T) {
	t.Parallel()
	o := newTestOrchestrator(t)
	o.registerBatch("batch-unknown")

	o.recordBatchChange("batch-unknown", "unknown_sync_type", Stats{Created: 5})

	got := o.batchChangedCollections("batch-unknown")
	if len(got) != 0 {
		t.Errorf("expected an unmapped sync type to contribute nothing, got %v", got)
	}
}

// TestRecordBatchChangeMapsFamilyCampVariantsToSharedCollections preserves a property the
// deleted TestOrchestrator_GetChangedCollections pinned: the bounded daily family-camp jobs
// (kindred#2489) write the exact same person_custom_values/household_custom_values
// collections as their unrestricted counterparts, under distinct registered names --
// SyncJobToCollections has entries for both, and recordBatchChange must resolve them the same
// way the deleted GetChangedCollections used to.
func TestRecordBatchChangeMapsFamilyCampVariantsToSharedCollections(t *testing.T) {
	t.Parallel()
	o := newTestOrchestrator(t)
	o.registerBatch("batch-fc")

	o.recordBatchChange("batch-fc", "person_custom_values_family_camp", Stats{Created: 3, Updated: 1})
	o.recordBatchChange("batch-fc", "household_custom_values_family_camp", Stats{Created: 2})

	got := o.batchChangedCollections("batch-fc")
	if !got["person_custom_values"] {
		t.Error("expected person_custom_values recorded via the bounded family-camp job's completion")
	}
	if !got["household_custom_values"] {
		t.Error("expected household_custom_values recorded via the bounded family-camp job's completion")
	}
}
