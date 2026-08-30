package main

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

// The Go suite was, for its whole history, the longest job in CI: `go test
// -race ./...` ran ~390s of a ~400s critical path. Almost none of that was test
// volume. The race detector costs ~4.5x and it used to pay that entirely
// serially -- the tree had exactly one t.Parallel() in it, inside a subtest, so
// no two top-level tests ever overlapped.
//
// This guard is what keeps that from coming back one test at a time. A newly
// added serial test does not fail anything, does not show up in review, and
// costs a few seconds forever; a hundred of them put the job back where it
// started. So sync/ and lodging/ -- the two packages that carried ~430s of the
// ~470s -- are held to the rule here, and the tests that genuinely cannot be
// parallel are listed below with the reason rather than left to look like an
// oversight.
var parallelGuardPackages = []string{"sync", "lodging"}

// serialGroups names every top-level test allowed to skip t.Parallel(),
// grouped by the reason it cannot be parallel.
//
// Adding a line here is a real cost, so it needs a real reason. Only two
// exist:
//
//   - t.Setenv: the testing package panics outright on Setenv+Parallel, since
//     the environment is process-global and a parallel test would leak its
//     value into whatever else is running. Threading the value through the
//     code under test instead of reading os.Getenv is the fix, not this list.
//   - a package-level variable the test swaps: same problem, caught by -race
//     rather than by a panic.
//
// Grouping rather than one entry per test is not only shorter -- it puts the
// reason somewhere a reader will actually read it, and makes a group that has
// grown suspiciously long visible as such.
var serialGroups = []struct {
	pkg    string
	reason string
	tests  []string
}{
	{
		pkg:    "sync",
		reason: "t.Setenv: exercises CAMPMINDER_SEASON_ID parsing itself",
		tests: []string{
			"TestParseSeasonYear_Valid",
			"TestParseSeasonYear_Missing",
			"TestParseSeasonYear_NonNumeric",
			"TestParseSeasonYear_BelowRange",
			"TestParseSeasonYear_AboveRange",
			"TestParseSeasonYear_Boundaries",
			"TestActiveSeasonYearFailsClosedWhenUnset",
			"TestExportFilterNilVersusEmpty",
			"TestExportGlobalsOnCurrentYearOnly",
			"TestSyncGlobalsFailureIsSoftYearDataFailureIsHard",
			"TestHandleMultiWorkbookExportDefaultBranchResetsYear",
			"TestHandleMultiWorkbookExportDefaultBranchClearsFilter",
			"TestHandleMultiWorkbookExportDefaultBranchUsesTheSeasonNotTheWallClock",
			"TestHandleMultiWorkbookExportYearsValidationBoundsBySeasonNotWallClock",
			"TestStandaloneRunClearsTheFilter",
			"TestStandaloneRunResetsYear",
			"TestStandaloneRunFailsClosedOnUnresolvableSeason",
		},
	},
	{
		// #2289 review: the eight orphan-sweep tests migrated onto
		// s.ActiveSeasonYear so they could run in parallel, but that left the
		// #2028 year gate itself (year != active) and production's actual
		// CAMPMINDER_SEASON_ID fallback path with zero direct coverage --
		// s.ActiveSeasonYear always overrides both in every other test in this
		// file. These two drive Sync() with ActiveSeasonYear left at 0, so
		// they need the real environment variable.
		pkg:    "sync",
		reason: "t.Setenv: CAMPMINDER_SEASON_ID drives the #2028 gate itself, not the ActiveSeasonYear override",
		tests: []string{
			"TestLodgingAssignmentsSyncSkipsOrphanSweepWhenSeasonUnresolvable",
			"TestLodgingAssignmentsSyncDeletesOrphansViaEnvFallback",
		},
	},
	{
		pkg:    "sync",
		reason: "t.Setenv: asserts the CAMPMINDER_SEASON_ID fallback specifically",
		tests: []string{
			"TestReconcileLifecycleSync_FallsBackToSeasonEnv",
			"TestReconcileLifecycleSync_RejectsMissingYearEnv",
		},
	},
	{
		pkg:    "sync",
		reason: "t.Setenv: PROCESS_REQUESTS_TIMEOUT_MINUTES",
		tests:  []string{"TestGetProcessRequestsTimeout"},
	},
	{
		pkg:    "sync",
		reason: "t.Setenv: IS_DOCKER drives ResolveUnifiedSyncServices' process_requests append",
		tests:  []string{"TestCurrentYearDefaultSyncStillRejectsDryRun"},
	},
	{
		pkg:    "sync",
		reason: "t.Setenv: API_URL points at a per-test httptest server",
		tests:  []string{"TestBuildNormalizationLookupCompositeKeyDedup"},
	},
	{
		// campminder.NewClient reads CAMPMINDER_PRIMARY_KEY from the environment
		// (same reason as the block below), so building the real client this
		// test needs for GetSeasonID() costs a t.Setenv.
		pkg:    "sync",
		reason: "t.Setenv: campminder.NewClient reads CAMPMINDER_PRIMARY_KEY",
		tests: []string{
			"TestAttendeesLogStatusChangeDryRunWritesNothing",
			"TestProcessAssignment_MissingPersonID_IsRejected",
			"TestProcessAssignment_SaveFailure_IsInfraError",
			"TestProcessEnrollment_MissingSessionID_IsRejected",
			"TestProcessEnrollment_SaveFailure_IsInfraError",
			"TestPersonCustomFieldValuesSync_CompletionLogUsesBoundedJobName",
			"TestHouseholdCustomFieldValuesSync_CompletionLogUsesBoundedJobName",
		},
	},
	{
		// These four drive deleteOrphans, which reads the season through
		// s.Client.GetSeasonID(). Client is a concrete *campminder.Client and
		// campminder.NewClient reads CAMPMINDER_PRIMARY_KEY from the
		// environment, so building one costs a t.Setenv.
		//
		// The guard's own advice applies here -- threading the key through
		// NewClient instead of reading os.Getenv would parallelise all four --
		// but that is an edit to the production CampMinder constructor, and it
		// does not belong in a bunk-assignment protection fix. Tracked rather
		// than smuggled in.
		//
		// The three tests in this file that do NOT sweep need no client and
		// are parallel.
		pkg:    "sync",
		reason: "t.Setenv: campminder.NewClient reads CAMPMINDER_PRIMARY_KEY",
		tests: []string{
			"TestProtectThenSweepOrphans_DismissedStaffAssignmentSurvivesSweep",
			"TestProtectThenSweepOrphans_ProtectionFailureAbortsSweep",
			"TestProtectThenSweepOrphans_ProtectionSuccessStillSweeps",
			"TestProtectThenSweepOrphans_SessionLookupFailureAbortsSweep",
			"TestProtectThenSweepOrphans_SweepRefusalIsCountedAndReturned",
		},
	},
	{
		// handleUnifiedSync and processQueuedSyncs both call ParseSeasonYear(), which reads
		// CAMPMINDER_SEASON_ID directly via os.Getenv -- these HTTP- and queue-level dry_run
		// tests (kindred#2334) need a deterministic season to resolve their year=2025 requests
		// against, so each sets it with t.Setenv.
		pkg:    "sync",
		reason: "t.Setenv: CAMPMINDER_SEASON_ID makes handleUnifiedSync's year resolution deterministic",
		tests: []string{
			"TestHandleUnifiedSyncRejectsUnsupportedDryRun",
			"TestHandleUnifiedSyncRejectsUnroutedService",
			"TestHandleUnifiedSyncAcceptsARoutedService",
			"TestHandleUnifiedSyncImmediatePathEchoesDryRun",
			"TestHandleUnifiedSyncQueuedPathEchoesDryRun",
			"TestProcessQueuedSyncsUnifiedHonorsDryRun",
		},
	},
	{
		// captureSweepLogs (orphan_sweep_test.go) swaps slog's default handler,
		// which is process-global -- the exact second reason this list exists,
		// and the same one already recorded for lodging's captureLogs below.
		//
		// It slipped through because slog.SetDefault is internally atomic, so
		// -race sees nothing: the corruption is logical, not a data race. Two
		// of these tests assert on the ABSENCE of a log line, so a parallel
		// sibling that grabs the global mid-run writes its output into the
		// wrong buffer and the assertion reads someone else's sweep. Measured
		// on `go test ./sync/ -run TestBaseDeleteOrphans`: 2 failures in 12
		// runs with three parallel capturers, 0 in 36 with these serial.
		pkg:    "sync",
		reason: "captureSweepLogs swaps the process-global slog default",
		tests: []string{
			"TestBaseDeleteOrphansCountsOnlyCompletedDeletes",
			"TestBaseDeleteOrphansFromPreloadedCountsOnlyCompletedDeletes",
			"TestBaseDeleteOrphansWarnsWhenNothingCanBeKeyed",
			"TestFamilyCampSweepLogsProtectedNamelessAdultsFor2018",
			"TestGateVerdictWarnsOnUnrecognizedAnswerWithoutLoggingIt",
			"TestIsDuplicateStaffStatus",
			"TestLoadPersonCustomValuesCountsAndLogsUnmappedAppFields",
			"TestLoadPersonCustomValuesCountsAndLogsUnmappedFields",
			"TestLoadPersonCustomValuesNoDiscardsMeansNoWarnAppLog",
			"TestLoadPersonCustomValuesNoDiscardsMeansNoWarnLog",
			"TestLoadPersonCustomValuesRoutesTheFourLive2026FieldsAndDoesNotSkipThem",
			"TestStaffApplicationsSyncLogsStaffGateDropsOnce",
			"TestStaffVehicleInfoSyncLogsStaffGateDropsOnce",
			"TestStrandedAssignmentCleanupDryRunLodgingLogReportsSimulatedSweep",
		},
	},
	{
		// registryBasePath / registryAbsoluteRoots (lodging/registry.go) are
		// the only true data races the detector found when the whole tree was
		// made parallel at once: withRegistryBasePath writes them, and every
		// other registry test reads them through the path resolver.
		//
		// Leaving the writers serial is enough to fix it, and costs nothing:
		// Go runs every non-parallel test to completion before releasing the
		// parallel ones, so these finish and restore the globals before any
		// reader starts.
		pkg:    "lodging",
		reason: "swaps the registryBasePath / registryAbsoluteRoots globals",
		tests: []string{
			"TestRegistryFilePresentTrueWhenFileExistsUnderWorkingDirectory",
			"TestRegistryFilePresentTrueViaAbsoluteRoot",
			"TestRegistryFilePresentFalseWhenNoConfigAnywhere",
			"TestSeedRegistryResolvesConfigUnderTheWorkingDirectory",
			"TestSeedRegistryResolvesAbsoluteConfigRoot",
			"TestSeedRegistryWithNoConfigAnywhereIsANoOp",
			"TestSeedRegistryFileErrorIsNotTaggedAsARowCheckFailure",
			"TestClassifyShareability",
			// kindred#2451: these three reach the same globals (the last two
			// via withYearFixtureRegistry -> withRegistryBasePath) and were
			// still running t.Parallel() -- that gap is what let
			// TestSeedRegistryLeavesNothingBehindWhenAPassFails observe
			// another test's temp tree and fail with "0 units after the
			// retry; want 2" instead of a race report.
			"TestSeedRegistryStampsTheSeason",
			"TestFindByCodeAndYearIgnoresOtherYears",
			"TestSeedRegistryLeavesNothingBehindWhenAPassFails",
		},
	},
	{
		// The Family Camp roster stamps its tab name -- and computes ages -- in
		// camp-local time, defaulting to Pacific when TZ is unset (kindred#2433).
		// TZ is process-global and read through time.LoadLocation, so these four
		// have to set it for real; there is no injection seam that would still be
		// testing the fallback. The export path takes an injected clock precisely
		// so that only the timezone tests need this, not the other twelve.
		pkg:    "sync",
		reason: "t.Setenv: TZ drives the camp-local timezone fallback itself",
		tests: []string{
			"TestCampLocationDefaultsToPacific",
			"TestCampLocationFallsBackOnAnUnknownZone",
			"TestCampLocationHonoursTZ",
			"TestRosterExportStampsAgesInCampLocalTime",
		},
	},
	{
		// google.IsEnabled() reads GOOGLE_SHEETS_ENABLED from the process
		// environment, and this test asserts that a staff-triggered export
		// REFUSES when it is off rather than degrading silently as the sync path
		// does. There is no seam short of the env var: IsEnabled is what the
		// production constructor calls.
		pkg:    "sync",
		reason: "t.Setenv: GOOGLE_SHEETS_ENABLED drives the export's refusal itself",
		tests: []string{
			"TestNewRosterExporterForAppRefusesWhenSheetsIsDisabled",
		},
	},
	{
		pkg:    "sync",
		reason: "t.Setenv: IS_DOCKER drives the process_requests Gate in cadenceQueue",
		tests:  []string{"TestDailyQueueDerivation", "TestDailyQueueGate", "TestUnifiedRunDerivation"},
	},
	{
		pkg:    "sync",
		reason: "t.Setenv: IS_DOCKER and GOOGLE_SHEETS_ENABLED drive Gate filtering in the derived queues themselves",
		tests:  []string{"TestExportRunsExactlyOnceInAFullRun"},
	},
	{
		pkg:    "sync",
		reason: "t.Setenv: newExportWithFakeWriter's CAMPMINDER_SEASON_ID",
		tests:  []string{"TestSingleServiceUnifiedRunExportsEverything"},
	},
	{
		pkg:    "sync",
		reason: "t.Setenv: CAMPMINDER_PRIMARY_KEY (campminder.NewClient) and newExportWithFakeWriter's CAMPMINDER_SEASON_ID",
		tests: []string{
			"TestHistoricalRunSetsTheExportsYear",
			"TestCurrentYearRunResetsAStaleExportYear",
		},
	},
	{
		pkg:    "sync",
		reason: "t.Setenv: CAMPMINDER_SEASON_ID drives runSyncAndWait's own season resolution",
		tests:  []string{"TestRunSyncAndWaitSetsYearFromOrigin"},
	},
	{
		pkg:    "sync",
		reason: "t.Setenv: GOOGLE_SHEETS_ENABLED and newExportWithFakeWriter's CAMPMINDER_SEASON_ID",
		tests: []string{
			"TestWeeklySyncResetsAStaleExportYear",
			"TestDryRunFullRunSkipsExportVisibly",
		},
	},
	{
		pkg:    "sync",
		reason: "t.Setenv: GOOGLE_SHEETS_ENABLED drives multi_workbook_export's Gate in GetWeeklySyncJobs",
		tests: []string{
			"TestWeeklySyncJobsGatesExportOnGoogleEnabled",
			"TestWeeklySyncJobsGatesExportOnGoogleDisabled",
		},
	},
	{
		// captureStdout redirects the process's os.Stdout; captureLogs swaps
		// slog's default handler. Both are process-global, so a parallel test
		// would capture some other test's output instead of its own.
		pkg:    "lodging",
		reason: "captureStdout / captureLogs swap process-global output",
		tests: []string{
			"TestGuardUnitYearSkipsAnAbsentCollection",
			"TestIgnoringAPartylessRowDoesNotAttemptAReplay",
			"TestMappingAPartylessRowStillAttemptsAReplay",
			"TestMultiRelationAnyMatchFilter",
			"TestReplayOnResolveFiresOnceNotOnItsOwnResave",
			"TestReplayRefusalDoesNotBlockTheTick",
			"TestSeedRegistryAbsentFileIsANoOp",
			"TestSeedRegistrySecondSeasonIsANoOpOnceOneSeasonHasRows",
		},
	},
}

// serialTests flattens serialGroups to "<package>.<TestName>" -> reason.
func serialTests() map[string]string {
	flat := map[string]string{}
	for _, group := range serialGroups {
		for _, name := range group.tests {
			flat[group.pkg+"."+name] = group.reason
		}
	}
	return flat
}

// topLevelTest is one `func TestX(t *testing.T)` and whether its body calls
// t.Parallel() directly (a call inside a subtest closure does not count -- that
// is what the tree already had, and it parallelised nothing).
type topLevelTest struct {
	key      string
	file     string
	line     int
	parallel bool
}

func collectTopLevelTests(t *testing.T) []topLevelTest {
	t.Helper()

	var found []topLevelTest
	for _, pkg := range parallelGuardPackages {
		entries, err := os.ReadDir(pkg)
		if err != nil {
			t.Fatalf("read %s: %v", pkg, err)
		}
		for _, entry := range entries {
			if !strings.HasSuffix(entry.Name(), "_test.go") {
				continue
			}
			path := filepath.Join(pkg, entry.Name())
			fset := token.NewFileSet()
			parsed, err := parser.ParseFile(fset, path, nil, 0)
			if err != nil {
				t.Fatalf("parse %s: %v", path, err)
			}
			for _, decl := range parsed.Decls {
				fn, ok := decl.(*ast.FuncDecl)
				if !ok || fn.Recv != nil || !strings.HasPrefix(fn.Name.Name, "Test") {
					continue
				}
				if !takesTestingT(fn) {
					continue
				}
				found = append(found, topLevelTest{
					key:      pkg + "." + fn.Name.Name,
					file:     path,
					line:     fset.Position(fn.Pos()).Line,
					parallel: bodyCallsParallel(fn),
				})
			}
		}
	}
	return found
}

// takesTestingT keeps benchmarks, fuzz targets and helpers out of the census.
func takesTestingT(fn *ast.FuncDecl) bool {
	params := fn.Type.Params.List
	if len(params) != 1 {
		return false
	}
	star, ok := params[0].Type.(*ast.StarExpr)
	if !ok {
		return false
	}
	sel, ok := star.X.(*ast.SelectorExpr)
	if !ok {
		return false
	}
	pkg, ok := sel.X.(*ast.Ident)
	return ok && pkg.Name == "testing" && sel.Sel.Name == "T"
}

// bodyCallsParallel looks only at the function's own statement list, so a
// t.Parallel() inside a t.Run closure is correctly not counted.
func bodyCallsParallel(fn *ast.FuncDecl) bool {
	if fn.Body == nil {
		return false
	}
	for _, stmt := range fn.Body.List {
		expr, ok := stmt.(*ast.ExprStmt)
		if !ok {
			continue
		}
		call, ok := expr.X.(*ast.CallExpr)
		if !ok {
			continue
		}
		sel, ok := call.Fun.(*ast.SelectorExpr)
		if !ok || sel.Sel.Name != "Parallel" {
			continue
		}
		if recv, ok := sel.X.(*ast.Ident); ok && recv.Name == "t" {
			return true
		}
	}
	return false
}

func TestSyncAndLodgingTestsRunInParallel(t *testing.T) {
	t.Parallel()

	var missing []string
	for _, tc := range collectTopLevelTests(t) {
		if tc.parallel {
			continue
		}
		if _, exempt := serialTests()[tc.key]; exempt {
			continue
		}
		missing = append(missing, fmt.Sprintf("%s:%d: %s", tc.file, tc.line, tc.key))
	}
	sort.Strings(missing)

	if len(missing) > 0 {
		t.Errorf(
			"%d top-level test(s) in %s do not call t.Parallel().\n"+
				"Add t.Parallel() as the first statement, or -- if the test genuinely "+
				"cannot be parallel -- add it to serialTests with the reason:\n  %s",
			len(missing), strings.Join(parallelGuardPackages, "/"), strings.Join(missing, "\n  "),
		)
	}
}

// A stale exemption is worse than none: it reads as "this test cannot be
// parallel" long after whatever blocked it was fixed, and nothing ever
// rechecks it. So the list has to stay exactly as long as its reasons.
func TestSerialTestExemptionsAreAllStillNeeded(t *testing.T) {
	t.Parallel()

	byKey := map[string]topLevelTest{}
	for _, tc := range collectTopLevelTests(t) {
		byKey[tc.key] = tc
	}

	var stale []string
	for key, reason := range serialTests() {
		tc, exists := byKey[key]
		switch {
		case !exists:
			stale = append(stale, fmt.Sprintf("%s: no such test (renamed or deleted) -- reason was %q", key, reason))
		case tc.parallel:
			stale = append(stale, fmt.Sprintf("%s: now calls t.Parallel(), drop the exemption", key))
		case strings.TrimSpace(reason) == "":
			stale = append(stale, fmt.Sprintf("%s: exemption has no reason", key))
		}
	}
	sort.Strings(stale)

	if len(stale) > 0 {
		t.Errorf("%d stale entr(ies) in serialTests:\n  %s", len(stale), strings.Join(stale, "\n  "))
	}
}
