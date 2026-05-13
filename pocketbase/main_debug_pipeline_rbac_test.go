package main

import (
	"os"
	"strings"
	"testing"
)

// TestDebugPipelineRBACMigrationUsesBunkingManageRule verifies that
// migration 1500000098_debug_pipeline_rbac.js loosens the admin-only
// listRule/viewRule on the three debug_pipeline_* collections to the
// canonical bunkingManage rule (admin OR users with bunking.manage in
// cached_permissions). This matches the upload endpoint's auth gate
// (requirePermission("bunking.manage", ...) in sync/api.go) so that
// non-admin staff who can upload CSVs can also read the resulting debug
// pipeline status — fixing the cascading 403→phase=error toolbar banner
// described in #1370.
//
// Test asserts on the migration FILE content rather than runtime behavior
// because applying JS migrations from a Go test requires bootstrapping
// jsvm with the migrations dir, which tests.NewTestApp() does not do.
// pb-js-lint validates syntax; this test locks in the semantics.
func TestDebugPipelineRBACMigrationUsesBunkingManageRule(t *testing.T) {
	const path = "pb_migrations/1500000098_debug_pipeline_rbac.js"
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read migration %s: %v", path, err)
	}
	body := string(content)

	const expectedRule = `'@request.auth.is_admin = true || @request.auth.cached_permissions ~ "bunking.manage"'`
	if !strings.Contains(body, expectedRule) {
		t.Errorf("migration %s must contain canonical bunkingManage rule string %s", path, expectedRule)
	}

	for _, col := range []string{"debug_pipeline_runs", "debug_pipeline_traces", "debug_pipeline_summary"} {
		if !strings.Contains(body, `"`+col+`"`) {
			t.Errorf("migration %s must reference collection %q", path, col)
		}
	}

	for _, fn := range []string{"listRule", "viewRule"} {
		if !strings.Contains(body, fn) {
			t.Errorf("migration %s must set %s", path, fn)
		}
	}

	if !strings.Contains(body, "app.save(") {
		t.Errorf("migration %s must call app.save() to persist rule changes", path)
	}

	if !strings.Contains(body, "migrate((app)") {
		t.Errorf("migration %s must define an up function via migrate((app) => ...)", path)
	}

	if !strings.Contains(body, "}, (app)") {
		t.Errorf("migration %s must define a down function", path)
	}
}
