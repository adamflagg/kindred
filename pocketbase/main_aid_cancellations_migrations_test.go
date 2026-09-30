package main

import (
	"os"
	"strings"
	"testing"
)

// Campership sub-project 10b-2. Like the other aid migration tests, this asserts on the migration
// FILE, because tests.NewTestApp() does not run JS migrations.
// pocketbase/rbac/financial_aid_rules_booted_test.go finds every aid_ collection by prefix and
// checks the booted rules in CI.
const aidCancellationsMigration = "pb_migrations/1500000219_aid_cancellations.js"

func TestAidCancellationsMigrationLocksEveryRule(t *testing.T) {
	up := readAidMigrationUp(t, aidCancellationsMigration)
	if !strings.Contains(up, `name: "aid_cancellations"`) {
		t.Error("must create aid_cancellations")
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

func TestAidCancellationsMigrationDeclaresItsShape(t *testing.T) {
	up := readAidMigrationUp(t, aidCancellationsMigration)
	for _, want := range []string{
		`values: ["cancel", "reopen"]`,
		// D141's nine, in the picker's order (api/services/financial_aid_cancellations.py CancelReason).
		`values: ["aid_not_enough", "medical", "schedule", "not_ready", "did_not_want_to_appeal", ` +
			`"not_financially_related", "early_cancel", "another_reason", "not_known"]`,
		`name: "in_kindred"`,
		`name: "note"`,
		"CREATE INDEX `idx_aid_cancellations_request` ON `aid_cancellations` (`request`)",
		"CREATE INDEX `idx_aid_cancellations_year` ON `aid_cancellations` (`year`)",
	} {
		if !strings.Contains(up, want) {
			t.Errorf("up must contain %q", want)
		}
	}
	if strings.Contains(up, "onUpdate: true") {
		t.Error("aid_cancellations is append-only: it has no updated field")
	}
	if strings.Contains(up, "UNIQUE") {
		t.Error("a request has many rows by design: no unique index")
	}
	raw, err := os.ReadFile(aidCancellationsMigration)
	if err != nil {
		t.Fatal(err)
	}
	_, down, _ := strings.Cut(string(raw), "}, (app) => {")
	if !strings.Contains(down, `app.delete(app.findCollectionByNameOrId("aid_cancellations"))`) {
		t.Error("down must delete aid_cancellations")
	}
}

func TestAidCancellationsMigrationPinsItsKeyFields(t *testing.T) {
	up := readAidMigrationUp(t, aidCancellationsMigration)
	field := func(name string) string {
		for _, line := range strings.Split(up, "\n") {
			if strings.Contains(line, `name: "`+name+`"`) {
				return line
			}
		}
		t.Fatalf("no %s field", name)
		return ""
	}
	// One request per row, and a request's cancellations are never deleted with it.
	for _, want := range []string{"required: true", "maxSelect: 1", "cascadeDelete: false"} {
		if line := field("request"); !strings.Contains(line, want) {
			t.Errorf("request field must declare %q: %s", want, line)
		}
	}
	for _, name := range []string{"year", "actor"} {
		if line := field(name); !strings.Contains(line, "required: true") {
			t.Errorf("%s must be required: %s", name, line)
		}
	}
}
