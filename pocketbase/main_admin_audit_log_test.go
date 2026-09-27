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

// pocketbaseUpstream is the literal `reverse_proxy <upstream> {` string each
// Caddyfile uses for its PocketBase target: docker/Caddyfile addresses it by
// compose service name, frontend/Caddyfile by loopback + a port var.
var pocketbaseUpstream = map[string]string{
	"../docker/Caddyfile":   "reverse_proxy {$POCKETBASE_HOST:pocketbase}:8090 {",
	"../frontend/Caddyfile": "reverse_proxy 127.0.0.1:{$POCKETBASE_PORT:8090} {",
}

// TestCaddyPassesTheRealClientIPToPocketBase: migration 1500000207 makes
// PocketBase trust X-Real-IP on EVERY request it receives, not only ones
// through @pocketbase's own handler -- so EVERY reverse_proxy block that
// targets PocketBase (the oauth2-redirect rewrite and the /_/* admin-UI gate,
// as well as @pocketbase itself) must overwrite the header with Caddy's own
// resolved client address, or a client could forge it on the routes this test
// doesn't check. Brace-matched (not a naive "\n\t}\n" search) because the
// oauth2-redirect block nests its own handle_response blocks.
func TestCaddyPassesTheRealClientIPToPocketBase(t *testing.T) {
	for _, path := range []string{"../docker/Caddyfile", "../frontend/Caddyfile"} {
		upstream := pocketbaseUpstream[path]
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %s: %v", path, err)
		}
		src := string(raw)
		blocks := pocketbaseReverseProxyBlocks(t, path, src, upstream)
		// Today's file has 3: @pocketbase, /api/oauth2-redirect, /_/*. Asserting
		// a floor (not just non-empty) means a future edit that deletes a block
		// can't make this test pass by having nothing left to check.
		if len(blocks) < 3 {
			t.Fatalf("%s: found %d PocketBase reverse_proxy block(s) for %q, want >= 3 -- upstream string stale?",
				path, len(blocks), upstream)
		}
		for i, block := range blocks {
			if !strings.Contains(block, "header_up X-Real-IP {client_ip}") {
				t.Errorf("%s: reverse_proxy block #%d targeting PocketBase must set header_up X-Real-IP {client_ip}:\n%s",
					path, i+1, block)
			}
		}
	}
}

// pocketbaseReverseProxyBlocks returns the body of every `<upstream> ... }`
// block in src, brace-matched from the "{" upstream already ends with so a
// nested block (like oauth2-redirect's handle_response) doesn't truncate the
// search at its own inner "}".
func pocketbaseReverseProxyBlocks(t *testing.T, path, src, upstream string) []string {
	t.Helper()
	var blocks []string
	searchFrom := 0
	for {
		rel := strings.Index(src[searchFrom:], upstream)
		if rel < 0 {
			break
		}
		at := searchFrom + rel
		start := at + len(upstream) // just past the opening "{" upstream ends with
		depth := 1
		i := start
		for ; i < len(src) && depth > 0; i++ {
			switch src[i] {
			case '{':
				depth++
			case '}':
				depth--
			}
		}
		if depth != 0 {
			t.Fatalf("%s: reverse_proxy block starting at byte %d never closes (unbalanced braces)", path, at)
		}
		blocks = append(blocks, src[start:i])
		searchFrom = i
	}
	return blocks
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
