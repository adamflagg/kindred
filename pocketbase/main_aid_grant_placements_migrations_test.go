package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Campership 3c-2 (the as-of reads' grant placement log). Like the other aid migration tests, this
// asserts on the migration FILE, because tests.NewTestApp() does not run JS migrations.
// pocketbase/rbac/financial_aid_rules_booted_test.go finds every aid_ collection by prefix and
// checks the booted rules in CI. Located by suffix, so a renumber at build time does not break it.
func aidGrantPlacementsMigration(t *testing.T) string {
	t.Helper()
	matches, err := filepath.Glob("pb_migrations/*_aid_grant_placements.js")
	if err != nil || len(matches) != 1 {
		t.Fatalf("want exactly one pb_migrations/*_aid_grant_placements.js, got %v (err %v)", matches, err)
	}
	return matches[0]
}

func TestAidGrantPlacementsMigrationLocksEveryRule(t *testing.T) {
	up := readAidMigrationUp(t, aidGrantPlacementsMigration(t))
	if !strings.Contains(up, `name: "aid_grant_placements"`) {
		t.Error("must create aid_grant_placements")
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

func TestAidGrantPlacementsMigrationDeclaresItsShape(t *testing.T) {
	path := aidGrantPlacementsMigration(t)
	up := readAidMigrationUp(t, path)
	for _, want := range []string{
		`name: "grant", required: true, presentable: true, min: 1, max: 64, pattern: "^(ledger:[0-9]+|commitment:[a-z0-9]{15})$"`,
		`values: ["place", "remove"]`,
		`{ type: "json", name: "placement", required: false`,
		`{ type: "number", name: "household_cm_id", required: false`,
		"CREATE INDEX `idx_aid_grant_placements_year_created` ON `aid_grant_placements` (`year`, `created`)",
		"CREATE INDEX `idx_aid_grant_placements_year_grant` ON `aid_grant_placements` (`year`, `grant`)",
	} {
		if !strings.Contains(up, want) {
			t.Errorf("up must contain %q", want)
		}
	}
	// Append-only: a row is never edited, and a grant has one row per change by design.
	if strings.Contains(up, "onUpdate: true") {
		t.Error("aid_grant_placements is append-only: it has no updated field")
	}
	if strings.Contains(up, "UNIQUE") {
		t.Error("a grant has many rows by design: no unique index")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	_, down, _ := strings.Cut(string(raw), "}, (app) => {")
	if !strings.Contains(down, `app.delete(app.findCollectionByNameOrId("aid_grant_placements"))`) {
		t.Error("down must delete aid_grant_placements")
	}
}
