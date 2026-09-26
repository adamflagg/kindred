package main

import (
	"regexp"
	"strings"
	"testing"
)

// Campership sub-project 4a: the shared financial-aid write helper. Asserts
// on the migration FILES, as main_aid_rules_migration_test.go does (a Go test
// cannot apply JS migrations). What they produce once applied is asserted
// against the booted database by rbac/batch_booted_test.go and
// rbac/financial_aid_rules_booted_test.go in CI's Migrations & Schema
// Agreement job.
const (
	aidChangeLogOperationMigration = "pb_migrations/1500000194_aid_change_log_operation_id.js"
	batchSettingsMigration         = "pb_migrations/1500000195_batch_settings.js"
)

// One field's object literal inside new Field({...}), on its one line (a
// [^{}] class would stop at the {15} inside operation_id's pattern).
func fieldLiteral(t *testing.T, up, name string) string {
	t.Helper()
	re := regexp.MustCompile(`new Field\(\{[^\n]*name: "` + name + `"[^\n]*\}\)`)
	lit := re.FindString(up)
	if lit == "" {
		t.Fatalf("up path adds no %q field through new Field({...})", name)
	}
	return lit
}

func TestAidChangeLogOperationMigration(t *testing.T) {
	body := readMigration(t, aidChangeLogOperationMigration)
	up, down := migrationHalves(t, body)

	if strings.Contains(body, "options: {") {
		t.Error("v0.23 ignores an options: {} wrapper silently -- field properties must be direct")
	}
	op := fieldLiteral(t, up, "operation_id")
	for _, want := range []string{`type: "text"`, "required: true", "min: 15", "max: 15", `pattern: "^[a-z0-9]{15}$"`} {
		if !strings.Contains(op, want) {
			t.Errorf("operation_id must carry %s, got %s", want, op)
		}
	}
	persona := fieldLiteral(t, up, "persona")
	for _, want := range []string{`type: "text"`, "required: false", "min: 0", "max: 2000"} {
		if !strings.Contains(persona, want) {
			t.Errorf("persona must carry %s, got %s", want, persona)
		}
	}
	index := "CREATE INDEX `idx_aid_change_log_operation` ON `aid_change_log` (`operation_id`, `created`)"
	if !strings.Contains(up, index) {
		t.Errorf("up path must add %s", index)
	}
	// Rows written before the field existed become operations of one, keyed
	// by their own id -- never deleted, never left blank under a required rule.
	if !strings.Contains(up, "UPDATE aid_change_log SET operation_id = id WHERE operation_id = ''") {
		t.Error("up path must backfill existing rows' operation_id with their own id")
	}
	if strings.Contains(up, "app.delete(") || strings.Contains(strings.ToUpper(up), "DELETE FROM") {
		t.Error("up path must not delete anything: it adds two fields to a table that may hold history")
	}
	for _, name := range []string{"operation_id", "persona"} {
		if !strings.Contains(down, `removeByName("`+name+`")`) {
			t.Errorf("down path must remove %s", name)
		}
	}
	if !strings.Contains(down, "idx_aid_change_log_operation") {
		t.Error("down path must drop the operation index")
	}
}

func TestBatchSettingsMigration(t *testing.T) {
	body := readMigration(t, batchSettingsMigration)
	up, down := migrationHalves(t, body)
	// Values pinned by rbac/batch_booted_test.go and bunking/pocketbase_batch.py.
	for _, want := range []string{
		"settings.batch.enabled = true",
		"settings.batch.maxRequests = 2000",
		"settings.batch.timeout = 30",
		"settings.batch.maxBodySize = 32 * 1024 * 1024",
		"app.save(settings)",
	} {
		if !strings.Contains(up, want) {
			t.Errorf("up path must contain %q", want)
		}
	}
	// Down restores PocketBase's own defaults (core/settings_model.go).
	for _, want := range []string{
		"settings.batch.enabled = false",
		"settings.batch.maxRequests = 50",
		"settings.batch.timeout = 3",
		"settings.batch.maxBodySize = 0",
		"app.save(settings)",
	} {
		if !strings.Contains(down, want) {
			t.Errorf("down path must contain %q", want)
		}
	}
}
