package rbac

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/pocketbase/dbx"
)

// TestBootedSchemaHasLastSeenAndOverrides runs in CI's Migrations & Schema
// Agreement job against the migrated database (spec 2026-10-01 §7).
func TestBootedSchemaHasLastSeenAndOverrides(t *testing.T) {
	dbPath := os.Getenv("KINDRED_PROD_SCHEMA_DB")
	if dbPath == "" {
		t.Skip("KINDRED_PROD_SCHEMA_DB not set -- runs in CI's Migrations & Schema Agreement job")
	}
	if !filepath.IsAbs(dbPath) {
		t.Fatalf("KINDRED_PROD_SCHEMA_DB=%q must be absolute", dbPath)
	}
	db, err := dbx.Open("sqlite", dbPath+"?_pragma=query_only(true)")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	var n int
	if err := db.NewQuery("SELECT COUNT(*) FROM pragma_table_info('users') WHERE name = 'last_seen'").Row(&n); err != nil || n != 1 {
		t.Fatalf("users.last_seen present = %d (err %v), want 1", n, err)
	}
	if err := db.NewQuery("SELECT COUNT(*) FROM _collections WHERE name = 'permission_descriptions'").Row(&n); err != nil || n != 1 {
		t.Fatalf("permission_descriptions present = %d (err %v), want 1", n, err)
	}
}
