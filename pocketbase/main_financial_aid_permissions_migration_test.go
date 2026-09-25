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

// extractFunctionBody returns the source between a `function <name>(...) {`
// header and the following top-level `function ` (or, if none follows, the
// end of the file). Good enough for a flat file of sibling functions like
// this migration's -- not a real parser.
func extractFunctionBody(t *testing.T, body, name string) string {
	t.Helper()
	start := strings.Index(body, "function "+name+"(")
	if start == -1 {
		t.Fatalf("function %s not found", name)
	}
	rest := body[start:]
	next := strings.Index(rest[1:], "\nfunction ")
	if next == -1 {
		return rest
	}
	return rest[:next+1]
}

// CodeRabbit finding on PR #2838: removeDevelopmentRole unconditionally
// deleted any role at the "development" slug, so rolling back after a
// pre-existing "development" role happened to occupy that slug destroyed a
// role (and, via the user_roles cascade, its memberships) this migration
// never created. Down must only undo what up did: delete the role ONLY when
// this migration created it, and otherwise just revoke DEVELOPMENT_PERMISSIONS
// -- the same way revokePermissions already does for GRANTS.
func TestFinancialAidPermissionsMigrationDownOnlyDeletesItsOwnDevelopmentRole(t *testing.T) {
	path, body := readFinancialAidPermissionsMigration(t)

	remove := extractFunctionBody(t, body, "removeDevelopmentRole")
	if !strings.Contains(remove, "revokePermissions(app, DEVELOPMENT_SLUG, DEVELOPMENT_PERMISSIONS)") {
		t.Errorf("%s: removeDevelopmentRole must fall back to revokePermissions when the role "+
			"predates this migration, instead of deleting it", path)
	}

	// The fingerprint that tells "this migration's role" apart from a
	// pre-existing one at the same slug -- wherever removeDevelopmentRole
	// gets it from (inline or a helper it calls).
	fingerprint := remove
	if idx := strings.Index(body, "function wasCreatedByThisMigration("); idx != -1 {
		fingerprint += extractFunctionBody(t, body, "wasCreatedByThisMigration")
	}
	if !strings.Contains(fingerprint, "DEVELOPMENT_DESCRIPTION") {
		t.Errorf("%s: down's delete-vs-revoke check must compare DEVELOPMENT_DESCRIPTION -- "+
			"a pre-existing role at the development slug must not be identified as this migration's own", path)
	}
	if !strings.Contains(fingerprint, "is_system") {
		t.Errorf("%s: down's delete-vs-revoke check must compare is_system -- "+
			"description alone is not enough to fingerprint the role this migration created", path)
	}
}
