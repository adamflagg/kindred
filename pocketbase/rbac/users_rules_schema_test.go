package rbac

import (
	"encoding/json"
	"os"
	"testing"
)

// bootedCollection is the slice of a /api/collections item this check reads.
// Rules are *string so a JSON null (superusers only) and "" (PUBLIC) stay
// distinguishable -- conflating them is the bug this guards against.
type bootedCollection struct {
	ID           string  `json:"id"`
	Name         string  `json:"name"`
	ListRule     *string `json:"listRule"`
	ViewRule     *string `json:"viewRule"`
	CreateRule   *string `json:"createRule"`
	UpdateRule   *string `json:"updateRule"`
	DeleteRule   *string `json:"deleteRule"`
	PasswordAuth *struct {
		Enabled bool `json:"enabled"`
	} `json:"passwordAuth"`
}

func ruleString(r *string) string {
	if r == nil {
		return "<nil: superusers only>"
	}
	return "\"" + *r + "\""
}

func assertRule(t *testing.T, col, which string, got *string, want *string) {
	t.Helper()
	if (got == nil) != (want == nil) || (got != nil && *got != *want) {
		t.Errorf("%s.%s = %s, want %s", col, which, ruleString(got), ruleString(want))
	}
}

func ptr(s string) *string { return &s }

// TestBootedSchemaAuthRules compares the access rules a PocketBase booted from
// the REAL pb_migrations carries against the constants TestUsersAuthHardening
// uses as its fixture. The runtime tests prove those constants plus the
// request hooks behave; this proves the migrations actually produce those
// constants. Together: migration file -> real schema -> behaviour.
//
// Needs KINDRED_PROD_SCHEMA_JSON: the /api/collections dump that
// .github/workflows/ci.yml's "Migrations & Schema Agreement" job writes after
// booting a fresh database. It SKIPS everywhere else, like
// TestLodgingTestsupportFixtureFieldsExistInProductionSchema (kindred#1921),
// and the CI step that runs it fails if it did not run to PASS.
func TestBootedSchemaAuthRules(t *testing.T) {
	schemaPath := os.Getenv("KINDRED_PROD_SCHEMA_JSON")
	if schemaPath == "" {
		t.Skip("KINDRED_PROD_SCHEMA_JSON not set -- runs in CI's Migrations & Schema Agreement job only")
	}

	raw, err := os.ReadFile(schemaPath)
	if err != nil {
		t.Fatalf("read %s: %v", schemaPath, err)
	}
	var dump struct {
		Items []bootedCollection `json:"items"`
	}
	if err := json.Unmarshal(raw, &dump); err != nil {
		t.Fatalf("parse %s: %v", schemaPath, err)
	}
	byName := make(map[string]bootedCollection, len(dump.Items))
	for _, c := range dump.Items {
		byName[c.Name] = c
	}

	get := func(name string) bootedCollection {
		t.Helper()
		c, ok := byName[name]
		if !ok {
			t.Fatalf("collection %q missing from the booted schema (%d collections)", name, len(dump.Items))
		}
		return c
	}

	users := get("users")
	if users.ID != "_pb_users_auth_" {
		t.Errorf("users id = %q, want _pb_users_auth_", users.ID)
	}
	assertRule(t, "users", "listRule", users.ListRule, ptr(authedRule))
	assertRule(t, "users", "viewRule", users.ViewRule, ptr(authedRule))
	assertRule(t, "users", "createRule", users.CreateRule, ptr(hardenedUsersCreateRule))
	assertRule(t, "users", "updateRule", users.UpdateRule, nil)
	assertRule(t, "users", "deleteRule", users.DeleteRule, nil)
	if users.PasswordAuth == nil {
		t.Errorf("users.passwordAuth missing from the dump -- was it fetched with superuser auth?")
	} else if users.PasswordAuth.Enabled {
		t.Errorf("users.passwordAuth.enabled = true, want false (staff sign in through the IdP only)")
	}

	solverRuns := get("solver_runs")
	assertRule(t, "solver_runs", "listRule", solverRuns.ListRule, ptr(adminOnlyRule))
	assertRule(t, "solver_runs", "viewRule", solverRuns.ViewRule, ptr(adminOnlyRule))
	assertRule(t, "solver_runs", "createRule", solverRuns.CreateRule, nil)
	assertRule(t, "solver_runs", "updateRule", solverRuns.UpdateRule, nil)
	assertRule(t, "solver_runs", "deleteRule", solverRuns.DeleteRule, nil)

	debugParse := get("debug_parse_results")
	for which, got := range map[string]*string{
		"listRule": debugParse.ListRule, "viewRule": debugParse.ViewRule,
		"createRule": debugParse.CreateRule, "updateRule": debugParse.UpdateRule,
		"deleteRule": debugParse.DeleteRule,
	} {
		assertRule(t, "debug_parse_results", which, got, nil)
	}

	// No collection may carry a "" rule. "" lets any guest -- no login at all
	// -- read or write; it is how solver_runs and debug_parse_results were
	// left open, and users' create rule too. As of 2026-09-24 no Kindred
	// collection needs public access. If one ever genuinely does, name it in
	// an allowlist here with the reason, rather than loosening this check.
	for _, c := range dump.Items {
		for which, rule := range map[string]*string{
			"listRule": c.ListRule, "viewRule": c.ViewRule,
			"createRule": c.CreateRule, "updateRule": c.UpdateRule, "deleteRule": c.DeleteRule,
		} {
			if rule != nil && *rule == "" {
				t.Errorf("%s.%s is \"\" -- PUBLIC access, guests included; use nil (superusers only) or a real filter", c.Name, which)
			}
		}
	}
}
