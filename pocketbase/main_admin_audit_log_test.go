package main

import (
	"os"
	"strings"
	"testing"
)

// The admin audit log's migrations, asserted on the FILES (a Go test cannot
// apply JS migrations). What they produce once applied is asserted on the
// booted database by rbac/admin_audit_log_booted_test.go in CI.
const (
	adminAuditLogMigration = "pb_migrations/1500000206_admin_audit_log.js"
	trustedProxyMigration  = "pb_migrations/1500000207_trusted_proxy_real_ip.js"
)

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

func TestTrustedProxyMigration(t *testing.T) {
	up, down := migrationHalves(t, readMigration(t, trustedProxyMigration))
	for _, want := range []string{
		`settings.trustedProxy.headers = ["X-Real-IP"]`,
		"settings.trustedProxy.useLeftmostIP = false",
		"app.save(settings)",
	} {
		if !strings.Contains(up, want) {
			t.Errorf("up path must contain %s", want)
		}
	}
	if !strings.Contains(down, "settings.trustedProxy.headers = []") {
		t.Error("down path must restore PocketBase's default (no trusted header)")
	}
}

// TestCaddyPassesTheRealClientIPToPocketBase: 1500000207 trusts X-Real-IP only
// because both Caddyfiles overwrite it with Caddy's resolved client address on
// every PocketBase route.
func TestCaddyPassesTheRealClientIPToPocketBase(t *testing.T) {
	for _, path := range []string{"../docker/Caddyfile", "../frontend/Caddyfile"} {
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %s: %v", path, err)
		}
		src := string(raw)
		at := strings.Index(src, "handle @pocketbase {")
		if at < 0 {
			t.Fatalf("%s has no handle @pocketbase block", path)
		}
		block := src[at:]
		end := strings.Index(block, "\n\t}\n")
		if end < 0 {
			t.Fatalf("%s: handle @pocketbase block never closes", path)
		}
		block = block[:end]
		if !strings.Contains(block, "header_up X-Real-IP {client_ip}") {
			t.Errorf("%s: handle @pocketbase must set header_up X-Real-IP {client_ip}", path)
		}
	}
}

// TestMainRegistersTheAdminAuditLog: main() is not callable from a test, so the
// one line that turns the audit log on is pinned by source.
func TestMainRegistersTheAdminAuditLog(t *testing.T) {
	src, err := os.ReadFile("main.go")
	if err != nil {
		t.Fatalf("read main.go: %v", err)
	}
	if !strings.Contains(string(src), "audit.Register(app, audit.ConfigFromEnv())") {
		t.Fatal("main.go must call audit.Register(app, audit.ConfigFromEnv())")
	}
}
