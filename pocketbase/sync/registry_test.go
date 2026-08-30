package sync

import (
	"regexp"
	"slices"
	"strings"
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
