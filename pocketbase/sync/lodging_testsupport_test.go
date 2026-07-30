package sync

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// newLodgingTestApp returns a throwaway PocketBase app carrying every collection
// the lodging ingest reads or writes, shaped like production's.
//
// It deliberately builds collections in Go rather than replaying pb_migrations:
// `pocketbase migrate up` silently skips JS migrations (jsvm captures its
// MigrationsDir at plugin-registration time, before flag parsing), so a Go test
// cannot apply them. Schema fidelity against the real migrations is the job of
// scripts/dev/verify-lodging-schema.sh; these fixtures only need the fields the
// code under test touches.
func newLodgingTestApp(t *testing.T) core.App {
	t.Helper()
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)

	defs := core.NewBaseCollection("custom_field_defs")
	defs.Fields.Add(&core.NumberField{Name: "cm_id"})
	defs.Fields.Add(&core.TextField{Name: "name"})
	saveCollection(t, app, defs)

	sessions := core.NewBaseCollection("camp_sessions")
	sessions.Fields.Add(&core.NumberField{Name: "cm_id"})
	sessions.Fields.Add(&core.TextField{Name: "name"})
	sessions.Fields.Add(&core.TextField{Name: "session_type"})
	sessions.Fields.Add(&core.DateField{Name: "start_date"})
	sessions.Fields.Add(&core.DateField{Name: "end_date"})
	sessions.Fields.Add(&core.NumberField{Name: "year"})
	saveCollection(t, app, sessions)

	households := core.NewBaseCollection("households")
	households.Fields.Add(&core.NumberField{Name: "cm_id"})
	households.Fields.Add(&core.NumberField{Name: "year"})
	saveCollection(t, app, households)

	persons := core.NewBaseCollection("persons")
	persons.Fields.Add(&core.NumberField{Name: "cm_id"})
	persons.Fields.Add(&core.NumberField{Name: "household_id"})
	persons.Fields.Add(&core.RelationField{Name: "household", CollectionId: households.Id, MaxSelect: 1})
	persons.Fields.Add(&core.NumberField{Name: "year"})
	saveCollection(t, app, persons)

	attendees := core.NewBaseCollection("attendees")
	attendees.Fields.Add(&core.RelationField{Name: "person", CollectionId: persons.Id, MaxSelect: 1})
	attendees.Fields.Add(&core.NumberField{Name: "person_id"})
	attendees.Fields.Add(&core.RelationField{Name: "session", CollectionId: sessions.Id, MaxSelect: 1})
	attendees.Fields.Add(&core.NumberField{Name: "status_id"})
	attendees.Fields.Add(&core.NumberField{Name: "year"})
	saveCollection(t, app, attendees)

	hcv := core.NewBaseCollection("household_custom_values")
	hcv.Fields.Add(&core.RelationField{Name: "household", CollectionId: households.Id, MaxSelect: 1})
	hcv.Fields.Add(&core.RelationField{Name: "field_definition", CollectionId: defs.Id, MaxSelect: 1})
	hcv.Fields.Add(&core.TextField{Name: "value"})
	// TEXT, not date: production stores CampMinder's raw .NET timestamp here,
	// e.g. "2025-04-21T17:51:11.5964281+00:00".
	hcv.Fields.Add(&core.TextField{Name: "last_updated"})
	hcv.Fields.Add(&core.NumberField{Name: "year"})
	saveCollection(t, app, hcv)

	pcv := core.NewBaseCollection("person_custom_values")
	pcv.Fields.Add(&core.RelationField{Name: "person", CollectionId: persons.Id, MaxSelect: 1})
	pcv.Fields.Add(&core.RelationField{Name: "field_definition", CollectionId: defs.Id, MaxSelect: 1})
	pcv.Fields.Add(&core.TextField{Name: "value"})
	pcv.Fields.Add(&core.TextField{Name: "last_updated"})
	pcv.Fields.Add(&core.NumberField{Name: "year"})
	saveCollection(t, app, pcv)

	units := core.NewBaseCollection("lodging_units")
	units.Fields.Add(&core.TextField{Name: "name"})
	units.Fields.Add(&core.TextField{Name: "code"})
	units.Fields.Add(&core.NumberField{Name: "sleeps"})
	units.Fields.Add(&core.BoolField{Name: "is_active"})
	units.Fields.Add(&core.BoolField{Name: "is_container"})
	saveCollection(t, app, units)

	aliases := core.NewBaseCollection("lodging_unit_aliases")
	aliases.Fields.Add(&core.TextField{Name: "alias_string"})
	aliases.Fields.Add(&core.RelationField{Name: "member_units", CollectionId: units.Id, MaxSelect: 20})
	aliases.Fields.Add(&core.NumberField{Name: "valid_from_year"})
	aliases.Fields.Add(&core.NumberField{Name: "valid_to_year"})
	aliases.Fields.Add(&core.TextField{Name: "source_field"})
	saveCollection(t, app, aliases)

	merges := core.NewBaseCollection("lodging_merges")
	merges.Fields.Add(&core.RelationField{Name: "session", CollectionId: sessions.Id, MaxSelect: 1})
	merges.Fields.Add(&core.NumberField{Name: "year"})
	merges.Fields.Add(&core.TextField{Name: "scenario"})
	merges.Fields.Add(&core.RelationField{Name: "member_units", CollectionId: units.Id, MaxSelect: 20})
	merges.Fields.Add(&core.TextField{Name: "display_name"})
	merges.Fields.Add(&core.TextField{Name: "created_by"})
	saveCollection(t, app, merges)

	assignments := core.NewBaseCollection("lodging_assignments")
	assignments.Fields.Add(&core.RelationField{Name: "session", CollectionId: sessions.Id, MaxSelect: 1})
	assignments.Fields.Add(&core.NumberField{Name: "year"})
	assignments.Fields.Add(&core.RelationField{Name: "unit", CollectionId: units.Id, MaxSelect: 1})
	assignments.Fields.Add(&core.RelationField{Name: "merge", CollectionId: merges.Id, MaxSelect: 1})
	assignments.Fields.Add(&core.TextField{Name: "scenario"})
	assignments.Fields.Add(&core.NumberField{Name: "household_cm_id"})
	assignments.Fields.Add(&core.NumberField{Name: "person_cm_id"})
	assignments.Fields.Add(&core.NumberField{Name: "party_size"})
	assignments.Fields.Add(&core.TextField{Name: "source"})
	assignments.Fields.Add(&core.BoolField{Name: "staff_touched"})
	assignments.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	assignments.Fields.Add(&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
	saveCollection(t, app, assignments)

	history := core.NewBaseCollection("lodging_assignment_history")
	history.Fields.Add(&core.NumberField{Name: "household_cm_id"})
	history.Fields.Add(&core.NumberField{Name: "person_cm_id"})
	history.Fields.Add(&core.RelationField{Name: "session", CollectionId: sessions.Id, MaxSelect: 1})
	history.Fields.Add(&core.NumberField{Name: "year"})
	history.Fields.Add(&core.TextField{Name: "old_unit"})
	history.Fields.Add(&core.TextField{Name: "new_unit"})
	history.Fields.Add(&core.DateField{Name: "detected_at"})
	history.Fields.Add(&core.TextField{Name: "source_field"})
	// Autodate, because tests sort history by "-created". PocketBase's
	// NewBaseCollection adds only `id`, and sorting on a column that does not
	// exist returns an ERROR -- which a caller discarding err reads as zero rows.
	history.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	saveCollection(t, app, history)

	issues := core.NewBaseCollection("lodging_ingest_issues")
	issues.Fields.Add(&core.TextField{Name: "kind"})
	issues.Fields.Add(&core.TextField{Name: "raw_value"})
	issues.Fields.Add(&core.TextField{Name: "source_field"})
	issues.Fields.Add(&core.NumberField{Name: "year"})
	issues.Fields.Add(&core.NumberField{Name: "household_cm_id"})
	issues.Fields.Add(&core.NumberField{Name: "person_cm_id"})
	issues.Fields.Add(&core.RelationField{Name: "suggested_session", CollectionId: sessions.Id, MaxSelect: 1})
	issues.Fields.Add(&core.RelationField{Name: "resolved_alias", CollectionId: aliases.Id, MaxSelect: 1})
	issues.Fields.Add(&core.JSONField{Name: "candidate_session_cm_ids", MaxSize: 20000})
	issues.Fields.Add(&core.NumberField{Name: "occurrences"})
	issues.Fields.Add(&core.DateField{Name: "first_seen"})
	issues.Fields.Add(&core.DateField{Name: "last_seen"})
	issues.Fields.Add(&core.BoolField{Name: "is_resolved"})
	issues.Fields.Add(&core.TextField{Name: "resolution_note"})
	// Mirrors idx_lodging_issues_dedup from migration 1500000122. Without it the
	// Flush tests would only prove findExisting works, and a divergence between
	// Issue.dedupKey() and the real unique index would pass here then fail in
	// production. The index is the thing that keeps a 472-row backfill from
	// writing 472 rows, so the tests have to exercise it.
	issues.AddIndex("idx_lodging_issues_dedup", true,
		"year, kind, raw_value, source_field, household_cm_id, person_cm_id", "")
	saveCollection(t, app, issues)

	mappings := core.NewBaseCollection("lodging_field_mappings")
	mappings.Fields.Add(&core.NumberField{Name: "field_cm_id"})
	mappings.Fields.Add(&core.TextField{Name: "field_name"})
	mappings.Fields.Add(&core.TextField{Name: "target"})
	mappings.Fields.Add(&core.BoolField{Name: "is_enabled"})
	mappings.Fields.Add(&core.NumberField{Name: "last_seen_year"})
	mappings.Fields.Add(&core.NumberField{Name: "last_seen_count"})
	mappings.Fields.Add(&core.NumberField{Name: "prior_year_count"})
	mappings.Fields.Add(&core.TextField{Name: "note"})
	saveCollection(t, app, mappings)

	return app
}

func saveCollection(t *testing.T, app core.App, col *core.Collection) {
	t.Helper()
	if err := app.Save(col); err != nil {
		t.Fatalf("save collection %s: %v", col.Name, err)
	}
}

func saveRecord(t *testing.T, app core.App, collection string, values map[string]any) string {
	t.Helper()
	col, err := app.FindCollectionByNameOrId(collection)
	if err != nil {
		t.Fatalf("find collection %s: %v", collection, err)
	}
	r := core.NewRecord(col)
	for k, v := range values {
		r.Set(k, v)
	}
	if err := app.Save(r); err != nil {
		t.Fatalf("save %s: %v", collection, err)
	}
	return r.Id
}

func addFieldDef(t *testing.T, app core.App, cmID int, name string) string {
	t.Helper()
	return saveRecord(t, app, "custom_field_defs", map[string]any{"cm_id": cmID, "name": name})
}

// addSession takes start/end in PocketBase's stored date layout,
// e.g. "2025-05-23 07:00:00.000Z".
func addSession(t *testing.T, app core.App, cmID int, name, sessionType, start, end string, year int) string {
	t.Helper()
	return saveRecord(t, app, "camp_sessions", map[string]any{
		"cm_id": cmID, "name": name, "session_type": sessionType,
		"start_date": start, "end_date": end, "year": year,
	})
}

func addHousehold(t *testing.T, app core.App, cmID, year int) string {
	t.Helper()
	return saveRecord(t, app, "households", map[string]any{"cm_id": cmID, "year": year})
}

func addPerson(t *testing.T, app core.App, cmID, householdCMID, year int, householdPBID string) string {
	t.Helper()
	return saveRecord(t, app, "persons", map[string]any{
		"cm_id": cmID, "household_id": householdCMID, "household": householdPBID, "year": year,
	})
}

func addAttendee(t *testing.T, app core.App, personPBID, sessionPBID string, personCMID, statusID, year int) {
	t.Helper()
	saveRecord(t, app, "attendees", map[string]any{
		"person": personPBID, "person_id": personCMID, "session": sessionPBID,
		"status_id": statusID, "year": year,
	})
}

func addUnit(t *testing.T, app core.App, code string) string {
	t.Helper()
	return saveRecord(t, app, "lodging_units", map[string]any{
		"code": code, "name": code, "is_active": true, "is_container": false,
	})
}

// addAlias stores from/to as PocketBase does: 0 means unbounded, never NULL.
func addAlias(t *testing.T, app core.App, aliasString string, unitIDs []string, from, to int) string {
	t.Helper()
	return saveRecord(t, app, "lodging_unit_aliases", map[string]any{
		"alias_string": aliasString, "member_units": unitIDs,
		"valid_from_year": from, "valid_to_year": to,
	})
}

// NOTE: addHouseholdValue / addPersonValue belong here too, but their first
// consumer is Task 11 (the household-grain sync), which ships in the B2 PR.
// Adding them now would leave two permanently-unused helpers in this PR, and the
// `unused` linter fails the pre-push hook on them. B2 appends them to this file
// alongside the code that calls them. The custom-values collections themselves
// are already built by newLodgingTestApp above, so nothing else has to move.
