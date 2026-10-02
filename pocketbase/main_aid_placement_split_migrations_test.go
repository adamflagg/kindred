package main

import (
	"os"
	"strings"
	"testing"
)

// Campership SP11-rest (Money > To place). Like the other aid migration tests, this asserts on the
// migration FILE, because tests.NewTestApp() does not run JS migrations.
const aidPlacementSplitMigration = "pb_migrations/1500000221_aid_placement_split.js"

func TestAidPlacementSplitMigrationAddsTheSplitAndThePlacementTick(t *testing.T) {
	up := readAidMigrationUp(t, aidPlacementSplitMigration)
	for _, want := range []string{
		`findCollectionByNameOrId("aid_attribution_overrides")`,
		`fields.add(new Field({ type: "json", name: "split", required: false, presentable: false, maxSize: 20000 }))`,
		`findCollectionByNameOrId("aid_decisions")`,
		`getByName("lock_source").values = ["tick", "ledger", "placement"]`,
	} {
		if !strings.Contains(up, want) {
			t.Errorf("up must contain %q", want)
		}
	}
	if strings.Contains(up, "options:") {
		t.Error("uses an options wrapper, which PocketBase v0.23 ignores silently")
	}
	if strings.Contains(up, "Rule =") {
		t.Error("must not touch any rule: aid_ collections stay superuser-only (spec 14.3)")
	}
	raw, err := os.ReadFile(aidPlacementSplitMigration)
	if err != nil {
		t.Fatal(err)
	}
	_, down, _ := strings.Cut(string(raw), "}, (app) => {")
	for _, want := range []string{`removeByName("split")`, `.values = ["tick", "ledger"]`} {
		if !strings.Contains(down, want) {
			t.Errorf("down must contain %q", want)
		}
	}
}
