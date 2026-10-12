package sync

import (
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

// getRecordName labels the "Deleting orphaned record" INFO line, which
// production emits to the container log -- outside the app's RBAC. A person's
// row must be labelled by CampMinder ID, never by first and last name.
func TestGetRecordNameLabelsPeopleByCampMinderID(t *testing.T) {
	t.Parallel()

	col := core.NewBaseCollection("persons")
	col.Fields.Add(&core.NumberField{Name: "cm_id"})
	col.Fields.Add(&core.TextField{Name: "first_name"})
	col.Fields.Add(&core.TextField{Name: "last_name"})

	rec := core.NewRecord(col)
	rec.Id = "pbid000000001"
	rec.Set("cm_id", 1000001)
	rec.Set("first_name", "Emma")
	rec.Set("last_name", "Johnson")

	got := (&BaseSyncService{}).getRecordName(rec, "person")

	if strings.Contains(got, "Emma") || strings.Contains(got, "Johnson") {
		t.Fatalf("getRecordName = %q; a person must not be labelled by name", got)
	}
	if !strings.Contains(got, "1000001") {
		t.Fatalf("getRecordName = %q; want the CampMinder ID 1000001", got)
	}
}

// A row with neither a label nor a CampMinder ID still falls back to its
// PocketBase id, so the orphan line always says which row went.
func TestGetRecordNameFallsBackToRecordID(t *testing.T) {
	t.Parallel()

	col := core.NewBaseCollection("households")
	col.Fields.Add(&core.TextField{Name: "greeting"})

	rec := core.NewRecord(col)
	rec.Id = "pbid000000002"

	if got := (&BaseSyncService{}).getRecordName(rec, "household"); !strings.Contains(got, "pbid000000002") {
		t.Fatalf("getRecordName = %q; want the record id", got)
	}
}

// Non-person reference rows (sessions, bunks, divisions) keep their `name`
// label -- it is the useful part of the line and names no one.
func TestGetRecordNameKeepsReferenceLabels(t *testing.T) {
	t.Parallel()

	col := core.NewBaseCollection("bunks")
	col.Fields.Add(&core.NumberField{Name: "cm_id"})
	col.Fields.Add(&core.TextField{Name: "name"})

	rec := core.NewRecord(col)
	rec.Set("cm_id", 2000001)
	rec.Set("name", "B-1")

	if got := (&BaseSyncService{}).getRecordName(rec, "bunk"); got != "B-1" {
		t.Fatalf("getRecordName = %q; want the bunk's own label B-1", got)
	}
}
