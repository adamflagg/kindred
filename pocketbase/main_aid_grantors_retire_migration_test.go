package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The grantor directory (owner ruling 2026-10-01): financial_aid.grantors for the development and
// finance roles, and aid_grantors.retired_at. Like the other aid migration tests this asserts on the
// migration FILE, because tests.NewTestApp() does not run JS migrations; what the roles end up
// holding is proven against a booted database by rbac.TestBootedRolesCarryFinancialAidGrants.
// Located by suffix so a renumber at execution time does not break it.
func readGrantorDirectoryMigration(t *testing.T) (path, up, down string) {
	t.Helper()
	matches, err := filepath.Glob("pb_migrations/*_aid_grantors_permission_and_retire.js")
	if err != nil || len(matches) != 1 {
		t.Fatalf("want exactly one pb_migrations/*_aid_grantors_permission_and_retire.js, got %v (err %v)", matches, err)
	}
	content, err := os.ReadFile(matches[0])
	if err != nil {
		t.Fatalf("read %s: %v", matches[0], err)
	}
	up, down, found := strings.Cut(string(content), "}, (app) => {")
	if !found {
		t.Fatalf("%s: could not find the up/down boundary", matches[0])
	}
	return matches[0], up, down
}

func TestGrantorDirectoryMigrationGrantsDevelopmentAndFinance(t *testing.T) {
	path, up, down := readGrantorDirectoryMigration(t)
	for _, want := range []string{
		`const GRANTORS = "financial_aid.grantors"`,
		`const GRANTED_TO = ["development", "finance"]`,
		"grantPermissions(app, slug, [GRANTORS])",
	} {
		if !strings.Contains(up, want) {
			t.Errorf("%s up must contain %q", path, want)
		}
	}
	if !strings.Contains(down, "revokePermissions(app, slug, [GRANTORS])") {
		t.Errorf("%s down must revoke financial_aid.grantors from the roles up granted it to", path)
	}
	// Additive only: no role is created, deleted or renamed here, and the exec and registrar roles are not
	// this migration's to touch (campership spec §2 item 12; the registrar keeps casework only).
	for _, banned := range []string{`"exec"`, `'exec'`, `"registrar"`, "app.delete(", `set("name"`, `set("slug"`} {
		if strings.Contains(up+down, banned) {
			t.Errorf("%s must not contain %s", path, banned)
		}
	}
}

// The traps 1500000130/154/185 already paid for: a json field read through get() iterates as BYTES;
// a non-string entry mints a garbage permission; a bare catch turns a real DB error into a silent
// partial migration; and a migration must not rely on the Go roles hook to refresh holders.
func TestGrantorDirectoryMigrationReadsAndRecomputesPermissionsSafely(t *testing.T) {
	path, up, down := readGrantorDirectoryMigration(t)
	body := up + down
	for _, want := range []string{
		`role.getString("permissions")`,
		`parsed.filter((p) => typeof p === "string")`,
		"function isNotFoundError(err)",
		"no rows in result set",
		"cached_permissions",
		`"user_roles"`,
		"function recomputeUser(app, userId)",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("%s must contain %q", path, want)
		}
	}
	if strings.Contains(body, "catch (_err)") {
		t.Errorf("%s must not swallow errors unconditionally (catch (_err))", path)
	}
}

func TestGrantorDirectoryMigrationAddsRetiredAt(t *testing.T) {
	path, up, down := readGrantorDirectoryMigration(t)
	for _, want := range []string{
		`findCollectionByNameOrId("aid_grantors")`,
		`fields.add(new Field({ type: "date", name: "retired_at", required: false, presentable: false, min: "", max: "" }))`,
	} {
		if !strings.Contains(up, want) {
			t.Errorf("%s up must contain %q", path, want)
		}
	}
	if strings.Contains(up, "options:") {
		t.Errorf("%s uses an options wrapper, which PocketBase v0.23 ignores silently", path)
	}
	if strings.Contains(up, "Rule =") {
		t.Errorf("%s must not touch aid_grantors' rules: they stay null (spec 14.3)", path)
	}
	if !strings.Contains(down, `removeByName("retired_at")`) {
		t.Errorf("%s down must remove retired_at", path)
	}
}
