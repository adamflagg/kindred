package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Owner ruling 2026-10-09: financial_aid.funding_sources is folded into financial_aid.grantors. Asserts on the
// migration FILE for the traps a booted schema cannot show; that no booted role holds it afterwards is proven by
// rbac.TestBootedRolesCarryFinancialAidGrants.
func readFundingSourcesRetiredMigration(t *testing.T) (path, body string) {
	t.Helper()
	matches, err := filepath.Glob("pb_migrations/*_financial_aid_funding_sources_permission_retired.js")
	if err != nil || len(matches) != 1 {
		t.Fatalf("want exactly one pb_migrations/*_financial_aid_funding_sources_permission_retired.js, got %v (err %v)",
			matches, err)
	}
	content, err := os.ReadFile(matches[0])
	if err != nil {
		t.Fatalf("read %s: %v", matches[0], err)
	}
	return matches[0], string(content)
}

func TestFundingSourcesRetiredMigrationRevokesFromEveryRoleAndRestoresOnDown(t *testing.T) {
	path, body := readFundingSourcesRetiredMigration(t)
	for _, want := range []string{
		`const FUNDING_SOURCES = "financial_aid.funding_sources"`,
		"function revokeFromEveryRole(app)",
		`{ slug: "finance", permissions: [FUNDING_SOURCES] }`,
		`{ slug: "development", permissions: [FUNDING_SOURCES] }`,
		"grantPermissions(app, grant.slug, grant.permissions)",
		`role.getString("permissions")`,
		`parsed.filter((p) => typeof p === "string")`,
		"function isNotFoundError(err)",
		"function recomputeUser(app, userId)",
		"cached_permissions",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("%s must contain %q", path, want)
		}
	}
	for _, literal := range []string{`"exec"`, `"registrar"`} {
		if strings.Contains(body, literal) {
			t.Errorf("%s names %s: the restore must not hand it to a role that never held it", path, literal)
		}
	}
	if strings.Contains(body, "catch (_err)") {
		t.Errorf("%s must not swallow errors unconditionally (catch (_err))", path)
	}
	if strings.Contains(body, "options: {") {
		t.Errorf("%s: v0.23+ ignores an options: {} wrapper silently", path)
	}
}
