package main

import (
	"os"
	"strings"
	"testing"
)

// D143 (a last-dollar funder pays what the camp's award leaves). Like the other aid migration tests,
// this asserts on the migration FILE, because tests.NewTestApp() does not run JS migrations.
const aidGrantorsPaysAfterMigration = "pb_migrations/1500000217_aid_grantors_pays_after_camp_aid.js"

func TestAidGrantorsPaysAfterMigrationAddsTheBool(t *testing.T) {
	up := readAidMigrationUp(t, aidGrantorsPaysAfterMigration)
	for _, want := range []string{
		`findCollectionByNameOrId("aid_grantors")`,
		`fields.add(new Field({ type: "bool", name: "pays_after_camp_aid"`,
	} {
		if !strings.Contains(up, want) {
			t.Errorf("up must contain %q", want)
		}
	}
	if strings.Contains(up, "options:") {
		t.Error("uses an options wrapper, which PocketBase v0.23 ignores silently")
	}
	if strings.Contains(up, "Rule =") {
		t.Error("must not touch aid_grantors' rules: they stay null (spec 14.3)")
	}
	raw, err := os.ReadFile(aidGrantorsPaysAfterMigration)
	if err != nil {
		t.Fatal(err)
	}
	_, down, _ := strings.Cut(string(raw), "}, (app) => {")
	if !strings.Contains(down, `removeByName("pays_after_camp_aid")`) {
		t.Error(`down must remove pays_after_camp_aid`)
	}
}
