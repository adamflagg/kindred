package main

import (
	"os"
	"strings"
	"testing"
)

// Campership sub-project 4. Asserts on the migration FILES, the approach
// main_jotform_tables_migration_test.go documents: a Go test cannot apply JS
// migrations, and these properties fail SILENTLY when wrong. SP2's
// rbac/financial_aid_rules_booted_test.go independently asserts every aid_*
// collection's rules are null on a booted schema; this one pins the grain and
// the vocabularies.
var aidLedgerMigrations = map[string]string{
	"aid_sources":               "pb_migrations/1500000196_aid_sources.js",
	"aid_household_links":       "pb_migrations/1500000197_aid_household_links.js",
	"aid_postings":              "pb_migrations/1500000198_aid_postings.js",
	"aid_attribution_overrides": "pb_migrations/1500000199_aid_overrides_and_dispositions.js",
	"aid_flag_dispositions":     "pb_migrations/1500000199_aid_overrides_and_dispositions.js",
}

func readAidMigration(t *testing.T, path string) string {
	t.Helper()
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read migration %s: %v", path, err)
	}
	return string(content)
}

func TestAidLedgerMigrationsCreateSuperuserOnlyCollections(t *testing.T) {
	collectionsPerFile := map[string]int{}
	for name, path := range aidLedgerMigrations {
		collectionsPerFile[path]++
		if body := readAidMigration(t, path); !strings.Contains(body, `name: "`+name+`"`) {
			t.Errorf("%s must create collection %q", path, name)
		}
	}
	for path, collections := range collectionsPerFile {
		body := readAidMigration(t, path)
		for _, rule := range []string{"listRule", "viewRule", "createRule", "updateRule", "deleteRule"} {
			if got := strings.Count(body, rule+": null"); got != collections {
				t.Errorf("%s: %s must be null once per collection (%d), found %d", path, rule, collections, got)
			}
		}
		forbidden := []string{"@request", `Rule: ""`, "Rule: ''", "options: {", "counts_against_budget", "decision_id"}
		for _, forbidden := range forbidden {
			if strings.Contains(body, forbidden) {
				t.Errorf("%s must not contain %q", path, forbidden)
			}
		}
		if !strings.Contains(body, "}, (app) =>") {
			t.Errorf("%s must define a down function", path)
		}
	}
}

func TestAidLedgerMigrationsDeclareTheirGrain(t *testing.T) {
	want := map[string][]string{
		"aid_sources": {"CREATE UNIQUE INDEX `idx_aid_sources_description_key` " +
			"ON `aid_sources` (`description_key`)"},
		"aid_household_links": {"CREATE UNIQUE INDEX `idx_aid_household_links_household_family_year` " +
			"ON `aid_household_links` (`household_cm_id`, `family_key`, `year`)"},
		"aid_postings": {
			"CREATE UNIQUE INDEX `idx_aid_postings_txn_amount_year` " +
				"ON `aid_postings` (`transaction_cm_id`, `amount`, `year`)",
			"CREATE INDEX `idx_aid_postings_year_reversed` ON `aid_postings` (`year`, `is_reversed`)",
		},
		"aid_attribution_overrides": {"CREATE UNIQUE INDEX `idx_aid_attribution_overrides_txn_year` " +
			"ON `aid_attribution_overrides` (`transaction_cm_id`, `year`)"},
		"aid_flag_dispositions": {"CREATE UNIQUE INDEX `idx_aid_flag_dispositions_txn_year_flag` " +
			"ON `aid_flag_dispositions` (`transaction_cm_id`, `year`, `flag`)"},
	}
	for name, indexes := range want {
		body := readAidMigration(t, aidLedgerMigrations[name])
		for _, index := range indexes {
			if !strings.Contains(body, index) {
				t.Errorf("%s must declare %s", aidLedgerMigrations[name], index)
			}
		}
	}
}

// Each select value and field name is checked as its own quoted token, so a
// formatter that wraps a long values array cannot break the test. The Go side
// pins the aid_postings values it writes separately (TestAidVocabularyMatchesMigration).
func TestAidLedgerSelectVocabulariesAndFields(t *testing.T) {
	families := []string{"summer", "quest", "teen", "bmitzvah", "family_camp", "adult_weekend", "family_school", "other"}
	sourceFamilies := []string{"camp_fa", "one_happy_camper", "synagogue_federation", "new_israeli", "pj", "jfcs",
		"jfam_incentive", "named_fund", "other_outside", "application_marker", "placeholder", "unclassified"}
	funders := []string{"camp", "outside", "incentive", "unknown"}
	cases := map[string][]string{
		"aid_sources": append(append(append([]string{}, sourceFamilies...), funders...),
			"config_file", "staff", "counts_toward_budget", "counts_as_aid", "full_coverage"),
		"aid_household_links": {"auto", "staff", "excluded"},
		"aid_postings": append(append(append([]string{
			"override", "decision", "session", "person", "program_family", "ambiguous", "none",
			"override_sheet_2026_match", "override_staff", "posted_person_single_enrollment",
			"household_single_camper", "single_person_multi_enrollment", "source_implied",
			"fa_application_program", "household_single_family", "no_enrollment",
			"is_reversed", "reversal_date", "transaction_note", "effective_source_key", "counts_toward_budget",
			"request_id",
		}, families...), sourceFamilies...), funders...),
		"aid_attribution_overrides": append([]string{"sheet_2026_match", "staff", "source_key_override"}, families...),
		"aid_flag_dispositions": {"accepted_let_stand", "accepted_late_grant", "accepted_other", "flag", "disposition",
			"^[a-z][a-z0-9_]*$"},
	}
	for name, wants := range cases {
		body := readAidMigration(t, aidLedgerMigrations[name])
		for _, w := range wants {
			if !strings.Contains(body, `"`+w+`"`) {
				t.Errorf("%s must declare %q", aidLedgerMigrations[name], w)
			}
		}
	}
}
