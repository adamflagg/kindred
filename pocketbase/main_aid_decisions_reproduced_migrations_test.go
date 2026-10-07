package main

import (
	"os"
	"strings"
	"testing"
)

// The 2026 decision-year load (D67). Like the other aid migration tests, this asserts on the migration FILE,
// because tests.NewTestApp() does not run JS migrations.
const aidDecisionsReproducedMigration = "pb_migrations/1500000238_aid_decisions_reproduced.js"

func TestAidDecisionsReproducedMigrationAddsTheReproducedLock(t *testing.T) {
	up := readAidMigrationUp(t, aidDecisionsReproducedMigration)
	for _, want := range []string{
		`findCollectionByNameOrId("aid_decisions")`,
		`getByName("lock_source").values = ["tick", "ledger", "placement", "reproduced"]`,
	} {
		if !strings.Contains(up, want) {
			t.Errorf("up must contain %q", want)
		}
	}
	if strings.Contains(up, "Rule =") {
		t.Error("must not touch any rule: aid_ collections stay superuser-only (spec 14.3)")
	}
	raw, err := os.ReadFile(aidDecisionsReproducedMigration)
	if err != nil {
		t.Fatal(err)
	}
	_, down, _ := strings.Cut(string(raw), "}, (app) => {")
	if !strings.Contains(down, `.values = ["tick", "ledger", "placement"]`) {
		t.Error("down must restore the three earlier values")
	}
}
