package main

import (
	"os"
	"strings"
	"testing"
)

const dropLodgingPHIMigration = "pb_migrations/1500000154_drop_lodging_phi_permission.js"

func readDropLodgingPHIMigration(t *testing.T) string {
	t.Helper()
	content, err := os.ReadFile(dropLodgingPHIMigration)
	if err != nil {
		t.Fatalf("read migration %s: %v", dropLodgingPHIMigration, err)
	}
	return string(content)
}

// TestDropLodgingPHIMigrationRevokesFromBunkingStaff verifies the migration
// removes lodging.phi from the bunking-staff role rather than leaving the
// grant 1500000130 made in place. kindred#2312: the permission itself is
// gone from the application code (ALL_PERMISSIONS is derived from the
// Permission class, so removing the constant already drops it there); this
// is the data-side half that must also stop naming it on the role.
func TestDropLodgingPHIMigrationRevokesFromBunkingStaff(t *testing.T) {
	body := readDropLodgingPHIMigration(t)

	if !strings.Contains(body, `revokePermissionFromRole(app, "bunking-staff", "lodging.phi")`) {
		t.Errorf("migration %s must revoke lodging.phi from bunking-staff", dropLodgingPHIMigration)
	}
}

// TestDropLodgingPHIMigrationRecomputesCachedPermissions guards against the
// same stale-cache trap 1500000130 already had to solve: without an explicit
// recompute, an existing bunking-staff user keeps lodging.phi in their
// cached_permissions blob until someone re-saves the role by hand.
func TestDropLodgingPHIMigrationRecomputesCachedPermissions(t *testing.T) {
	body := readDropLodgingPHIMigration(t)

	if !strings.Contains(body, "cached_permissions") {
		t.Errorf("migration %s must recompute cached_permissions for users holding the role",
			dropLodgingPHIMigration)
	}
	if !strings.Contains(body, "user_roles") {
		t.Errorf("migration %s must find affected users via user_roles to recompute their permissions",
			dropLodgingPHIMigration)
	}
}

// TestDropLodgingPHIMigrationIsReversible verifies the down migration
// re-grants the permission, matching 1500000130's up/down symmetry.
func TestDropLodgingPHIMigrationIsReversible(t *testing.T) {
	body := readDropLodgingPHIMigration(t)

	if !strings.Contains(body, `grantPermissionToRole(app, "bunking-staff", "lodging.phi")`) {
		t.Errorf("migration %s down must re-grant lodging.phi to bunking-staff", dropLodgingPHIMigration)
	}
}

// TestDropLodgingPHIMigrationReadsPermissionsAsGetString guards the same trap
// 1500000130 documents: a PB JS json field is a Go byte slice under the hood,
// and Array.isArray() on it answers true, so an iteration that skips
// getString()+JSON.parse silently corrupts the permissions array instead of
// reading it.
func TestDropLodgingPHIMigrationReadsPermissionsAsGetString(t *testing.T) {
	body := readDropLodgingPHIMigration(t)

	if !strings.Contains(body, `role.getString("permissions")`) {
		t.Errorf("migration %s must read the permissions field via getString(), not a raw Array.isArray() path",
			dropLodgingPHIMigration)
	}
}

// TestDropLodgingPHIMigrationFiltersNonStringPermissions guards against a
// corrupted or hand-edited `permissions` array feeding a non-string entry
// into the cached_permissions union, where it would mint a garbage
// permission key on every affected user (CodeRabbit finding on kindred#2312).
func TestDropLodgingPHIMigrationFiltersNonStringPermissions(t *testing.T) {
	body := readDropLodgingPHIMigration(t)

	if !strings.Contains(body, `parsed.filter((p) => typeof p === "string")`) {
		t.Errorf("migration %s must filter parsed permissions to strings before use",
			dropLodgingPHIMigration)
	}
}

// TestDropLodgingPHIMigrationRethrowsUnexpectedErrors guards against
// findRoleBySlug/recomputeCachedPermissions silently swallowing a real
// database error (a malformed filter, a corrupted index) under the same
// catch that is meant only for "this role/user does not exist yet" -- that
// would let the migration report success while doing less than it claims
// (CodeRabbit finding on kindred#2312). Verified empirically against a copy
// of prod: the only error shape either lookup has ever produced there is the
// not-found sentinel, from three orphaned user_roles rows on bunking-staff.
func TestDropLodgingPHIMigrationRethrowsUnexpectedErrors(t *testing.T) {
	body := readDropLodgingPHIMigration(t)

	if !strings.Contains(body, "function isNotFoundError(err)") {
		t.Errorf("migration %s must distinguish the not-found sentinel from other errors",
			dropLodgingPHIMigration)
	}
	if !strings.Contains(body, "no rows in result set") {
		t.Errorf("migration %s must match PocketBase's not-found error text",
			dropLodgingPHIMigration)
	}
	// Every catch that reads a role or user by id must consult the sentinel
	// rather than swallow unconditionally -- a bare `catch (_err) {` here
	// would be exactly the regression this test exists to catch.
	if strings.Contains(body, "catch (_err) {\n        continue") ||
		strings.Contains(body, "catch (_err) {\n      continue") {
		t.Errorf("migration %s must not unconditionally swallow errors in the recompute loop",
			dropLodgingPHIMigration)
	}
}
