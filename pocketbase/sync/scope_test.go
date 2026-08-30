package sync

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

// TestScopedID pins the one rule that generates a scoped service name. Every other site that
// needs a scoped id must call this rather than spelling the string, because the id is what
// sync_runs, runningJobs, lastCompletedStatus and the status payload are all keyed by.
func TestScopedID(t *testing.T) {
	t.Parallel()

	if got := scopedID("person_custom_values", ScopeAll); got != "person_custom_values" {
		t.Errorf("ScopeAll must not appear in an id, got %q", got)
	}
	want := "person_custom_values_family_camp"
	if got := scopedID("person_custom_values", ScopeFamilyCamp); got != want {
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

// TestScopeFamilyCampSetDerived pins the phaseExecutionJobs exclusion set (kindred#2489)
// as exactly the family-camp-scoped rows -- no more, no less.
func TestScopeFamilyCampSetDerived(t *testing.T) {
	t.Parallel()

	if len(familyCampBoundedCustomValuesJobs) != 2 {
		t.Fatalf("exclusion set has %d entries, want 2: %v",
			len(familyCampBoundedCustomValuesJobs), familyCampBoundedCustomValuesJobs)
	}
	for _, id := range ScopedJobs(ScopeFamilyCamp) {
		if !familyCampBoundedCustomValuesJobs[id] {
			t.Errorf("scoped job %q missing from the phase-run exclusion set", id)
		}
	}
}

// TestScopedVariantContract pins everything kindred#2482/#2489/#2491/#2591 established about
// a scoped custom-values variant, so a THIRD one cannot be added half-wired. Each clause has
// a distinct failure mode that has actually happened:
//
//	daily membership   -- the whole point of the bounded pass (#2482)
//	daily ordering     -- after source, before the transforms that read it (#2482)
//	not in full/phase  -- re-fetching a fresh cohort costs ~11.5 min of quota (#2489)
//	in statusSyncTypes -- RunSyncSequence sets no run-type flag, so the per-job entry is the
//	                      client's ONLY completion signal; without it the Refresh Housing
//	                      cutover is undetectable (#2591)
//	no POST route      -- "no manual trigger" must be true of the server, not just the button
//	collection mapping -- without it the bounded pass's writes are dropped from the export
//	                      skip-optimization and the fresh data never reaches Sheets (#2491)
func TestScopedVariantContract(t *testing.T) {
	t.Parallel()

	scoped := ScopedJobs(ScopeFamilyCamp)
	if len(scoped) == 0 {
		t.Fatal("no scoped jobs found -- every clause below would pass vacuously")
	}

	daily := getDailySyncJobs()
	full := GetDefaultUnifiedSyncJobs(true)
	phaseRun := phaseExecutionJobs(PhaseExpensive)
	status := statusSyncTypes()
	routes := postRouteSegments(t)

	for _, id := range scoped {
		base := JobBase(id)

		// Phase parity is not named in the doc comment above and has no mutation: it is
		// structurally guaranteed by JobBase/GetPhaseForJob's shared syncJobMeta lookup
		// (Tasks 1-3), not an independently falsifiable property the way the seven clauses
		// below are. Left in as a cheap sanity check, not a proof.
		if GetPhaseForJob(id) != GetPhaseForJob(base) {
			t.Errorf("%s: phase %q != base %s's phase %q",
				id, GetPhaseForJob(id), base, GetPhaseForJob(base))
		}
		if !sliceContains(daily, id) {
			t.Errorf("%s: missing from the daily queue (#2482)", id)
		}
		if i, j := indexOf(daily, id), indexOf(daily, "financial_transactions"); i <= j {
			t.Errorf("%s at daily[%d] must run AFTER the last source job at [%d] (#2482)", id, i, j)
		}
		if i, j := indexOf(daily, id), indexOf(daily, "family_camp_derived"); i >= j {
			t.Errorf("%s at daily[%d] must run BEFORE family_camp_derived at [%d] (#2482)", id, i, j)
		}
		if sliceContains(full, id) {
			t.Errorf("%s: must not be in a full run (#2489)", id)
		}
		if sliceContains(phaseRun, id) {
			t.Errorf("%s: must not be in an admin-triggered phase run (#2489)", id)
		}
		if !sliceContains(status, id) {
			t.Errorf("%s: must be published on the status payload (#2591)", id)
		}
		if sliceContains(routes, strings.ReplaceAll(id, "_", "-")) {
			t.Errorf("%s: must have no individual POST route", id)
		}
		if got, want := SyncJobToCollections[id], SyncJobToCollections[base]; !equalStrings(got, want) {
			t.Errorf("%s: SyncJobToCollections = %v, want its base's %v (#2491)", id, got, want)
		}
	}
}

// sliceContains reports whether ids contains id. Named to avoid colliding with
// persons_test.go's contains(haystack, needle string) bool -- a substring check with a
// different signature -- since Go has no overloading and the two cannot share a name in one
// package.
func sliceContains(ids []string, id string) bool {
	return indexOf(ids, id) != -1
}

// indexOf returns the index of id within ids, or -1 if absent.
func indexOf(ids []string, id string) int {
	for i, v := range ids {
		if v == id {
			return i
		}
	}
	return -1
}

// equalStrings reports whether a and b hold the same elements in the same order.
func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// postRouteSegments regex-scans api.go for every path segment registered as an
// individual-sync POST route under /api/custom/sync/, mirroring
// frontend/src/test/backendSyncJobIds.ts's getBackendSyncPostRouteSegments on the other side
// of the language boundary -- both parsers exist because nothing else crosses the language
// boundary to catch drift between the frontend's and backend's job-id lists.
//
// Like that parser, it Fatals rather than returning a plausible-but-wrong set: three clauses
// of TestScopedVariantContract are anchored to this output, and a parser that silently found
// the wrong routes (or none at all) would turn them green while pinning nothing.
func postRouteSegments(t *testing.T) []string {
	t.Helper()

	src := readSource(t, "api.go")
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

// readSource reads a file from this package's directory, t.Fatal on failure. Tests run with
// the package directory as the working directory, so a bare filename is correct.
func readSource(t *testing.T, name string) string {
	t.Helper()
	data, err := os.ReadFile(name)
	if err != nil {
		t.Fatalf("readSource(%q): %v", name, err)
	}
	return string(data)
}
