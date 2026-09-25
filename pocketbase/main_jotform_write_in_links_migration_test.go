package main

import (
	"os"
	"strings"
	"testing"
)

// kindred#2759 follow-up. File-level, like main_jotform_tables_migration_test.go:
// a Go test cannot apply JS migrations, and these are the parts that fail
// silently when wrong.
func TestJotformWriteInLinksMigration(t *testing.T) {
	raw, err := os.ReadFile("pb_migrations/1500000182_jotform_write_in_links.js")
	if err != nil {
		t.Fatal(err)
	}
	body := string(raw)
	if !strings.Contains(body, `["auto", "staff", "unmatched", "ignored", "cancelled", "write_in"]`) {
		t.Error("match_status must gain cancelled and write_in, keeping the four existing values")
	}
	for _, table := range []string{"jotform_submissions", "lodging_write_ins", "lodging_write_ins_draft"} {
		if !strings.Contains(body, table) {
			t.Errorf("migration must touch %s", table)
		}
	}
	if strings.Count(body, `new Field({ type: "text", name: "write_in_key"`) != 2 {
		t.Error("write_in_key must be added (via new Field) on the submissions and on the write-in tables")
	}
	if strings.Contains(body, "options: {") {
		t.Error("v0.23 ignores an options: {} wrapper silently")
	}
	if !strings.Contains(body, "}, (app) =>") {
		t.Error("migration must define a down function")
	}
}
