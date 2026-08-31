package main

import (
	"os"
	"strings"
	"testing"
)

// bunkRequestsRBACMigration is the migration that closes kindred#2623:
// bunk_requests carried the full unedited request narrative
// (original_text — measured on prod: 3,200/3,200 rows non-empty, 351 over
// 100 chars, longest 1,139) behind only `@request.auth.id != ""`, i.e.
// readable by ANY authenticated user regardless of role. Every sibling
// collection (original_bunk_requests, bunk_request_sources,
// debug_parse_results) already gates read on a permission.
const bunkRequestsRBACMigration = "pb_migrations/1500000178_bunk_requests_rbac.js"

func readBunkRequestsRBACMigration(t *testing.T) string {
	t.Helper()
	content, err := os.ReadFile(bunkRequestsRBACMigration)
	if err != nil {
		t.Fatalf("read migration %s: %v", bunkRequestsRBACMigration, err)
	}
	return string(content)
}

// TestBunkRequestsRBACMigrationGatesReadOnBunkingManage verifies that the
// migration replaces bunk_requests' permissive `@request.auth.id != ""`
// listRule/viewRule with the canonical bunkingManage rule — the same rule
// its sibling original_bunk_requests carries
// (1500000020_original_bunk_requests.js:25-26).
//
// Asserts on the migration FILE rather than runtime behavior: applying JS
// migrations from a Go test needs jsvm bootstrapped against the migrations
// dir, which tests.NewTestApp() does not do. pb-js-lint checks syntax; this
// locks in the semantics — the same approach as
// TestDebugPipelineRBACMigrationUsesBunkingManageRule and
// TestLodgingRBACMigrationGrantsBunkingManageWrites. That means this test
// pins the RULE STRING that gates list/view, which is exactly what decides
// whether an authenticated user carrying no bunking permission can read the
// collection: today's permissive rule contains no permission check at all,
// so it fails against the string this test requires, and passes only once
// the migration installs the canonical `bunking.manage` check.
//
// ⚖️ OWNER RULING 2026-08-31: gate on bunking.manage, not bunking.view —
// bunking.view was removed system-wide by 1500000077_rbac_simplify_rules.js
// and is held by no role, so gating on it would make the table
// admin-only and break the board for bunking-staff, the role this data is
// for.
func TestBunkRequestsRBACMigrationGatesReadOnBunkingManage(t *testing.T) {
	body := readBunkRequestsRBACMigration(t)

	const bunkingManageRule = `'@request.auth.is_admin = true || @request.auth.cached_permissions ~ "bunking.manage"'`
	if !strings.Contains(body, bunkingManageRule) {
		t.Errorf("migration %s must contain the canonical bunkingManage rule %s",
			bunkRequestsRBACMigration, bunkingManageRule)
	}

	if !strings.Contains(body, `"bunk_requests"`) {
		t.Errorf("migration %s must reference collection %q", bunkRequestsRBACMigration, "bunk_requests")
	}

	// Split on the up/down boundary so the down function's legitimate
	// restoration of the old permissive rule (needed to revert cleanly)
	// doesn't get scanned as if it were the live behavior.
	upIdx := strings.Index(body, "}, (app)")
	if upIdx == -1 {
		t.Fatalf("migration %s: could not locate the up/down boundary", bunkRequestsRBACMigration)
	}
	upBody := body[:upIdx]

	// Pin each assignment individually — not just "the bunkingManage string
	// appears somewhere in the up function" — so a mutation that fixes
	// viewRule but leaves listRule permissive (or vice versa) is caught.
	// Assignments may read the rule from a named constant or spell it
	// inline; either is fine as long as the RESOLVED value is the canonical
	// rule, so check the assignment target against both the constant name
	// and the literal string.
	for _, field := range []string{"listRule", "viewRule"} {
		assignedToConst := strings.Contains(upBody, field+" = BUNK_REQUESTS_RBAC_RULE")
		assignedInline := strings.Contains(upBody, field+" = "+bunkingManageRule)
		if !assignedToConst && !assignedInline {
			t.Errorf("migration %s: %s in the up function must be assigned the canonical bunkingManage rule "+
				"(found neither %q nor an inline %s)",
				bunkRequestsRBACMigration, field, field+" = BUNK_REQUESTS_RBAC_RULE", field)
		}
	}

	// Belt-and-suspenders: no spelling of the old permissive rule — single-
	// or double-quoted, escaped or not — may appear anywhere in the up
	// function. Normalize quote style before comparing so a mutation that
	// merely changes quoting doesn't slip past a literal-string match.
	normalizedUp := strings.NewReplacer(`\"`, `"`, `'`, `"`).Replace(upBody)
	const permissiveRuleNormalized = `"@request.auth.id != """`
	if strings.Contains(normalizedUp, permissiveRuleNormalized) {
		t.Errorf("migration %s must not retain the permissive rule '@request.auth.id != \"\"' in the up function",
			bunkRequestsRBACMigration)
	}

	if !strings.Contains(body, "app.save(") {
		t.Errorf("migration %s must call app.save() to persist rule changes", bunkRequestsRBACMigration)
	}
	if !strings.Contains(body, "migrate((app)") {
		t.Errorf("migration %s must define an up function via migrate((app) => ...)", bunkRequestsRBACMigration)
	}
	if !strings.Contains(body, "}, (app)") {
		t.Errorf("migration %s must define a down function", bunkRequestsRBACMigration)
	}
}

// TestBunkRequestsRBACMigrationRecordsTheRulingAndConsequence guards the
// acceptance criterion that the migration comment records the owner's
// 2026-08-31 bunking.manage ruling AND names the Registrar/Finance
// consequence (those roles, and any zero-role user, currently see the
// pending-request badge, camper tooltips and request panels on the board
// because none of the eleven readers carries a permission check — after
// this migration they silently will not; useBunkRequestsCount catches the
// 403 and returns 0 rather than erroring).
func TestBunkRequestsRBACMigrationRecordsTheRulingAndConsequence(t *testing.T) {
	body := readBunkRequestsRBACMigration(t)

	if !strings.Contains(body, "2026-08-31") {
		t.Errorf("migration %s must record the owner's 2026-08-31 ruling date", bunkRequestsRBACMigration)
	}
	if !strings.Contains(body, "bunking.manage") {
		t.Errorf("migration %s comment must name the bunking.manage ruling", bunkRequestsRBACMigration)
	}
	for _, role := range []string{"Registrar", "Finance"} {
		if !strings.Contains(body, role) {
			t.Errorf("migration %s must name the %s regression this ruling accepts", bunkRequestsRBACMigration, role)
		}
	}
}
