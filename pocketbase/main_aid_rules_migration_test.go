package main

import (
	"os"
	"strings"
	"testing"
)

// Campership sub-project 3. Asserts on the migration FILE, the approach
// main_jotform_tables_migration_test.go documents: a Go test cannot apply JS
// migrations (jsvm binds its dir before flag parsing), pb-js-lint checks syntax,
// and this pins the semantics that fail SILENTLY if wrong. Above all: every rule
// is null (superuser only). An empty-string rule would make a season's aid
// policy, and the names of the staff who approved it, readable by anyone.
const aidRulesMigration = "pb_migrations/1500000188_aid_rules.js"

func readAidRulesMigration(t *testing.T) string {
	t.Helper()
	content, err := os.ReadFile(aidRulesMigration)
	if err != nil {
		t.Fatalf("read migration %s: %v", aidRulesMigration, err)
	}
	return string(content)
}

func TestAidRulesIsSuperuserOnly(t *testing.T) {
	body := readAidRulesMigration(t)
	if !strings.Contains(body, `name: "aid_rules"`) {
		t.Fatal(`migration must create collection "aid_rules"`)
	}
	for _, rule := range []string{"listRule", "viewRule", "createRule", "updateRule", "deleteRule"} {
		if strings.Count(body, rule+": null") != 1 {
			t.Errorf("%s must be null (superuser only) exactly once", rule)
		}
	}
	for _, forbidden := range []string{`Rule: ""`, "Rule: ''", "is_admin", "cached_permissions"} {
		if strings.Contains(body, forbidden) {
			t.Errorf("migration must not contain %q: every aid_rules rule is null", forbidden)
		}
	}
}

func TestAidRulesKeysAndV023Syntax(t *testing.T) {
	body := readAidRulesMigration(t)
	index := "CREATE UNIQUE INDEX `idx_aid_rules_year_version` ON `aid_rules` (`year`, `version`)"
	if !strings.Contains(body, index) {
		t.Errorf("migration must declare %s", index)
	}
	for _, field := range []string{
		`{ type: "number", name: "year", required: true, presentable: false, min: 2000, max: 2100, onlyInt: true }`,
		`{ type: "number", name: "version", required: true, presentable: false, min: 1, max: null, onlyInt: true }`,
		`{ type: "json", name: "document", required: false, presentable: false, maxSize: 2000000 }`,
		`{ type: "json", name: "section_status", required: false, presentable: false, maxSize: 100000 }`,
	} {
		if !strings.Contains(body, field) {
			t.Errorf("migration must declare field %s", field)
		}
	}
	if strings.Contains(body, "options: {") {
		t.Error("v0.23 ignores an options: {} wrapper silently -- field properties must be direct")
	}
	if !strings.Contains(body, "}, (app) =>") {
		t.Error("migration must define a down function")
	}
}
