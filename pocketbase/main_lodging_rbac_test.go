package main

import (
	"os"
	"strings"
	"testing"
)

// The canonical rule string used everywhere in this repo for "an admin, or a
// user whose role carries bunking.manage". Duplicated verbatim from the
// migrations rather than shared, because the assertion's whole value is that
// it fails when the migration drifts from the canonical spelling.
const bunkingManageRule = `'@request.auth.is_admin = true || @request.auth.cached_permissions ~ "bunking.manage"'`

const lodgingRBACMigration = "pb_migrations/1500000130_lodging_bunking_manage_rbac.js"

// lodgingStaffWritable is every lodging collection a staff surface writes:
// the admin editor (areas, units, aliases, the ingest work queue) and the
// board and map that follow it (merges, availability, assignments and their
// history).
var lodgingStaffWritable = []string{
	"lodging_areas",
	"lodging_units",
	"lodging_unit_aliases",
	"lodging_merges",
	"lodging_availability",
	"lodging_assignments",
	"lodging_assignment_history",
	"lodging_ingest_issues",
}

func readLodgingRBACMigration(t *testing.T) string {
	t.Helper()
	content, err := os.ReadFile(lodgingRBACMigration)
	if err != nil {
		t.Fatalf("read migration %s: %v", lodgingRBACMigration, err)
	}
	return string(content)
}

// TestLodgingRBACMigrationGrantsBunkingManageWrites verifies that migration
// 1500000130 replaces the admin-only create/update/delete rules the lodging
// collections were created with (1500000116-1500000122) with the canonical
// bunkingManage rule, so non-admin bunking staff can confirm cabins and
// resolve ingest names.
//
// Asserts on the migration FILE rather than runtime behavior: applying JS
// migrations from a Go test needs jsvm bootstrapped against the migrations
// dir, which tests.NewTestApp() does not do. pb-js-lint checks syntax; this
// locks in the semantics. Same approach as
// TestDebugPipelineRBACMigrationUsesBunkingManageRule.
func TestLodgingRBACMigrationGrantsBunkingManageWrites(t *testing.T) {
	body := readLodgingRBACMigration(t)

	if !strings.Contains(body, bunkingManageRule) {
		t.Errorf("migration %s must contain the canonical bunkingManage rule %s",
			lodgingRBACMigration, bunkingManageRule)
	}

	for _, col := range lodgingStaffWritable {
		if !strings.Contains(body, `"`+col+`"`) {
			t.Errorf("migration %s must reference collection %q", lodgingRBACMigration, col)
		}
	}

	for _, rule := range []string{"createRule", "updateRule", "deleteRule"} {
		if !strings.Contains(body, rule) {
			t.Errorf("migration %s must set %s", lodgingRBACMigration, rule)
		}
	}

	if !strings.Contains(body, "app.save(") {
		t.Errorf("migration %s must call app.save() to persist rule changes", lodgingRBACMigration)
	}
	if !strings.Contains(body, "migrate((app)") {
		t.Errorf("migration %s must define an up function via migrate((app) => ...)", lodgingRBACMigration)
	}
	if !strings.Contains(body, "}, (app)") {
		t.Errorf("migration %s must define a down function", lodgingRBACMigration)
	}
}

// TestLodgingRBACMigrationLeavesFieldMappingsAdminOnly guards the one lodging
// collection that is NOT staff-writable. lodging_field_mappings is ingest
// plumbing — which CampMinder custom fields feed which derived column —
// written by the Go sync as superuser and surfaced in no UI. Widening it
// would let bunking staff silently repoint the ingest.
func TestLodgingRBACMigrationLeavesFieldMappingsAdminOnly(t *testing.T) {
	body := readLodgingRBACMigration(t)

	if strings.Contains(body, `"lodging_field_mappings"`) {
		t.Errorf("migration %s must not widen lodging_field_mappings — it is ingest plumbing, admin-only",
			lodgingRBACMigration)
	}
}

// TestLodgingRBACMigrationKeepsReadsOpen verifies the weekend surfaces stay
// readable by any authenticated user. Reads were never admin-gated; the point
// of this assertion is that the migration does not accidentally tighten them
// while loosening writes, which would blank the roster for everyone but
// bunking staff.
func TestLodgingRBACMigrationKeepsReadsOpen(t *testing.T) {
	body := readLodgingRBACMigration(t)

	const authed = `'@request.auth.id != ""'`
	if !strings.Contains(body, authed) {
		t.Errorf("migration %s must keep list/view at %s so the roster stays readable by any authenticated user",
			lodgingRBACMigration, authed)
	}
	for _, rule := range []string{"listRule", "viewRule"} {
		if !strings.Contains(body, rule) {
			t.Errorf("migration %s must set %s explicitly rather than leaving it to drift",
				lodgingRBACMigration, rule)
		}
	}
}

// TestLodgingRBACMigrationGrantsPHIToBunkingStaff verifies the migration adds
// lodging.phi to the Bunking Staff role. Before this, lodging.phi was granted
// to no role at all (#1887), so the medical reveal on the weekend roster was
// reachable only by admin bypass and its 403 path had never run in anger.
func TestLodgingRBACMigrationGrantsPHIToBunkingStaff(t *testing.T) {
	body := readLodgingRBACMigration(t)

	if !strings.Contains(body, `"lodging.phi"`) {
		t.Errorf("migration %s must grant the lodging.phi permission", lodgingRBACMigration)
	}
	if !strings.Contains(body, `"bunking-staff"`) {
		t.Errorf("migration %s must target the bunking-staff role by slug", lodgingRBACMigration)
	}
	// The Go hooks recompute cached_permissions on user_roles writes and on
	// roles updates, but a migration that edits a role must not depend on a
	// hook firing during bootstrap: without an explicit recompute, every
	// existing bunking-staff user keeps a stale cached_permissions array and
	// the grant is invisible until someone re-saves the role by hand.
	if !strings.Contains(body, "cached_permissions") {
		t.Errorf("migration %s must recompute cached_permissions for users holding the role",
			lodgingRBACMigration)
	}
	if !strings.Contains(body, "user_roles") {
		t.Errorf("migration %s must find affected users via user_roles to recompute their permissions",
			lodgingRBACMigration)
	}
}
