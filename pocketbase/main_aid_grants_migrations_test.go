package main

import (
	"os"
	"strings"
	"testing"
)

// Campership sub-project 6-core. Like the other migration tests in this package, this
// asserts on the migration FILE, because tests.NewTestApp() does not run JS migrations.
// pocketbase/rbac/financial_aid_rules_booted_test.go finds every aid_ collection by
// prefix and checks the booted rules in CI.
const aidGrantsMigration = "pb_migrations/1500000210_aid_grantors_and_grants.js"

func TestAidGrantsMigrationLocksEveryRule(t *testing.T) {
	up := readAidMigrationUp(t, aidGrantsMigration)
	for _, name := range []string{"aid_grantors", "aid_grants"} {
		if !strings.Contains(up, `name: "`+name+`"`) {
			t.Errorf("must create %s", name)
		}
	}
	rules := aidRuleLine.FindAllStringSubmatch(up, -1)
	if len(rules) != 10 {
		t.Errorf("declares %d rules, want 10 (five per collection)", len(rules))
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

func TestAidGrantsMigrationDeclaresItsShape(t *testing.T) {
	up := readAidMigrationUp(t, aidGrantsMigration)
	for _, want := range []string{
		"CREATE UNIQUE INDEX `idx_aid_grantors_key` ON `aid_grantors` (`key`)",
		`values: ["unknown", "yes", "no"]`,
		`values: ["open", "withdrawn"]`,
		`name: "committed_on"`,
		`fields.add(new Field({ type: "text", name: "grantor_key"`,
		`fields.removeByName("full_coverage")`,
	} {
		if !strings.Contains(up, want) {
			t.Errorf("up must contain %q", want)
		}
	}
	raw, err := os.ReadFile(aidGrantsMigration)
	if err != nil {
		t.Fatal(err)
	}
	_, down, _ := strings.Cut(string(raw), "}, (app) => {")
	downWants := []string{
		`name: "full_coverage"`, `removeByName("grantor_key")`, `"aid_grants"`, `"aid_grantors"`,
	}
	for _, want := range downWants {
		if !strings.Contains(down, want) {
			t.Errorf("down must contain %q", want)
		}
	}
}
