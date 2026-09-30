package main

import (
	"os"
	"strings"
	"testing"
)

// Campership sub-project 9b. Like the other aid migration tests, this asserts on the migration FILE
// (readAidMigrationUp and aidRuleLine live in main_financial_aid_intake_migrations_test.go),
// because tests.NewTestApp() does not run JS migrations. pocketbase/rbac/financial_aid_rules_booted_test.go
// finds every aid_ collection by prefix and checks the booted rules in CI.
const aidScenariosMigration = "pb_migrations/1500000214_aid_scenarios.js"

func TestAidScenariosMigrationLocksEveryRule(t *testing.T) {
	up := readAidMigrationUp(t, aidScenariosMigration)
	for _, name := range []string{"aid_scenario_snapshots", "aid_scenario_options", "aid_scenario_trail"} {
		if !strings.Contains(up, `name: "`+name+`"`) {
			t.Errorf("must create %s", name)
		}
	}
	rules := aidRuleLine.FindAllStringSubmatch(up, -1)
	if len(rules) != 15 {
		t.Errorf("declares %d rules, want 15 (five on each of three collections)", len(rules))
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

func TestAidScenariosMigrationDeclaresItsShape(t *testing.T) {
	up := readAidMigrationUp(t, aidScenariosMigration)
	for _, want := range []string{
		`name: "inputs", required: false, presentable: false, maxSize: 20000000`,
		`name: "awaiting_rules", required: false, presentable: false, min: 0, max: null, onlyInt: true`,
		`name: "code", required: true, presentable: true, min: 1, max: 12, pattern: "^[A-Z]+[0-9]*$"`,
		`name: "starting_point", required: false, presentable: false, min: 0, max: 12, pattern: "^([A-Z]+)?$"`,
		`collectionId: snapshots.id`,
		"CREATE UNIQUE INDEX `idx_aid_scenario_options_year_code` ON `aid_scenario_options` (`year`, `code`)",
		"CREATE INDEX `idx_aid_scenario_trail_year_actor` ON `aid_scenario_trail` (`year`, `actor`, `created`)",
		"CREATE INDEX `idx_aid_scenario_trail_year_created` ON `aid_scenario_trail` (`year`, `created`)",
		"CREATE INDEX `idx_aid_scenario_snapshots_year` ON `aid_scenario_snapshots` (`year`, `created`)",
	} {
		if !strings.Contains(up, want) {
			t.Errorf("up must contain %q", want)
		}
	}
	raw, err := os.ReadFile(aidScenariosMigration)
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"aid_scenario_trail", "aid_scenario_options", "aid_scenario_snapshots"} {
		if !strings.Contains(string(raw), `app.delete(app.findCollectionByNameOrId("`+name+`"))`) {
			t.Errorf("down must delete %s", name)
		}
	}
}
