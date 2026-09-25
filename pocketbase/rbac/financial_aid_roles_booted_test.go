package rbac

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/pocketbase/dbx"
)

// The four financial aid permissions (campership spec §14.1), spelled out
// rather than shared: the assertion's value is that it fails when the
// migration drifts from the spec.
var financialAidPermissions = []string{
	"financial_aid.casework",
	"financial_aid.rules",
	"financial_aid.summary",
	"financial_aid.view",
}

type bootedRole struct {
	Name        string
	Permissions []string
	IsSystem    bool
}

// loadBootedRoles reads the roles table of a database built by applying the
// REAL pb_migrations (CI's Migration smoke test, or pocketbase/pb_sp2/boot-schema.sh
// locally). Skips everywhere else, like TestDeclaredUniqueIndexesExistInBootedSchema.
func loadBootedRoles(t *testing.T) map[string]bootedRole {
	t.Helper()
	dbPath := os.Getenv("KINDRED_PROD_SCHEMA_DB")
	if dbPath == "" {
		t.Skip("KINDRED_PROD_SCHEMA_DB not set -- runs in CI's Migrations & Schema Agreement job")
	}
	if !filepath.IsAbs(dbPath) {
		t.Fatalf("KINDRED_PROD_SCHEMA_DB=%q must be absolute: this binary runs in pocketbase/rbac", dbPath)
	}
	db, err := dbx.Open("sqlite", dbPath+"?_pragma=query_only(true)")
	if err != nil {
		t.Fatalf("open %s: %v", dbPath, err)
	}
	t.Cleanup(func() { _ = db.Close() })

	type row struct {
		Slug        string `db:"slug"`
		Name        string `db:"name"`
		Permissions string `db:"permissions"`
		IsSystem    bool   `db:"is_system"`
	}
	var rows []row
	if err := db.NewQuery(
		"SELECT slug, name, COALESCE(permissions, '[]') AS permissions, is_system FROM roles",
	).All(&rows); err != nil {
		t.Fatalf("read roles from %s: %v", dbPath, err)
	}
	if len(rows) == 0 {
		t.Fatalf("roles at %s is empty -- the boot produced nothing to assert against", dbPath)
	}
	roles := make(map[string]bootedRole, len(rows))
	for _, r := range rows {
		var perms []string
		if err := json.Unmarshal([]byte(r.Permissions), &perms); err != nil {
			t.Fatalf("role %s permissions %q: %v", r.Slug, r.Permissions, err)
		}
		roles[r.Slug] = bootedRole{Name: r.Name, Permissions: perms, IsSystem: r.IsSystem}
	}
	return roles
}

// TestBootedRolesCarryFinancialAidGrants proves migration 1500000185 against
// the booted database: finance holds all four, registrar view+casework only,
// a system development role holds summary alone, and no other seeded role
// picked any of them up. (A fresh database has no exec role; that exec is
// untouched is proven by pocketbase/pb_sp2/check-role-migration.sh and pinned
// by TestFinancialAidPermissionsMigrationNeverNamesExec.)
func TestBootedRolesCarryFinancialAidGrants(t *testing.T) {
	roles := loadBootedRoles(t)
	get := func(slug string) bootedRole {
		t.Helper()
		r, ok := roles[slug]
		if !ok {
			t.Fatalf("role %q missing from the booted database", slug)
		}
		return r
	}
	holds := func(slug string, r bootedRole, want ...string) {
		t.Helper()
		for _, p := range want {
			if !slices.Contains(r.Permissions, p) {
				t.Errorf("%s lacks %s (has %v)", slug, p, r.Permissions)
			}
		}
	}
	lacks := func(slug string, r bootedRole, unwanted ...string) {
		t.Helper()
		for _, p := range unwanted {
			if slices.Contains(r.Permissions, p) {
				t.Errorf("%s must not hold %s (has %v)", slug, p, r.Permissions)
			}
		}
	}

	finance := get("finance")
	holds("finance", finance, financialAidPermissions...)
	holds("finance", finance, "metrics.financial", "sheets.export") // seeded grants survive

	registrar := get("registrar")
	holds("registrar", registrar, "financial_aid.view", "financial_aid.casework", "metrics.geo", "registration.manage")
	lacks("registrar", registrar, "financial_aid.rules", "financial_aid.summary")

	development := get("development")
	if !development.IsSystem {
		t.Error("development must be a system role")
	}
	if !slices.Equal(development.Permissions, []string{"financial_aid.summary"}) {
		t.Errorf("development (%q) = %v, want exactly [financial_aid.summary] (never sheets.export, "+
			"bunking.manage or users.manage -- analysis §9.3)", development.Name, development.Permissions)
	}

	for slug, r := range roles {
		if slug == "finance" || slug == "registrar" || slug == "development" {
			continue
		}
		for _, p := range r.Permissions {
			if strings.HasPrefix(p, "financial_aid.") {
				t.Errorf("role %s holds %s; only finance, registrar and development may", slug, p)
			}
		}
	}
}
