package main

import (
	"path/filepath"
	"strings"
	"testing"
)

// Reports › Development's "as reported" recipients (owner ruling 2026-10-16, CS-AGES25): a past season's Campership
// sheet, loaded by CampMinder id. Like the other aid migration tests, this asserts on the migration FILE, because
// tests.NewTestApp() does not run JS migrations; pocketbase/rbac/financial_aid_rules_booted_test.go checks the booted
// rules of every aid_ collection in CI. Located by suffix, so a renumber never breaks the test.
func aidReportedRecipientsMigration(t *testing.T) string {
	t.Helper()
	matches, err := filepath.Glob("pb_migrations/*_aid_reported_recipients.js")
	if err != nil || len(matches) != 1 {
		t.Fatalf("want exactly one pb_migrations/*_aid_reported_recipients.js, got %v (err %v)", matches, err)
	}
	return matches[0]
}

func TestAidReportedRecipientsMigrationLocksEveryRule(t *testing.T) {
	up := readAidMigrationUp(t, aidReportedRecipientsMigration(t))
	if !strings.Contains(up, `name: "aid_reported_recipients"`) {
		t.Error("must create aid_reported_recipients")
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

func TestAidReportedRecipientsMigrationDeclaresItsShape(t *testing.T) {
	up := readAidMigrationUp(t, aidReportedRecipientsMigration(t))
	for _, want := range []string{
		`values: ["summer", "family_camp", "bmitzvah", "weekend", "other"]`,
		`values: ["camp", "outside"]`,
		`values: ["personal_id", "household_birthdate"]`,
		`{ type: "number", name: "person_cm_id", required: true, presentable: false, min: 1, max: null, onlyInt: true }`,
		`{ type: "number", name: "household_cm_id", required: true, presentable: false, min: 1, max: null, onlyInt: true }`,
		"CREATE UNIQUE INDEX `idx_aid_reported_recipients_key` ON `aid_reported_recipients` " +
			"(`year`, `person_cm_id`, `program`, `source`, `funder`)",
	} {
		if !strings.Contains(up, want) {
			t.Errorf("missing %s", want)
		}
	}
	if strings.Contains(strings.ToLower(up), "first_name") || strings.Contains(strings.ToLower(up), "last_name") {
		t.Error("the sheet's rows carry CampMinder ids only, never a name")
	}
}
