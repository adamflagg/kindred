package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Campership Reports back end, Part C (D100): financial_aid.funding_sources to finance and development. Asserts on
// the migration FILE for the traps a booted schema cannot show; what it GRANTS is proven against a booted database
// by rbac.TestBootedRolesCarryFinancialAidGrants. Located by suffix so a renumber at build time does not break it.
func readFundingSourcesPermissionMigration(t *testing.T) (path, body string) {
	t.Helper()
	matches, err := filepath.Glob("pb_migrations/*_financial_aid_funding_sources_permission.js")
	if err != nil || len(matches) != 1 {
		t.Fatalf("want exactly one pb_migrations/*_financial_aid_funding_sources_permission.js, got %v (err %v)",
			matches, err)
	}
	content, err := os.ReadFile(matches[0])
	if err != nil {
		t.Fatalf("read %s: %v", matches[0], err)
	}
	return matches[0], string(content)
}

func TestFundingSourcesPermissionGoesToFinanceAndDevelopmentOnly(t *testing.T) {
	path, body := readFundingSourcesPermissionMigration(t)
	for _, want := range []string{
		`const FUNDING_SOURCES = "financial_aid.funding_sources"`,
		`{ slug: "finance", permissions: [FUNDING_SOURCES] }`,
		`{ slug: "development", permissions: [FUNDING_SOURCES] }`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("%s must contain %q", path, want)
		}
	}
	for _, literal := range []string{`"exec"`, `"registrar"`} {
		if strings.Contains(body, literal) {
			t.Errorf("%s names %s: the registrar may not edit Funding sources (D100), and exec is the owner's", path, literal)
		}
	}
}

// The traps 1500000130/154/185 already paid for: a json field read through get() iterates as BYTES; a non-string
// entry mints a garbage permission; a bare catch turns a real DB error into a silent partial migration; and a
// migration must recompute cached_permissions itself, never rely on a hook.
func TestFundingSourcesPermissionMigrationReadsAndRecomputesSafely(t *testing.T) {
	path, body := readFundingSourcesPermissionMigration(t)
	for _, want := range []string{
		`role.getString("permissions")`,
		`parsed.filter((p) => typeof p === "string")`,
		"function isNotFoundError(err)",
		"no rows in result set",
		"cached_permissions",
		"function recomputeUser(app, userId)",
		"revokePermissions(app, grant.slug, grant.permissions)",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("%s must contain %q", path, want)
		}
	}
	if strings.Contains(body, "catch (_err)") {
		t.Errorf("%s must not swallow errors unconditionally (catch (_err))", path)
	}
	if strings.Contains(body, "options: {") {
		t.Errorf("%s: v0.23+ ignores an options: {} wrapper silently", path)
	}
}
