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

// lodgingStaffWritable is the PLAN side of the split: the registry the editor
// writes (areas, units, aliases, the ingest work queue) plus the two planning
// tables the board will write (merges, availability).
var lodgingStaffWritable = []string{
	"lodging_areas",
	"lodging_units",
	"lodging_unit_aliases",
	"lodging_merges",
	"lodging_availability",
	"lodging_ingest_issues",
}

// lodgingAdminOnly is every lodging collection that must NOT be widened.
var lodgingAdminOnly = []string{
	// Ingest plumbing: which CampMinder field feeds which derived column.
	"lodging_field_mappings",
	// The synced record of truth and its append-only audit trail. Summer's
	// equivalents (bunk_assignments, attendee_status_history) have stayed
	// admin-only through every RBAC revision here; the table summer staff
	// actually write is the DRAFT, bunk_assignments_draft.
	"lodging_assignments",
	"lodging_assignment_history",
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

// TestLodgingRBACMigrationLeavesTheRecordOfTruthAdminOnly guards the three
// lodging collections that must NOT become staff-writable.
//
// The draft-versus-final split is the load-bearing one. Summer has never
// granted bunking.manage on `bunk_assignments` (the synced record of truth) or
// `attendee_status_history` (append-only audit); what staff write there is the
// DRAFT table. Lodging has no draft table yet and nothing writes assignments,
// so widening them would hand out delete on an append-only audit trail with no
// caller to justify it. `lodging_field_mappings` is a separate case: ingest
// plumbing whose contents change what every lodging read means.
func TestLodgingRBACMigrationLeavesTheRecordOfTruthAdminOnly(t *testing.T) {
	body := readLodgingRBACMigration(t)

	// Look only at the executable list, not the prose: the migration's comments
	// name these collections precisely to explain why they are excluded, and a
	// whole-file substring check would trip over its own rationale.
	start := strings.Index(body, "const LODGING_STAFF_WRITABLE = [")
	if start == -1 {
		t.Fatalf("migration %s must declare LODGING_STAFF_WRITABLE", lodgingRBACMigration)
	}
	end := strings.Index(body[start:], "]")
	if end == -1 {
		t.Fatalf("migration %s: LODGING_STAFF_WRITABLE is not terminated", lodgingRBACMigration)
	}
	writable := body[start : start+end]

	for _, col := range lodgingAdminOnly {
		if strings.Contains(writable, `"`+col+`"`) {
			t.Errorf("migration %s must not widen %q — see lodgingAdminOnly for why", lodgingRBACMigration, col)
		}
	}
	for _, col := range lodgingStaffWritable {
		if !strings.Contains(writable, `"`+col+`"`) {
			t.Errorf("migration %s must widen %q", lodgingRBACMigration, col)
		}
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
