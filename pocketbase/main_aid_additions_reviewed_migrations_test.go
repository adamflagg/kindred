package main

import (
	"os"
	"strings"
	"testing"
)

// PR 3 (Form intake). Like the other aid migration tests, this asserts on the migration FILE, because
// tests.NewTestApp() does not run JS migrations; booting PocketBase on it is checked by hand (scratch serve).
const aidAdditionsReviewedMigration = "pb_migrations/1500000247_aid_additions_reviewed.js"

func TestAidAdditionsReviewedMigrationAddsTheMarkReviewedFields(t *testing.T) {
	up := readAidMigrationUp(t, aidAdditionsReviewedMigration)
	for _, want := range []string{
		`findCollectionByNameOrId("aid_request_additions")`,
		`new Field({ type: "date", name: "reviewed_at"`,
		`new Field({ type: "text", name: "reviewed_by"`,
		`findCollectionByNameOrId("aid_decisions")`,
		`getByName("lock_source").values = ["tick", "ledger", "placement", "reproduced", "campminder_only", "campminder_added"]`,
	} {
		if !strings.Contains(up, want) {
			t.Errorf("up must contain %q", want)
		}
	}
	if strings.Contains(up, "Rule =") {
		t.Error("must not touch any rule: aid_ collections stay superuser-only (spec 14.3)")
	}
	raw, err := os.ReadFile(aidAdditionsReviewedMigration)
	if err != nil {
		t.Fatal(err)
	}
	_, down, _ := strings.Cut(string(raw), "}, (app) => {")
	for _, want := range []string{
		`removeByName("reviewed_at")`,
		`removeByName("reviewed_by")`,
		`.values = ["tick", "ledger", "placement", "reproduced", "campminder_only"]`,
	} {
		if !strings.Contains(down, want) {
			t.Errorf("down must contain %q", want)
		}
	}
}
