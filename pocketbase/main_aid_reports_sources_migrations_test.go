package main

import (
	"path/filepath"
	"strings"
	"testing"
)

// Campership Reports back end, Part C: the per-source incentive flag (D88) and development's saved report
// columns (clean spec §9.4's "+ Add a dated column"). Asserts on the migration FILE (tests.NewTestApp() does not
// run JS migrations); pocketbase/rbac/financial_aid_rules_booted_test.go checks every aid_ collection's booted
// rules in CI. Located by suffix, so the number the stack gives it at build time never breaks the test.
func aidReportsSourcesMigration(t *testing.T) string {
	t.Helper()
	matches, err := filepath.Glob("pb_migrations/*_aid_reports_sources.js")
	if err != nil || len(matches) != 1 {
		t.Fatalf("want exactly one pb_migrations/*_aid_reports_sources.js, got %v (err %v)", matches, err)
	}
	return matches[0]
}

func TestAidReportsSourcesMigrationAddsTheIncentiveFlag(t *testing.T) {
	up := readAidMigrationUp(t, aidReportsSourcesMigration(t))
	want := `sources.fields.add(new Field({ type: "bool", name: "incentive", required: false, presentable: false }))`
	if !strings.Contains(up, want) {
		t.Errorf("missing %s", want)
	}
	if strings.Contains(up, "options:") {
		t.Error("uses an options wrapper, which PocketBase v0.23 ignores silently")
	}
}

func TestAidReportsSourcesMigrationLocksTheReportDefinitions(t *testing.T) {
	up := readAidMigrationUp(t, aidReportsSourcesMigration(t))
	if !strings.Contains(up, `name: "aid_report_definitions"`) {
		t.Error("must create aid_report_definitions")
	}
	rules := aidRuleLine.FindAllStringSubmatch(up, -1)
	if len(rules) != 5 {
		t.Errorf("declares %d rules, want 5", len(rules))
	}
	for _, rule := range rules {
		if strings.TrimSpace(rule[2]) != "null" {
			t.Errorf("%s = %s, want null (spec 14.3)", rule[1], rule[2])
		}
	}
	for _, want := range []string{
		`{ type: "json", name: "columns", required: false, presentable: false, maxSize: 20000 }`,
		"CREATE UNIQUE INDEX `idx_aid_report_definitions_report` ON `aid_report_definitions` (`report`)",
	} {
		if !strings.Contains(up, want) {
			t.Errorf("missing %s", want)
		}
	}
}
