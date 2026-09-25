package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Asserts on the migration FILE for the traps a booted schema cannot show
// (see TestLodgingRBACMigrationGrantsBunkingManageWrites for why a Go test
// cannot apply JS migrations). What the migration actually GRANTS is proven
// against a booted database by rbac.TestBootedRolesCarryFinancialAidGrants.
// Located by suffix so a renumber at execution time does not break it.
func readFinancialAidPermissionsMigration(t *testing.T) (path, body string) {
	t.Helper()
	matches, err := filepath.Glob("pb_migrations/*_financial_aid_permissions.js")
	if err != nil || len(matches) != 1 {
		t.Fatalf("want exactly one pb_migrations/*_financial_aid_permissions.js, got %v (err %v)", matches, err)
	}
	content, err := os.ReadFile(matches[0])
	if err != nil {
		t.Fatalf("read %s: %v", matches[0], err)
	}
	return matches[0], string(content)
}

// The exec role belongs to the owner (campership spec §2 item 12): the
// migration must not name it anywhere a call could act on it.
func TestFinancialAidPermissionsMigrationNeverNamesExec(t *testing.T) {
	path, body := readFinancialAidPermissionsMigration(t)
	for _, literal := range []string{`"exec"`, `'exec'`, "`exec`"} {
		if strings.Contains(body, literal) {
			t.Errorf("%s contains the literal %s -- the exec role is not this migration's to touch", path, literal)
		}
	}
}

// The traps 1500000130/154 already paid for: a json field read through get()
// iterates as BYTES; a non-string entry mints a garbage permission; a bare
// catch turns a real DB error into a silent partial migration.
func TestFinancialAidPermissionsMigrationReadsPermissionsSafely(t *testing.T) {
	path, body := readFinancialAidPermissionsMigration(t)
	for _, want := range []string{
		`role.getString("permissions")`,
		`parsed.filter((p) => typeof p === "string")`,
		"function isNotFoundError(err)",
		"no rows in result set",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("%s must contain %q", path, want)
		}
	}
	if strings.Contains(body, "catch (_err)") {
		t.Errorf("%s must not swallow errors unconditionally (catch (_err))", path)
	}
}

// A migration must not rely on the Go user_roles/roles hooks having fired:
// it recomputes cached_permissions itself, over ALL of a user's roles.
func TestFinancialAidPermissionsMigrationRecomputesCachedPermissions(t *testing.T) {
	path, body := readFinancialAidPermissionsMigration(t)
	for _, want := range []string{"cached_permissions", `"user_roles"`, "function recomputeUser(app, userId)"} {
		if !strings.Contains(body, want) {
			t.Errorf("%s must contain %q", path, want)
		}
	}
	if !strings.Contains(body, "migrate((app)") || !strings.Contains(body, "}, (app)") {
		t.Errorf("%s must define both up and down", path)
	}
	if strings.Contains(body, "options: {") {
		t.Errorf("%s: v0.23+ ignores an options: {} wrapper silently", path)
	}
}
