package sync

import "testing"

// TestScopedID pins the one rule that generates a scoped service name. Every other site that
// needs a scoped id must call this rather than spelling the string, because the id is what
// sync_runs, runningJobs, lastCompletedStatus and the status payload are all keyed by.
func TestScopedID(t *testing.T) {
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

// TestFamilyCampBoundedSetDerived pins the phaseExecutionJobs exclusion set (kindred#2489)
// as exactly the family-camp-scoped rows -- no more, no less.
func TestFamilyCampBoundedSetDerived(t *testing.T) {
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
