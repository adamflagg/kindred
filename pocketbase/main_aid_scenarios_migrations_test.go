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
const aidScenariosMigration = "pb_migrations/1500000218_aid_scenarios.js"

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

// aidScenarioCollection is the part of the up migration that declares one collection: from its name to its
// app.save, so a field name shared by the three (year, actor, document) is checked in the right one.
func aidScenarioCollection(t *testing.T, up, name string) string {
	t.Helper()
	_, rest, found := strings.Cut(up, `name: "`+name+`"`)
	if !found {
		t.Fatalf("up does not create %s", name)
	}
	block, _, found := strings.Cut(rest, "app.save(")
	if !found {
		t.Fatalf("%s is never saved", name)
	}
	return block
}

func TestAidScenariosMigrationTypesEveryField(t *testing.T) {
	up := readAidMigrationUp(t, aidScenariosMigration)
	// Each field's type and required flag; the JSON fields' caps and the relations' target and cardinality too.
	want := map[string][]string{
		"aid_scenario_snapshots": {
			`{ type: "number", name: "year", required: true,`,
			`{ type: "json", name: "inputs", required: false, presentable: false, maxSize: 20000000 }`,
			`{ type: "number", name: "requests", required: false,`,
			`{ type: "number", name: "awaiting_rules", required: false,`,
			`{ type: "text", name: "actor", required: true,`,
			`{ type: "autodate", name: "created", required: false,`,
		},
		"aid_scenario_options": {
			`{ type: "number", name: "year", required: true,`,
			`{ type: "text", name: "code", required: true,`,
			`{ type: "text", name: "starting_point", required: false,`,
			`{ type: "text", name: "from_code", required: false,`,
			`{ type: "number", name: "origin_version", required: true,`,
			`{ type: "json", name: "document", required: false, presentable: false, maxSize: 2000000 }`,
			`{ type: "json", name: "results", required: false, presentable: false, maxSize: 200000 }`,
			`{ type: "json", name: "round1_by_request", required: false, presentable: false, maxSize: 1000000 }`,
			`{ type: "relation", name: "snapshot", required: true, presentable: false, collectionId: snapshots.id, ` +
				`cascadeDelete: false, minSelect: null, maxSelect: 1 }`,
			`{ type: "text", name: "actor", required: true,`,
			`{ type: "autodate", name: "created", required: false,`,
		},
		"aid_scenario_trail": {
			`{ type: "number", name: "year", required: true,`,
			`{ type: "text", name: "actor", required: true,`,
			`{ type: "text", name: "from_code", required: true,`,
			`{ type: "json", name: "document", required: false, presentable: false, maxSize: 2000000 }`,
			`{ type: "text", name: "change", required: true, presentable: false, min: 1, max: 2000,`,
			`{ type: "json", name: "results", required: false, presentable: false, maxSize: 200000 }`,
			`{ type: "relation", name: "snapshot", required: true, presentable: false, collectionId: snapshots.id, ` +
				`cascadeDelete: false, minSelect: null, maxSelect: 1 }`,
			`{ type: "text", name: "kept_code", required: false,`,
			`{ type: "autodate", name: "created", required: false,`,
			`{ type: "autodate", name: "updated", required: false,`,
		},
	}
	for name, fields := range want {
		block := aidScenarioCollection(t, up, name)
		for _, field := range fields {
			if !strings.Contains(block, field) {
				t.Errorf("%s must declare %q", name, field)
			}
		}
		if got := strings.Count(block, "{ type: "); got != len(fields) {
			t.Errorf("%s declares %d fields, want %d", name, got, len(fields))
		}
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

// Scenarios addendum §S11.1, §S11.2 (PR 10): kept options get a name, and the trail's from_code takes the three
// built-in starts. An ALTER: it touches no API rule (all five stay null) and adds no relation.
const aidScenarioNamesMigration = "pb_migrations/1500000233_aid_scenario_names.js"

// aidMigrationBlock is the part of `up` from the first mention of `marker` to the next app.save(.
func aidMigrationBlock(t *testing.T, up, marker string) string {
	t.Helper()
	_, rest, found := strings.Cut(up, marker)
	if !found {
		t.Fatalf("up does not mention %s", marker)
	}
	block, _, found := strings.Cut(rest, "app.save(")
	if !found {
		t.Fatalf("%s is never saved", marker)
	}
	return block
}

func TestAidScenarioNamesMigrationAddsAnOptionalNameOfEightyCharacters(t *testing.T) {
	up := readAidMigrationUp(t, aidScenarioNamesMigration)
	block := aidMigrationBlock(t, up, `findCollectionByNameOrId("aid_scenario_options")`)
	wants := []string{`new Field({`, `type: "text"`, `name: "name"`, `required: false`, `min: 0`, `max: 80`, `pattern: ""`}
	for _, want := range wants {
		if !strings.Contains(block, want) {
			t.Errorf("aid_scenario_options.name must declare %s", want)
		}
	}
	if !strings.Contains(block, "fields.add(") {
		t.Error("a new field goes through fields.add(new Field(...)), never a plain object")
	}
}

func TestAidScenarioNamesMigrationWidensTheTrailCodeToTheBuiltInStarts(t *testing.T) {
	up := readAidMigrationUp(t, aidScenarioNamesMigration)
	block := aidMigrationBlock(t, up, `findCollectionByNameOrId("aid_scenario_trail")`)
	if !strings.Contains(block, `getByName("from_code")`) {
		t.Error("must change the existing from_code field in place, so it keeps its id")
	}
	if !strings.Contains(block, `"^([A-Z]+[0-9]*|rules|rules_draft|last_rules)$"`) {
		t.Error("from_code must accept a kept code or one of rules, rules_draft, last_rules")
	}
}

func TestAidScenarioNamesMigrationLeavesEveryRuleAndUsesNoOptionsWrapper(t *testing.T) {
	up := readAidMigrationUp(t, aidScenarioNamesMigration)
	if aidRuleLine.MatchString(up) {
		t.Error("an ALTER here sets no API rule: all five stay null (spec 14.3)")
	}
	if strings.Contains(up, "options:") {
		t.Error("uses an options wrapper, which PocketBase v0.23 ignores silently")
	}
	raw, err := os.ReadFile(aidScenarioNamesMigration)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{`removeByName("name")`, `"^[A-Z]+[0-9]*$"`} {
		if !strings.Contains(string(raw), want) {
			t.Errorf("down must restore 1500000218's shape: missing %s", want)
		}
	}
}
