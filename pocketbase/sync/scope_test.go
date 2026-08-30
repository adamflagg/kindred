package sync

import (
	"regexp"
	"slices"
	"strings"
	"testing"
)

// TestScopedID pins the one rule that generates a scoped service name. Every other site that
// needs a scoped id must call this rather than spelling the string, because the id is what
// sync_runs, runningJobs, lastCompletedStatus and the status payload are all keyed by.
func TestScopedID(t *testing.T) {
	t.Parallel()

	if got := scopedID(serviceNamePersonCustomValues, ScopeAll); got != serviceNamePersonCustomValues {
		t.Errorf("ScopeAll must not appear in an id, got %q", got)
	}
	want := "person_custom_values_family_camp"
	if got := scopedID(serviceNamePersonCustomValues, ScopeFamilyCamp); got != want {
		t.Errorf("scopedID(family_camp) = %q, want %q", got, want)
	}
}

// TestJobScopeAndBase pins the reverse lookups against the real registry.
func TestJobScopeAndBase(t *testing.T) {
	t.Parallel()

	cases := []struct {
		id        string
		wantScope Scope
		wantBase  string
	}{
		{"person_custom_values", ScopeAll, "person_custom_values"},
		{"person_custom_values_family_camp", ScopeFamilyCamp, "person_custom_values"},
		{"household_custom_values_family_camp", ScopeFamilyCamp, "household_custom_values"},
		{"attendees", ScopeAll, "attendees"},
		// Registry miss: an id absent from syncJobMeta must fall back to ScopeAll / itself,
		// not panic or silently mis-scope. Both fallback branches (scope.go's JobScope and
		// JobBase) are otherwise unpinned by this table.
		{"nonexistent_job", ScopeAll, "nonexistent_job"},
	}
	for _, c := range cases {
		if got := JobScope(c.id); got != c.wantScope {
			t.Errorf("JobScope(%q) = %q, want %q", c.id, got, c.wantScope)
		}
		if got := JobBase(c.id); got != c.wantBase {
			t.Errorf("JobBase(%q) = %q, want %q", c.id, got, c.wantBase)
		}
	}
}

// TestScopedJobs pins the family-camp pair as the only scoped variants, in registry order.
func TestScopedJobs(t *testing.T) {
	t.Parallel()

	got := ScopedJobs(ScopeFamilyCamp)
	want := []string{"person_custom_values_family_camp", "household_custom_values_family_camp"}
	if len(got) != len(want) {
		t.Fatalf("ScopedJobs(family_camp) = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("ScopedJobs[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}

// TestCustomValuesCollectionGroupDerived pins the mutual-exclusion grouping (kindred#2491):
// a scoped variant must land in the SAME group as its base, because they write the same
// PocketBase collection under different registered names. person_custom_values and
// household_custom_values must stay in SEPARATE groups -- RunCustomValuesSync documents
// running them in parallel as safe because they write independent collections via
// independent CampMinder endpoints, and this map must not widen the lock across that line.
func TestCustomValuesCollectionGroupDerived(t *testing.T) {
	t.Parallel()

	want := map[string]string{
		"person_custom_values":                "person_custom_values",
		"person_custom_values_family_camp":    "person_custom_values",
		"household_custom_values":             "household_custom_values",
		"household_custom_values_family_camp": "household_custom_values",
	}
	if len(customValuesCollectionGroup) != len(want) {
		t.Fatalf("group map has %d entries, want %d: %v",
			len(customValuesCollectionGroup), len(want), customValuesCollectionGroup)
	}
	for k, v := range want {
		if got := customValuesCollectionGroup[k]; got != v {
			t.Errorf("group[%q] = %q, want %q", k, got, v)
		}
	}
}

// TestJobMetaBaseIsAReference pins referential integrity on syncJobMeta's Base column, which
// nothing else checks. A typo there is silent rather than loud: JobBase falls back to the id
// itself, so buildCustomValuesCollectionGroups files the variant in its OWN collection group
// and customValuesGroupRunningLocked stops seeing the pair as writers of one collection --
// the kindred#2491 race, with no error message anywhere.
func TestJobMetaBaseIsAReference(t *testing.T) {
	t.Parallel()

	ids := make(map[string]bool, len(syncJobMeta))
	for _, m := range syncJobMeta {
		ids[m.ID] = true
	}

	checked := 0
	for _, m := range syncJobMeta {
		if m.Base == "" {
			continue
		}
		checked++
		if !ids[m.Base] {
			t.Errorf("%s: Base %q names no syncJobMeta row -- JobBase would fall back to %q "+
				"and the pair would stop sharing a collection group (#2491)", m.ID, m.Base, m.ID)
		}
		if m.Base == m.ID {
			t.Errorf("%s: Base must name the job this row narrows, not the row itself", m.ID)
		}
	}
	if checked == 0 {
		t.Fatal("no syncJobMeta row declares a Base -- every assertion above would pass vacuously")
	}
}

// TestScopedVariantContract pins what kindred#2482/#2489/#2491/#2591 established about ANY
// scoped variant, so a THIRD one cannot be added half-wired. It iterates every syncJobMeta row
// carrying a Scope rather than ScopedJobs(ScopeFamilyCamp), because each clause below follows
// from a variant's IDENTITY -- a narrower-cohort instance of an existing service, registered
// under scopedID -- and not from the family-camp cron cadence. A scope declared tomorrow is
// therefore covered the day its first row lands. What is genuinely about the daily cron lives
// in TestScopeFamilyCampDailyContract instead: those clauses name specific jobs, and a future
// scope need not be daily at all.
//
// Each clause has a distinct failure mode that has actually happened:
//
//	Base declared      -- without one JobBase returns the id itself, so the variant shares a
//	                      collection group with nothing and races its own base (#2491)
//	id is scopedID     -- the row's own ID must be what registration builds, or the queue
//	                      names a job the registry has never heard of
//	phase parity       -- Phase is hand-written per row; a variant classified into a
//	                      different phase from the job it narrows is queued, filtered and
//	                      reported in the wrong group
//	registered         -- a row nothing in scopedServiceRegistrations constructs is a queue
//	                      entry that fails at run time
//	not in full/phase  -- re-fetching a cohort the cron just refreshed costs ~11.5 min of
//	                      rate-limited CampMinder quota (#2489)
//	in statusSyncTypes -- RunSyncSequence sets no run-type flag, so the per-job entry is the
//	                      client's ONLY completion signal; without it the Refresh Housing
//	                      cutover is undetectable (#2591)
//	no POST route      -- a scoped variant is cron-driven and exposes no Run button. This is
//	                      now a server guarantee as well as a convention: since Stage 3 Task 10
//	                      ResolveUnifiedSyncServices whitelists ?service= against
//	                      TriggerIndividualRoute and handleUnifiedSync answers 400 otherwise
//	                      (kindred#2608). What this clause still adds is the other direction --
//	                      that no route is REGISTERED for a variant in the first place, which
//	                      the whitelist cannot see.
//	collection mapping -- without it the bounded pass's writes are dropped from the export
//	                      skip-optimization and the fresh data never reaches Sheets (#2491)
func TestScopedVariantContract(t *testing.T) {
	t.Parallel()

	var variants []JobMeta
	for _, m := range syncJobMeta {
		if m.Scope != ScopeAll {
			variants = append(variants, m)
		}
	}
	if len(variants) == 0 {
		t.Fatal("no scoped rows in syncJobMeta -- every clause below would pass vacuously")
	}

	full := GetDefaultUnifiedSyncJobs(true, true)
	status := statusSyncTypes()
	routes := postRouteSegments(t)

	registered := make(map[string]bool)
	for _, reg := range scopedServiceRegistrations(nil, nil) {
		registered[scopedID(reg.base, reg.scope)] = true
	}

	for _, m := range variants {
		id := m.ID
		if m.Base == "" {
			t.Errorf("%s: carries Scope %q but no Base -- see the Base field's comment (#2491)",
				id, m.Scope)
			continue
		}
		base := m.Base

		if got := scopedID(base, m.Scope); got != id {
			t.Errorf("%s: scopedID(%q, %q) = %q -- the row's ID must be the name registration builds",
				id, base, m.Scope, got)
		}
		if GetPhaseForJob(id) != GetPhaseForJob(base) {
			t.Errorf("%s: phase %q != base %s's phase %q",
				id, GetPhaseForJob(id), base, GetPhaseForJob(base))
		}
		if !registered[id] {
			t.Errorf("%s: no scopedServiceRegistrations entry -- nothing constructs the "+
				"instance, so the queued job fails at run time", id)
		}
		if slices.Contains(full, id) {
			t.Errorf("%s: must not be in a full run (#2489)", id)
		}
		// This clause is genuinely falsifiable (kindred sync-job-registry Stage 2, Task 6):
		// phaseExecutionJobs is now inPhaseWithTrigger(phase, TriggerPhaseRun), driven by
		// each row's own Triggers bit rather than by filtering against Scope, so a row that
		// carried both Scope and TriggerPhaseRun would fail here. It does not fail today only
		// because the two family-camp rows carry no Triggers at all -- a fact about those
		// specific rows, not a structural guarantee this loop provides. The literal-name
		// coverage for the family-camp pair lives at api_test.go's
		// TestPhaseExecutionJobsExcludesScopeFamilyCampForExpensivePhase.
		if phase := GetPhaseForJob(id); slices.Contains(phaseExecutionJobs(phase), id) {
			t.Errorf("%s: must not be in an admin-triggered %q phase run (#2489)", id, phase)
		}
		if !slices.Contains(status, id) {
			t.Errorf("%s: must be published on the status payload (#2591)", id)
		}
		// Both spellings. api.go registers most segments hyphenated but not all --
		// bunk_requests_upload is underscored -- so checking one spelling would let a route
		// registered in the other convention through.
		for _, segment := range []string{id, strings.ReplaceAll(id, "_", "-")} {
			if slices.Contains(routes, segment) {
				t.Errorf("%s: must have no individual POST route, found /api/custom/sync/%s",
					id, segment)
			}
		}
		wantCollections := SyncJobToCollections[base]
		if len(wantCollections) == 0 {
			t.Errorf("%s: base %s has no SyncJobToCollections entry -- the equality below "+
				"would hold with both sides empty, which is exactly the dropped-from-the-export "+
				"case #2491 is about", id, base)
		} else if got := SyncJobToCollections[id]; !slices.Equal(got, wantCollections) {
			t.Errorf("%s: SyncJobToCollections = %v, want its base's %v (#2491)",
				id, got, wantCollections)
		}
	}
}

// TestScopeFamilyCampDailyContract pins what is about the family-camp CADENCE rather than
// about being scoped at all (kindred#2482): the bounded pass is part of the daily cron, and it
// runs after the source jobs that feed it and before the transforms that read what it wrote.
// These clauses name specific jobs -- financial_transactions and family_camp_derived -- and
// must not be generalized into TestScopedVariantContract: a scope added later need not be
// daily, let alone bracketed by those two.
func TestScopeFamilyCampDailyContract(t *testing.T) {
	t.Parallel()

	scoped := ScopedJobs(ScopeFamilyCamp)
	if len(scoped) == 0 {
		t.Fatal("no family-camp-scoped jobs found -- every clause below would pass vacuously")
	}

	daily := getDailySyncJobs()
	lastSource := slices.Index(daily, "financial_transactions")
	firstTransform := slices.Index(daily, "family_camp_derived")
	if lastSource == -1 || firstTransform == -1 {
		t.Fatalf("daily ordering anchors missing: financial_transactions=%d family_camp_derived=%d",
			lastSource, firstTransform)
	}

	for _, id := range scoped {
		at := slices.Index(daily, id)
		if at == -1 {
			t.Errorf("%s: missing from the daily queue (#2482)", id)
			continue
		}
		if at <= lastSource {
			t.Errorf("%s at daily[%d] must run AFTER the last source job at [%d] (#2482)",
				id, at, lastSource)
		}
		if at >= firstTransform {
			t.Errorf("%s at daily[%d] must run BEFORE family_camp_derived at [%d] (#2482)",
				id, at, firstTransform)
		}
	}
}

// postRouteSegments regex-scans api.go for every path segment registered as an
// individual-sync POST route under /api/custom/sync/, mirroring
// frontend/src/test/backendSyncJobIds.ts's getBackendSyncPostRouteSegments on the other side
// of the language boundary -- both parsers exist because nothing else crosses the language
// boundary to catch drift between the frontend's and backend's job-id lists.
//
// Like that parser, it Fatals rather than returning a plausible-but-wrong set: one clause of
// TestScopedVariantContract (the no-individual-route clause, which reads this output in both
// the underscored and hyphenated spellings) is anchored to it, and a parser that silently
// found the wrong routes -- or none at all -- would turn that clause green while pinning
// nothing.
func postRouteSegments(t *testing.T) []string {
	t.Helper()

	src := readSourceFile(t, "api.go")
	re := regexp.MustCompile(`e\.Router\.POST\(\s*"/api/custom/sync/([a-z0-9_-]+)"`)
	matches := re.FindAllStringSubmatch(src, -1)
	// 40 individual-sync routes are registered as of this writing; 30 is comfortably below
	// that but well above what a broken or over-narrow regex would still fluke-match, so a
	// genuine parse failure fails loudly here instead of silently returning a partial set.
	if len(matches) < 30 {
		t.Fatalf("postRouteSegments: parsed only %d POST route(s) out of api.go -- "+
			"the regex is broken or api.go's route registration shape changed; update it "+
			"to match rather than trust a partial result", len(matches))
	}

	segments := make([]string, 0, len(matches))
	for _, m := range matches {
		segments = append(segments, m[1])
	}
	return segments
}
