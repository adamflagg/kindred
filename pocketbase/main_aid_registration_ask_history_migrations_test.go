package main

import (
	"os"
	"strings"
	"testing"
)

// PR 4a (registration-ask history). Like the other aid migration tests this asserts on the
// migration FILE, because tests.NewTestApp() does not run JS migrations;
// pocketbase/rbac/financial_aid_rules_booted_test.go checks the booted rules in CI.
const aidRegistrationAskHistoryMigration = "pb_migrations/1500000246_aid_registration_ask_history.js"

func TestAidRegistrationAskHistoryMigrationLocksEveryRule(t *testing.T) {
	up := readAidMigrationUp(t, aidRegistrationAskHistoryMigration)
	if !strings.Contains(up, `name: "aid_registration_ask_history"`) {
		t.Error("must create aid_registration_ask_history with a literal name")
	}
	rules := aidRuleLine.FindAllStringSubmatch(up, -1)
	if len(rules) != 5 {
		t.Errorf("declares %d rules, want 5", len(rules))
	}
	for _, rule := range rules {
		if strings.TrimSpace(rule[2]) != "null" {
			t.Errorf("%s = %s, want null (locked, superuser-only)", rule[1], rule[2])
		}
	}
	if strings.Contains(up, "options:") {
		t.Error("uses an options wrapper, which PocketBase v0.23 ignores silently")
	}
}

func TestAidRegistrationAskHistoryMigrationDeclaresItsShape(t *testing.T) {
	up := readAidMigrationUp(t, aidRegistrationAskHistoryMigration)
	field := func(name string) string {
		for _, line := range strings.Split(up, "\n") {
			if strings.Contains(line, `name: "`+name+`"`) {
				return line
			}
		}
		t.Fatalf("no %s field", name)
		return ""
	}
	for _, want := range []string{"required: true", "min: 2010", "max: 2100", "onlyInt: true"} {
		if line := field("year"); !strings.Contains(line, want) {
			t.Errorf("year must declare %q: %s", want, line)
		}
	}
	if line := field("person_cm_id"); !strings.Contains(line, "required: true") || !strings.Contains(line, "min: 1") {
		t.Errorf("person_cm_id must be required with min 1: %s", line)
	}
	if line := field("field_cm_id"); !strings.Contains(line, "required: true") {
		t.Errorf("field_cm_id must be required: %s", line)
	}
	for _, name := range []string{"old_value", "new_value"} {
		if line := field(name); !strings.Contains(line, "max: 200") {
			t.Errorf("%s must be text max 200: %s", name, line)
		}
	}
	if line := field("source_changed_at"); !strings.Contains(line, `type: "text"`) || !strings.Contains(line, "max: 100") {
		t.Errorf("source_changed_at must be text max 100: %s", line)
	}
	if line := field("observed_by"); !strings.Contains(line, "max: 64") {
		t.Errorf("observed_by must be text max 64: %s", line)
	}
	for _, name := range []string{"amount", "observed_at", "is_genesis", "created"} {
		field(name)
	}
	if strings.Contains(up, "UNIQUE") {
		t.Error("must not declare a unique index: the table is an append-only change history")
	}
	if !strings.Contains(up, "CREATE INDEX `idx_aid_registration_ask_history_lookup` ON "+
		"`aid_registration_ask_history` (`year`, `field_cm_id`, `person_cm_id`, `created`)") {
		t.Error("must declare the non-unique newest-row lookup index")
	}
	if !strings.Contains(up, "CREATE INDEX `idx_aid_registration_ask_history_person_year` ON "+
		"`aid_registration_ask_history` (`person_cm_id`, `year`)") {
		t.Error("must declare the (person_cm_id, year) index")
	}
	raw, err := os.ReadFile(aidRegistrationAskHistoryMigration)
	if err != nil {
		t.Fatal(err)
	}
	_, down, _ := strings.Cut(string(raw), "}, (app) => {")
	if !strings.Contains(down, `app.delete(app.findCollectionByNameOrId("aid_registration_ask_history"))`) {
		t.Error("down must delete aid_registration_ask_history")
	}
}
