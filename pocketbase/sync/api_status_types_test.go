package sync

import "testing"

// The status payload is what the client can SEE. A job missing from it has no per-job
// entry, and on a run path that sets no run-type flag that is fatal: `useSyncStatusAPI`'s
// `refetchInterval` keeps polling while `_daily_sync_running`/`_historical_sync_running`
// is set OR some per-job entry reports running/pending. RunSyncSequence -- the Refresh
// Housing and Refresh Bunking path -- sets NEITHER flag, so there the per-job entry is
// the only signal and polling STOPS mid-run.
//
// That is not hypothetical: `person_custom_values_family_camp` and
// `household_custom_values_family_camp` were absent, and they are 13 of the family-camp
// refresh chain's 13.5 minutes. A running-state UI built on the status payload would have
// shown ~24s of progress, gone idle for thirteen minutes, and missed the cutover entirely
// (kindred#2478 section 4.2c).
//
// These assert the INVARIANT rather than the job names, so the next job added to ANY
// sequence and forgotten here fails loudly instead of going dark.

// everySyncSequence is every job list the orchestrator can run. statusSyncTypes must be a
// superset of all of them -- pinning only the daily and family-camp lists would leave a
// job added to, say, GetRefreshBunkingJobs just as invisible as the two this test was
// written for. getDailySyncJobs' tail is environment-dependent (process_requests only
// under IS_DOCKER, multi_workbook_export only when Google is enabled), which is safe
// here: statusSyncTypes lists both unconditionally, so the checked set only ever shrinks.
func everySyncSequence() map[string][]string {
	return map[string][]string{
		"getDailySyncJobs":          getDailySyncJobs(),
		"GetWeeklySyncJobs":         GetWeeklySyncJobs(),
		"GetRefreshBunkingJobs":     GetRefreshBunkingJobs(),
		"GetRefreshFamilyCampJobs":  GetRefreshFamilyCampJobs(),
		"GetCustomValuesSyncJobs":   GetCustomValuesSyncJobs(),
		"UnifiedSyncJobs":           GetDefaultUnifiedSyncJobs(true),
		"UnifiedSyncJobsNoCustom":   GetDefaultUnifiedSyncJobs(false),
		"ResolveUnifiedCurrentYear": ResolveUnifiedSyncServices(DefaultService, true, true),
		"ResolveUnifiedHistorical":  ResolveUnifiedSyncServices(DefaultService, true, false),
	}
}

func publishedSyncTypes() map[string]bool {
	published := make(map[string]bool)
	for _, name := range statusSyncTypes() {
		published[name] = true
	}
	return published
}

func TestStatusSyncTypesCoversEverySequence(t *testing.T) {
	t.Parallel()
	published := publishedSyncTypes()
	for sequence, jobs := range everySyncSequence() {
		for _, job := range jobs {
			if !published[job] {
				t.Errorf("%s job %q is absent from the sync-status payload: it has no per-job "+
					"status, so on a flag-less RunSyncSequence path polling stops while it works "+
					"and its completion is never detected", sequence, job)
			}
		}
	}
}

// statusSyncTypes must not list a name no service is registered under -- a typo here is
// silent, showing as a row stuck permanently at "idle" rather than as any kind of error.
// The five weekly global-definition jobs are exempt: they are real registered services but
// are deliberately absent from syncJobMeta, which classifies only the phased jobs.
func TestStatusSyncTypesHasNoUnknownJobs(t *testing.T) {
	t.Parallel()
	known := make(map[string]bool)
	for _, meta := range GetJobMeta() {
		known[meta.ID] = true
	}
	for _, job := range GetWeeklySyncJobs() {
		known[job] = true
	}
	for _, name := range statusSyncTypes() {
		if !known[name] {
			t.Errorf("sync-status payload publishes %q, which is not a registered sync job: "+
				"the row will sit at \"idle\" forever", name)
		}
	}
}

func TestStatusSyncTypesHasNoDuplicates(t *testing.T) {
	t.Parallel()
	seen := make(map[string]bool)
	for _, name := range statusSyncTypes() {
		if seen[name] {
			t.Errorf("duplicate entry %q in statusSyncTypes", name)
		}
		seen[name] = true
	}
}

// The list's order is documentation, not protocol -- the payload is a JSON object keyed by
// job name. But it is documentation that goes stale silently, so it is pinned against
// orderedJobs, which pocketbase/CLAUDE.md names as the source of truth for sync order.
//
// This subsumes an earlier version that only bracketed the bounded family-camp pair
// between "financial_transactions" and "family_camp_derived" using bare map lookups. Bare
// lookups made it fragile in the way that matters: a missing key reads as index 0, so if
// an anchor name ever went stale the comparison silently stopped firing and the test
// passed through a severe misplacement. Comparing whole subsequences needs no anchors.
func TestStatusSyncTypesMatchesDailySyncOrder(t *testing.T) {
	t.Parallel()
	daily := getDailySyncJobs()
	inDaily := make(map[string]bool, len(daily))
	for _, job := range daily {
		inDaily[job] = true
	}

	var got []string
	for _, name := range statusSyncTypes() {
		if inDaily[name] {
			got = append(got, name)
		}
	}

	if len(got) != len(daily) {
		t.Fatalf("statusSyncTypes covers %d of the %d daily jobs; "+
			"TestStatusSyncTypesCoversEverySequence names which are missing", len(got), len(daily))
	}
	for i := range daily {
		if got[i] != daily[i] {
			t.Errorf("daily job order diverges at position %d: statusSyncTypes has %q, "+
				"getDailySyncJobs runs %q.\n  statusSyncTypes (daily subset): %v\n  getDailySyncJobs:              %v",
				i, got[i], daily[i], got, daily)
			break
		}
	}
}

// The bounded pair's placement is the one ordering fact with a stated reason, so it is
// pinned on its own terms as well: after the source jobs that feed it, before the
// transform phase that reads what it wrote.
func TestStatusSyncTypesOrdersTheBoundedPairBeforeTheTransforms(t *testing.T) {
	t.Parallel()
	index := make(map[string]int)
	for i, name := range statusSyncTypes() {
		index[name] = i
	}

	mustIndex := func(name string) int {
		t.Helper()
		i, ok := index[name]
		if !ok {
			t.Fatalf("%q is absent from statusSyncTypes, so its ordering cannot be checked", name)
		}
		return i
	}

	source := mustIndex("financial_transactions")
	transform := mustIndex("family_camp_derived")
	for _, bounded := range []string{"person_custom_values_family_camp", "household_custom_values_family_camp"} {
		at := mustIndex(bounded)
		if at <= source {
			t.Errorf("%q at %d should follow the source jobs (financial_transactions at %d)", bounded, at, source)
		}
		if at >= transform {
			t.Errorf("%q at %d must precede family_camp_derived at %d, which reads what it writes", bounded, at, transform)
		}
	}
}
