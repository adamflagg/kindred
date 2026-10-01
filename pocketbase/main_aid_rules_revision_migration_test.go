package main

import (
	"os"
	"strings"
	"testing"

	"github.com/camp/kindred/pocketbase/aidguard"
)

// Campership G6 (write only if unchanged). Like the other aid migration tests,
// this asserts on the migration FILE: tests.NewTestApp() does not run JS
// migrations. aidguard's own tests drive the hook; rbac's booted test checks
// the field exists after the real migrations run.
const aidRulesRevisionMigration = "pb_migrations/1500000220_aid_rules_revision.js"

func TestAidRulesRevisionMigrationAddsTheNumberToEveryGuardedCollection(t *testing.T) {
	up := readAidMigrationUp(t, aidRulesRevisionMigration)
	for _, name := range aidguard.Collections {
		if !strings.Contains(up, `findCollectionByNameOrId("`+name+`")`) {
			t.Errorf("up must add %s to %s, a collection aidguard guards", aidguard.FieldRevision, name)
		}
	}
	field := `fields.add(new Field({ type: "number", name: "revision", required: false, presentable: false, ` +
		`min: 0, max: null, onlyInt: true }))`
	if strings.Count(up, field) != len(aidguard.Collections) {
		t.Errorf("up must add %s once per guarded collection", field)
	}
	if strings.Contains(up, "options:") {
		t.Error("uses an options wrapper, which PocketBase v0.23 ignores silently")
	}
	if strings.Contains(up, "Rule =") {
		t.Error("must not touch the rules: every aid_ collection stays superuser-only (spec 14.3)")
	}
	raw, err := os.ReadFile(aidRulesRevisionMigration)
	if err != nil {
		t.Fatal(err)
	}
	_, down, _ := strings.Cut(string(raw), "}, (app) => {")
	if !strings.Contains(down, `removeByName("revision")`) {
		t.Error(`down must remove revision`)
	}
}

// TestMainRegistersTheAidWriteGuard: main() is not callable from a test, so the
// one line that turns the guard on is pinned by source.
func TestMainRegistersTheAidWriteGuard(t *testing.T) {
	src, err := os.ReadFile("main.go")
	if err != nil {
		t.Fatalf("read main.go: %v", err)
	}
	if !strings.Contains(string(src), "aidguard.RegisterHooks(app)") {
		t.Fatal("main.go must call aidguard.RegisterHooks(app)")
	}
}
