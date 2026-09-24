package main

import (
	"os"
	"strings"
	"testing"
)

// kindred#2759. Asserts on the migration FILE, the approach
// TestLodgingRBACMigrationGrantsBunkingManageWrites documents: a Go test cannot
// apply JS migrations (jsvm binds its dir before flag parsing), pb-js-lint
// checks syntax, and this locks in the semantics that fail SILENTLY if wrong.
const jotformTablesMigration = "pb_migrations/1500000180_jotform_tables.js"

func readJotformMigration(t *testing.T) string {
	t.Helper()
	content, err := os.ReadFile(jotformTablesMigration)
	if err != nil {
		t.Fatalf("read migration %s: %v", jotformTablesMigration, err)
	}
	return string(content)
}

func TestJotformTablesAreReadableOnlyWithBunkingManage(t *testing.T) {
	body := readJotformMigration(t)
	// bunkingManageRule is declared in main_lodging_rbac_test.go.
	if !strings.Contains(body, bunkingManageRule) {
		t.Fatalf("migration must contain the canonical bunkingManage rule %s", bunkingManageRule)
	}
	for _, col := range []string{"jotform_forms", "jotform_submissions", "jotform_answers"} {
		if !strings.Contains(body, `name: "`+col+`"`) {
			t.Errorf("migration must create collection %q", col)
		}
	}
	// Writes are superuser-only (the Go sync and FastAPI's superuser client):
	// no UI writes these tables directly.
	if strings.Count(body, "createRule: null") != 3 || strings.Count(body, "updateRule: null") != 3 ||
		strings.Count(body, "deleteRule: null") != 3 {
		t.Error("all three collections must keep create/update/delete superuser-only (null)")
	}
	if strings.Count(body, "listRule: BUNKING_MANAGE") != 3 || strings.Count(body, "viewRule: BUNKING_MANAGE") != 3 {
		t.Error("all three collections must gate list and view on BUNKING_MANAGE")
	}
}

func TestJotformTablesUniqueKeysAndV023Syntax(t *testing.T) {
	body := readJotformMigration(t)
	for _, index := range []string{
		"CREATE UNIQUE INDEX `idx_jotform_forms_year_session` ON `jotform_forms` (`year`, `session_cm_id`)",
		"CREATE UNIQUE INDEX `idx_jotform_submissions_submission_id` ON `jotform_submissions` (`submission_id`)",
		"CREATE UNIQUE INDEX `idx_jotform_answers_submission_question` ON `jotform_answers` (`submission`, `question_id`)",
	} {
		if !strings.Contains(body, index) {
			t.Errorf("migration must declare %s", index)
		}
	}
	if strings.Contains(body, "options: {") {
		t.Error("v0.23 ignores an options: {} wrapper silently -- field properties must be direct")
	}
	if !strings.Contains(body, `values: ["auto", "staff", "unmatched", "ignored"]`) {
		t.Error("match_status must be the four-value select auto|staff|unmatched|ignored")
	}
	if !strings.Contains(body, "}, (app) =>") {
		t.Error("migration must define a down function")
	}
}
