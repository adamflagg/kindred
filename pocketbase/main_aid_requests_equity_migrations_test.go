package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Campership 3c-2: intake's recorded copy of a camper's equity answers, so a past date prices them
// as they stood (the as-of reads). Asserts on the migration FILE, as the other aid tests do. Located
// by suffix, so a renumber at build time does not break it.
func aidRequestsEquityMigration(t *testing.T) string {
	t.Helper()
	matches, err := filepath.Glob("pb_migrations/*_aid_requests_equity.js")
	if err != nil || len(matches) != 1 {
		t.Fatalf("want exactly one pb_migrations/*_aid_requests_equity.js, got %v (err %v)", matches, err)
	}
	return matches[0]
}

func TestAidRequestsEquityMigrationAddsTheField(t *testing.T) {
	path := aidRequestsEquityMigration(t)
	up := readAidMigrationUp(t, path)
	for _, want := range []string{`findCollectionByNameOrId("aid_requests")`, `new Field({`, `type: "json", name: "equity"`} {
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
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	_, down, _ := strings.Cut(string(raw), "}, (app) => {")
	if !strings.Contains(down, `removeByName("equity")`) {
		t.Error("down must remove the equity field")
	}
}
