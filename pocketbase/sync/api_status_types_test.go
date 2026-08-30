package sync

import (
	"slices"
	"testing"
)

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
		"UnifiedSyncJobs":           GetDefaultUnifiedSyncJobs(true, true),
		"UnifiedSyncJobsNoCustom":   GetDefaultUnifiedSyncJobs(false, true),
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
//
// The GetWeeklySyncJobs union is now redundant and kept only as a second, independent
// spelling of the same claim: the five global definition jobs had no syncJobMeta row when
// this was written and were exempted for that reason, and they gained one in Stage 3 Task 9.
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
// getDailySyncJobs(), whose syncJobMeta declaration order pocketbase/CLAUDE.md names as the
// source of truth for sync order.
//
// This subsumes an earlier version that only bracketed the bounded family-camp pair
// between "financial_transactions" and "family_camp_derived" using bare map lookups. Bare
// lookups made it fragile in the way that matters: a missing key reads as index 0, so if
// an anchor name ever went stale the comparison silently stopped firing and the test
// passed through a severe misplacement. Comparing whole subsequences needs no anchors.
//
// Since statusSyncTypes became allJobIDs() the two sides are no longer a hand-written list
// and a derivation, but two views of one table -- so what is left to pin is the DIFFERENCE
// between them, which is orderQueue: getDailySyncJobs applies it, the payload does not, and
// it moves exactly one job (stranded_assignment_cleanup, dead-last, #1416/#1417). Dropping
// that one job from both sides therefore leaves an assertion that still fails if any OTHER
// job's position diverges -- which is what a second orderQueue exception, or a registry row
// moved without moving its neighbors, would look like. orderQueue's own doc comment says a
// second exception must never be added; this is the test that notices if one is.
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

	const movedByOrderQueue = "stranded_assignment_cleanup"
	if daily[len(daily)-1] != movedByOrderQueue {
		t.Fatalf("getDailySyncJobs no longer ends with %s, so orderQueue is not the only "+
			"difference between the two orders and this test's exemption is wrong; got %q",
			movedByOrderQueue, daily[len(daily)-1])
	}
	wantOrder := slices.DeleteFunc(slices.Clone(daily), func(id string) bool {
		return id == movedByOrderQueue
	})
	assertSeqIgnoring(t, "daily subset of the status payload", got, wantOrder, movedByOrderQueue)
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
