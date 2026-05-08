package main

import (
	"testing"

	"github.com/pocketbase/pocketbase/tests"
)

// TestHistorySyncRemovesOrphansButPreservesValidRows verifies that
// runHistorySync removes _migrations rows whose files no longer exist on
// disk while LEAVING rows for legitimate migrations alone — including
// system migrations registered to core.SystemMigrations (e.g.
// 1640988000_init.go), which are baked into the PocketBase binary and not
// part of core.AppMigrations.
//
// Regression guard: an earlier version constructed the runner with only
// core.AppMigrations, so RemoveMissingAppliedMigrations deleted every
// _migrations row whose filename wasn't a JS migration — including PB's
// own system migrations — causing subsequent boots to re-apply them and
// fail with "_params exec error: table _params already exists".
func TestHistorySyncRemovesOrphansButPreservesValidRows(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	if _, err := app.DB().NewQuery(
		"CREATE TABLE IF NOT EXISTS _migrations (file VARCHAR(255) PRIMARY KEY NOT NULL, applied INTEGER NOT NULL)",
	).Execute(); err != nil {
		t.Fatalf("ensure _migrations table: %v", err)
	}

	// Seed a system migration row. This filename is registered in
	// core.SystemMigrations (PB internals) and MUST survive history-sync.
	const systemFile = "1640988000_init.go"
	if _, err := app.DB().NewQuery(
		"INSERT OR REPLACE INTO _migrations (file, applied) VALUES ({:file}, 1)",
	).Bind(map[string]any{"file": systemFile}).Execute(); err != nil {
		t.Fatalf("seed system migration row: %v", err)
	}

	// Seed an orphan row that shouldn't exist in either migration list.
	const orphanFile = "1500000999_test_orphan_should_be_removed.js"
	if _, err := app.DB().NewQuery(
		"INSERT OR REPLACE INTO _migrations (file, applied) VALUES ({:file}, 1)",
	).Bind(map[string]any{"file": orphanFile}).Execute(); err != nil {
		t.Fatalf("seed orphan row: %v", err)
	}

	if err := runHistorySync(app); err != nil {
		t.Fatalf("runHistorySync: %v", err)
	}

	// Orphan row removed.
	var orphanCount int
	if err := app.DB().NewQuery(
		"SELECT COUNT(*) FROM _migrations WHERE file = {:file}",
	).Bind(map[string]any{"file": orphanFile}).Row(&orphanCount); err != nil {
		t.Fatalf("count orphan after sync: %v", err)
	}
	if orphanCount != 0 {
		t.Fatalf("expected orphan row removed, got count=%d", orphanCount)
	}

	// System migration row preserved.
	var systemCount int
	if err := app.DB().NewQuery(
		"SELECT COUNT(*) FROM _migrations WHERE file = {:file}",
	).Bind(map[string]any{"file": systemFile}).Row(&systemCount); err != nil {
		t.Fatalf("count system migration after sync: %v", err)
	}
	if systemCount != 1 {
		t.Fatalf(
			"expected system migration row %q preserved, got count=%d "+
				"(deleted by history-sync — would break next boot)",
			systemFile, systemCount,
		)
	}

	// Idempotency: a second invocation with a clean slate is a no-op.
	if err := runHistorySync(app); err != nil {
		t.Fatalf("runHistorySync second time: %v", err)
	}
	if err := app.DB().NewQuery(
		"SELECT COUNT(*) FROM _migrations WHERE file = {:file}",
	).Bind(map[string]any{"file": systemFile}).Row(&systemCount); err != nil {
		t.Fatalf("count system migration after second sync: %v", err)
	}
	if systemCount != 1 {
		t.Fatalf("expected system migration row preserved on second run, got count=%d", systemCount)
	}
}
