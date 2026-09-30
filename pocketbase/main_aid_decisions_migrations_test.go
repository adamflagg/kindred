package main

import (
	"os"
	"strings"
	"testing"
)

// Campership sub-project 10a. Like the other aid migration tests, this asserts on the
// migration FILE, because tests.NewTestApp() does not run JS migrations.
// pocketbase/rbac/financial_aid_rules_booted_test.go finds every aid_ collection by
// prefix and checks the booted rules in CI.
const aidDecisionsMigration = "pb_migrations/1500000211_aid_decisions.js"

func TestAidDecisionsMigrationLocksEveryRule(t *testing.T) {
	up := readAidMigrationUp(t, aidDecisionsMigration)
	if !strings.Contains(up, `name: "aid_decisions"`) {
		t.Error("must create aid_decisions")
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

func TestAidDecisionsMigrationDeclaresItsShape(t *testing.T) {
	up := readAidMigrationUp(t, aidDecisionsMigration)
	for _, want := range []string{
		`values: ["ask", "award", "approve", "refuse", "post", "unpost", "accept", "unaccept"]`,
		`values: ["tick", "ledger"]`,
		`name: "round", required: true, presentable: false, min: 1, max: 3, onlyInt: true`,
		`name: "effective_on"`,
		`name: "statement_of_need"`,
		`name: "needs_approval"`,
		`name: "snapshot"`,
		"CREATE INDEX `idx_aid_decisions_request_round` ON `aid_decisions` (`request`, `round`)",
		"CREATE INDEX `idx_aid_decisions_year_event` ON `aid_decisions` (`year`, `event`)",
	} {
		if !strings.Contains(up, want) {
			t.Errorf("up must contain %q", want)
		}
	}
	// Append-only: a row is never edited, so there is no updated field and no unique index
	// (a round has many rows by design).
	if strings.Contains(up, "onUpdate: true") {
		t.Error("aid_decisions is append-only: it has no updated field")
	}
	if strings.Contains(up, "UNIQUE") {
		t.Error("a round has many rows by design: no unique index")
	}
	raw, err := os.ReadFile(aidDecisionsMigration)
	if err != nil {
		t.Fatal(err)
	}
	_, down, _ := strings.Cut(string(raw), "}, (app) => {")
	if !strings.Contains(down, `app.delete(app.findCollectionByNameOrId("aid_decisions"))`) {
		t.Error("down must delete aid_decisions")
	}
}
