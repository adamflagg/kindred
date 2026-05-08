package main

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// TestHistorySyncRemovesOrphanRows verifies that running migrate history-sync
// (the operation invoked by the OnServe hook in main.go) removes _migrations
// rows whose files are not present in the runner's migrations list.
//
// This validates the API call that the OnServe hook uses. The hook itself is
// pure plumbing that calls the same runner.Run("history-sync") at server boot.
func TestHistorySyncRemovesOrphanRows(t *testing.T) {
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	defer app.Cleanup()

	// Ensure the _migrations table exists. NewTestApp may have already created
	// it via PB's internal init; CREATE TABLE IF NOT EXISTS is idempotent.
	if _, err := app.DB().NewQuery(
		"CREATE TABLE IF NOT EXISTS _migrations (file VARCHAR(255) PRIMARY KEY NOT NULL, applied INTEGER NOT NULL)",
	).Execute(); err != nil {
		t.Fatalf("ensure _migrations table: %v", err)
	}

	// Seed an orphan row for a file that doesn't exist in core.AppMigrations.
	const orphanFile = "1500000999_test_orphan_should_be_removed.js"
	if _, err := app.DB().NewQuery(
		"INSERT OR REPLACE INTO _migrations (file, applied) VALUES ({:file}, 1)",
	).Bind(map[string]any{"file": orphanFile}).Execute(); err != nil {
		t.Fatalf("seed orphan row: %v", err)
	}

	// Sanity: orphan present before sync.
	var beforeCount int
	if err := app.DB().NewQuery(
		"SELECT COUNT(*) FROM _migrations WHERE file = {:file}",
	).Bind(map[string]any{"file": orphanFile}).Row(&beforeCount); err != nil {
		t.Fatalf("count before: %v", err)
	}
	if beforeCount != 1 {
		t.Fatalf("expected orphan row present before sync, got count=%d", beforeCount)
	}

	// Run history-sync — the same call the OnServe hook makes.
	runner := core.NewMigrationsRunner(app, core.AppMigrations)
	if err := runner.Run("history-sync"); err != nil {
		t.Fatalf("run history-sync: %v", err)
	}

	// Orphan should be gone.
	var afterCount int
	if err := app.DB().NewQuery(
		"SELECT COUNT(*) FROM _migrations WHERE file = {:file}",
	).Bind(map[string]any{"file": orphanFile}).Row(&afterCount); err != nil {
		t.Fatalf("count after: %v", err)
	}
	if afterCount != 0 {
		t.Fatalf("expected orphan row removed after sync, got count=%d", afterCount)
	}

	// Idempotency: running again with no orphans is a no-op (no error).
	if err := runner.Run("history-sync"); err != nil {
		t.Fatalf("run history-sync second time: %v", err)
	}
}
