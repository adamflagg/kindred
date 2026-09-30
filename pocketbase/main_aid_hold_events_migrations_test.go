package main

import (
	"os"
	"strings"
	"testing"
)

// Campership follow-up 3b (hold release and manual holds). Like the other aid migration
// tests, this asserts on the migration FILE, because tests.NewTestApp() does not run JS
// migrations. pocketbase/rbac/financial_aid_rules_booted_test.go finds every aid_ collection
// by prefix and checks the booted rules in CI.
const aidHoldEventsMigration = "pb_migrations/1500000212_aid_hold_events.js"

func TestAidHoldEventsMigrationLocksEveryRule(t *testing.T) {
	up := readAidMigrationUp(t, aidHoldEventsMigration)
	if !strings.Contains(up, `name: "aid_hold_events"`) {
		t.Error("must create aid_hold_events")
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

func TestAidHoldEventsMigrationDeclaresItsShape(t *testing.T) {
	up := readAidMigrationUp(t, aidHoldEventsMigration)
	for _, want := range []string{
		`values: ["release", "unrelease", "place", "lift"]`,
		`name: "code", required: true, presentable: false, min: 1, max: 64, pattern: "^[a-z][a-z0-9_]*$"`,
		`name: "note", required: true, presentable: false, min: 1, max: 2000`,
		`{ type: "json", name: "fact", required: false`,
		`collectionId: requests.id`,
		"CREATE INDEX `idx_aid_hold_events_request_code` ON `aid_hold_events` (`request`, `code`)",
		"CREATE INDEX `idx_aid_hold_events_year_created` ON `aid_hold_events` (`year`, `created`)",
	} {
		if !strings.Contains(up, want) {
			t.Errorf("up must contain %q", want)
		}
	}
	// Append-only: a row is never edited, so there is no updated field, and a request's
	// code has many rows by design (release, unrelease, release again), so no unique index.
	if strings.Contains(up, "onUpdate: true") {
		t.Error("aid_hold_events is append-only: it has no updated field")
	}
	if strings.Contains(up, "UNIQUE") {
		t.Error("a request's hold has many rows by design: no unique index")
	}
	raw, err := os.ReadFile(aidHoldEventsMigration)
	if err != nil {
		t.Fatal(err)
	}
	_, down, _ := strings.Cut(string(raw), "}, (app) => {")
	if !strings.Contains(down, `app.delete(app.findCollectionByNameOrId("aid_hold_events"))`) {
		t.Error("down must delete aid_hold_events")
	}
}
