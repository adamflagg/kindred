package sync

import "testing"

// The status payload is what the client can SEE. A job missing from it is
// invisible to `useSyncStatusAPI`, whose `refetchInterval` returns false when
// nothing reports running -- so polling STOPS while that job runs and a
// completion is never detected.
//
// That is not hypothetical: `person_custom_values_family_camp` and
// `household_custom_values_family_camp` were absent, and they are 13 of the
// family-camp refresh chain's 13.5 minutes. A running-state UI built on the
// status payload would have shown ~24s of progress, gone idle for thirteen
// minutes, and missed the cutover entirely (kindred#2478 section 4.2c).
//
// These assert the INVARIANT rather than the two names, so the next job added
// to a sequence and forgotten here fails loudly instead of going dark.

func TestStatusSyncTypesCoversEveryDailyJob(t *testing.T) {
	t.Parallel()
	published := make(map[string]bool)
	for _, name := range statusSyncTypes() {
		published[name] = true
	}
	for _, job := range getDailySyncJobs() {
		if !published[job] {
			t.Errorf("daily job %q is absent from the sync-status payload: the client cannot see it run, "+
				"so polling stops while it works and its completion is never detected", job)
		}
	}
}

func TestStatusSyncTypesCoversEveryFamilyCampRefreshJob(t *testing.T) {
	t.Parallel()
	published := make(map[string]bool)
	for _, name := range statusSyncTypes() {
		published[name] = true
	}
	for _, job := range GetRefreshFamilyCampJobs() {
		if !published[job] {
			t.Errorf("refresh-family-camp job %q is absent from the sync-status payload; "+
				"the Refresh Housing running state cannot observe it", job)
		}
	}
}

// The two bounded jobs belong with the daily sequence's own ordering: after the
// source jobs, before the transform phase that reads what they wrote.
func TestStatusSyncTypesOrdersTheBoundedPairBeforeTheTransforms(t *testing.T) {
	t.Parallel()
	index := map[string]int{}
	for i, name := range statusSyncTypes() {
		index[name] = i
	}
	for _, bounded := range []string{"person_custom_values_family_camp", "household_custom_values_family_camp"} {
		if index[bounded] <= index["financial_transactions"] {
			t.Errorf("%q should follow the source jobs", bounded)
		}
		if index[bounded] >= index["family_camp_derived"] {
			t.Errorf("%q must precede family_camp_derived, which reads what it writes", bounded)
		}
	}
}
