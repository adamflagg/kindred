package sync

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

const aidSourcesFixture = `{"sources": [
  {"description": "Example Camp Financial Assistance", "source_name": "Camp aid", "source_family": "camp_fa",
   "funder_type": "camp", "counts_as_aid": true, "counts_toward_budget": true, "implied_program_families": []},
  {"description": "Family Incentive Grant", "source_name": "Family incentive", "source_family": "jfam_incentive",
   "funder_type": "incentive", "counts_as_aid": true, "counts_toward_budget": false,
   "implied_program_families": ["family_camp"]},
  {"description": "Regional Grant- North", "source_name": "Regional grant (north)", "source_family": "other_outside",
   "funder_type": "outside", "counts_as_aid": true, "counts_toward_budget": false,
   "implied_program_families": ["teen", "summer"]}
]}`

func TestParseAidSourcesConfig(t *testing.T) {
	t.Parallel()
	classes, err := parseAidSourcesConfig([]byte(aidSourcesFixture))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	got, ok := classes["regional grant - north"]
	if !ok {
		t.Fatalf("expected the normalized key, got keys %v", reflect.ValueOf(classes).MapKeys())
	}
	want := aidSourceClass{Key: "regional grant - north", Description: "Regional Grant- North",
		SourceName: "Regional grant (north)", SourceFamily: "other_outside", FunderType: "outside",
		CountsAsAid: true, ImpliedFamilies: []string{"summer", "teen"}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %+v\nwant %+v", got, want)
	}
	if imp := classes["example camp financial assistance"].ImpliedFamilies; imp == nil || len(imp) != 0 {
		t.Errorf("an empty implied list must be an empty, non-nil slice, got %#v", imp)
	}
}

func TestParseAidSourcesConfigRejectsBadInput(t *testing.T) {
	t.Parallel()
	entry := func(fields string) string { return `{"sources": [{` + fields + `}]}` }
	ok := `"description": "X Grant", "source_name": "X", "source_family": "other_outside", "funder_type": "outside"`
	cases := map[string]string{
		"unknown key": entry(ok + `, "shade": "blue"`),
		// Owner ruling 2026-09-25: only the camp's own aid counts toward the budget.
		"outside grant counted toward the budget": entry(ok + `, "counts_toward_budget": true`),
		// Item 5 (final review, ruling): counting toward the budget while not
		// even counting as aid is incoherent, whatever the source family.
		"counts toward the budget but not as aid": entry(`"description": "X Aid", "source_name": "X", ` +
			`"source_family": "camp_fa", "funder_type": "camp", "counts_toward_budget": true`),
		// SP6-core (owner, 2026-09-28): full_coverage is a grantor fact on aid_grantors now,
		// so a file that still sets it is refused rather than silently ignored.
		"full_coverage on a source": entry(ok + `, "full_coverage": true`),
		"unknown family":            entry(strings.Replace(ok, "other_outside", "mystery", 1)),
		"unclassified family":       entry(strings.Replace(ok, "other_outside", "unclassified", 1)),
		"unknown funder":            entry(strings.Replace(ok, `"outside"`, `"alien"`, 1)),
		"unknown implied":           entry(ok + `, "implied_program_families": ["space_camp"]`),
		"empty description":         entry(strings.Replace(ok, "X Grant", "  ", 1)),
		"empty source name":         entry(strings.Replace(ok, `"source_name": "X"`, `"source_name": ""`, 1)),
		"not json":                  `{"sources": [`,
	}
	for name, doc := range cases {
		if _, err := parseAidSourcesConfig([]byte(doc)); err == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
}

// Review Focus 1.
func TestParseAidSourcesConfigRejectsKeyCollisions(t *testing.T) {
	t.Parallel()
	doc := `{"sources": [
	  {"description": "Regional Grant- North", "source_name": "A", "source_family": "other_outside",
	   "funder_type": "outside"},
	  {"description": "Regional Grant – North", "source_name": "B", "source_family": "one_happy_camper",
	   "funder_type": "outside"}
	]}`
	_, err := parseAidSourcesConfig([]byte(doc))
	if err == nil {
		t.Fatal("two descriptions normalizing to one key must fail loudly")
	}
	for _, want := range []string{"Regional Grant- North", "Regional Grant – North", "regional grant - north"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error must name %q, got: %v", want, err)
		}
	}
}

func TestLoadAidSourcesConfigSearchesTheCandidates(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, aidSourcesConfigFileName), []byte(aidSourcesFixture), 0o600); err != nil {
		t.Fatal(err)
	}
	classes, path, _, err := loadAidSourcesConfig("", []string{filepath.Join(root, "missing"), root}, t.TempDir())
	if err != nil || len(classes) != 3 || path != filepath.Join(root, aidSourcesConfigFileName) {
		t.Fatalf("got %d classes from %q, err %v", len(classes), path, err)
	}
}

// TestLoadAidSourcesConfigAbsentIsNotAnError also pins F1's loud-failure fix: a caller with no
// file must still learn exactly which paths were searched, so it can log them (aid_postings.go
// Sync()) instead of the silence prod hit.
func TestLoadAidSourcesConfigAbsentIsNotAnError(t *testing.T) {
	t.Parallel()
	root := filepath.Join(t.TempDir(), "none")
	base := t.TempDir()
	classes, path, candidates, err := loadAidSourcesConfig("", []string{root}, base)
	if err != nil || classes != nil || path != "" {
		t.Fatalf("absent file must be (nil, \"\", nil), got (%v, %q, %v)", classes, path, err)
	}
	want := []string{
		filepath.Join(root, aidSourcesConfigFileName),
		filepath.Join(base, "config", aidSourcesConfigFileName),
		filepath.Join(base, "..", "config", aidSourcesConfigFileName),
	}
	if !reflect.DeepEqual(candidates, want) {
		t.Errorf("candidates = %v, want %v", candidates, want)
	}
}

func TestLoadAidSourcesConfigExplicitPathMustExist(t *testing.T) {
	t.Parallel()
	if _, _, _, err := loadAidSourcesConfig(filepath.Join(t.TempDir(), "nope.json"), nil, t.TempDir()); err == nil {
		t.Fatal("an explicit path that does not exist must be an error")
	}
}
