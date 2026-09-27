package main

import (
	"strings"
	"testing"
)

// The admin audit log's migrations, asserted on the FILES (a Go test cannot
// apply JS migrations). What they produce once applied is asserted on the
// booted database by rbac/admin_audit_log_booted_test.go in CI.
const adminAuditLogMigration = "pb_migrations/1500000206_admin_audit_log.js"

func TestAdminAuditLogMigration(t *testing.T) {
	body := readMigration(t, adminAuditLogMigration)
	up, down := migrationHalves(t, body)

	if strings.Contains(body, "options: {") {
		t.Error("v0.23 ignores an options: {} wrapper silently -- field properties must be direct")
	}
	if !strings.Contains(up, `name: "admin_audit_log"`) {
		t.Fatal("up path must create admin_audit_log")
	}
	for _, rule := range []string{"listRule", "viewRule", "createRule", "updateRule", "deleteRule"} {
		if !strings.Contains(up, rule+": null,") {
			t.Errorf("%s must be null (superusers only); '' would be PUBLIC", rule)
		}
	}
	for _, want := range []string{
		`values: ["access", "roles", "view_as", "settings", "pb_admin", "sign_in"]`,
		`values: ["user", "superuser", "system"]`,
		`{ type: "json", name: "before", required: false, presentable: false, maxSize: 32768 }`,
		`{ type: "json", name: "after", required: false, presentable: false, maxSize: 32768 }`,
		`{ type: "json", name: "detail", required: false, presentable: false, maxSize: 8192 }`,
		`{ type: "autodate", name: "created", required: false, presentable: false, onCreate: true, onUpdate: false }`,
		"CREATE INDEX `idx_admin_audit_log_created` ON `admin_audit_log` (`created`)",
		"CREATE INDEX `idx_admin_audit_log_type_created` ON `admin_audit_log` (`type`, `created`)",
		"CREATE INDEX `idx_admin_audit_log_actor_created` ON `admin_audit_log` (`actor_email`, `created`)",
	} {
		if !strings.Contains(up, want) {
			t.Errorf("up path must contain %s", want)
		}
	}
	if strings.Contains(up, `name: "updated"`) {
		t.Error("an append-only log has no updated field")
	}
	if !strings.Contains(down, `countRecords("admin_audit_log")`) || !strings.Contains(down, "throw new Error(") {
		t.Error("down path must refuse to drop a log that holds entries")
	}
}
