package main

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

const usersAuthHardeningMigration = "pb_migrations/1500000181_users_auth_hardening.js"

// TestUsersAuthHardeningMigrationSetsHardenedRules pins the migration that
// codifies the 2026-09-24 production fix. Asserts on the FILE, like the other
// migration tests here, because tests.NewTestApp() does not run JS migrations.
// What the migration actually PRODUCES on a booted database is checked by
// rbac.TestBootedSchemaAuthRules in CI's Migrations & Schema Agreement job,
// and the resulting behavior by rbac.TestUsersAuthHardening.
func TestUsersAuthHardeningMigrationSetsHardenedRules(t *testing.T) {
	content, err := os.ReadFile(usersAuthHardeningMigration)
	if err != nil {
		t.Fatalf("read %s: %v", usersAuthHardeningMigration, err)
	}
	body := string(content)
	up, _, found := strings.Cut(body, "}, (app) => {")
	if !found {
		t.Fatalf("%s: could not find the up/down boundary", usersAuthHardeningMigration)
	}

	for _, want := range []string{
		`'@request.context = "oauth2"'`,   // users create: OAuth2 sign-up only
		`'@request.auth.is_admin = true'`, // solver_runs reads
		`"_pb_users_auth_"`,
		`"solver_runs"`,
		`"debug_parse_results"`,
		"passwordAuth",
	} {
		if !strings.Contains(up, want) {
			t.Errorf("%s up() must contain %s", usersAuthHardeningMigration, want)
		}
	}

	// The provider config (client id/secret, URLs) is set per deployment by
	// scripts/setup/configure_pocketbase_oauth.py. A migration that rewrote it
	// would log every staff member out of a working IdP.
	if strings.Contains(up, "providers") {
		t.Errorf("%s up() must not touch the OAuth2 providers", usersAuthHardeningMigration)
	}
}

// denyAllEmptyString matches the pattern that left collections public:
// binding "" to a name that claims it denies access.
var denyAllEmptyString = regexp.MustCompile(`(?i)deny\w*\s*=\s*(''|"")`)

// TestNoMigrationTreatsEmptyStringAsDeny guards the root cause. In PocketBase
// a "" rule is PUBLIC -- anyone, guests included -- while nil is superusers
// only. Migrations 1500000023 and 1500000027 bound "" as "denyAll", which left
// solver_runs and debug_parse_results open to the internet.
func TestNoMigrationTreatsEmptyStringAsDeny(t *testing.T) {
	files, err := filepath.Glob("pb_migrations/*.js")
	if err != nil || len(files) == 0 {
		t.Fatalf("glob pb_migrations: %v (%d files)", err, len(files))
	}
	for _, f := range files {
		content, err := os.ReadFile(f)
		if err != nil {
			t.Fatalf("read %s: %v", f, err)
		}
		if loc := denyAllEmptyString.FindIndex(content); loc != nil {
			t.Errorf("%s binds \"\" as a deny rule (%q) -- \"\" is PUBLIC in PocketBase; use null",
				f, content[loc[0]:loc[1]])
		}
	}
}
