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
