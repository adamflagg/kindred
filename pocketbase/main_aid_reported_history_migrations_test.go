package main

import (
	"path/filepath"
	"strings"
	"testing"
)

// Campership Reports back end, Part A (O-930-13's default). Like the other aid migration tests, this asserts on the
// migration FILE, because tests.NewTestApp() does not run JS migrations.
// pocketbase/rbac/financial_aid_rules_booted_test.go finds every aid_ collection by prefix and checks the booted
// rules in CI. Located by suffix, so the number the stack gives it at build time never breaks the test.
func aidReportedHistoryMigration(t *testing.T) string {
	t.Helper()
	matches, err := filepath.Glob("pb_migrations/*_aid_reported_history.js")
	if err != nil || len(matches) != 1 {
		t.Fatalf("want exactly one pb_migrations/*_aid_reported_history.js, got %v (err %v)", matches, err)
	}
	return matches[0]
}

func TestAidReportedHistoryMigrationLocksEveryRule(t *testing.T) {
	up := readAidMigrationUp(t, aidReportedHistoryMigration(t))
	if !strings.Contains(up, `name: "aid_reported_history"`) {
		t.Error("must create aid_reported_history")
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
	if strings.Contains(up, "options:") {
		t.Error("uses an options wrapper, which PocketBase v0.23 ignores silently")
	}
}

func TestAidReportedHistoryMigrationDeclaresItsShape(t *testing.T) {
	up := readAidMigrationUp(t, aidReportedHistoryMigration(t))
	for _, want := range []string{
		`values: ["finance", "development"]`,
		`values: ["pull", "season_end"]`,
		// A reported figure can be 0 (a count of none), and PocketBase reads a required number's 0 as blank.
		`{ type: "number", name: "value", required: false, presentable: false, min: 0, max: null, onlyInt: false }`,
		`{ type: "date", name: "as_of", required: true, presentable: false, min: "", max: "" }`,
		"CREATE UNIQUE INDEX `idx_aid_reported_history_key` ON `aid_reported_history` " +
			"(`year`, `view`, `metric`, `pool`, `tier`, `phase`, `at`, `as_of`)",
	} {
		if !strings.Contains(up, want) {
			t.Errorf("missing %s", want)
		}
	}
}
