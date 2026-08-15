package sync

import (
	"context"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/types"
)

// CampMinder ids for the fixture sessions. Shared across the lodging tests
// because session_cm_id is a required column on the placement tables, so a
// session's cm id is now asserted as often as its PB record id -- and the two
// disagreeing is exactly the bug the durable key exists to prevent.
const (
	cmIDFamilyCamp1  = 1309514
	cmIDFamilyCamp6  = 1309519
	cmIDWinterFamily = 1354939
)

// testSessionStart / testSessionEnd are a generic weekend window, shared by
// every test that needs a session but does not care about its dates.
const testSessionStart = "2025-05-23 07:00:00.000Z"
const testSessionEnd = "2025-05-26 07:00:00.000Z"

// newSyncTestApp returns a throwaway PocketBase app carrying every collection
// the lodging ingest reads or writes, shaped like production's.
//
// It deliberately builds collections in Go rather than replaying pb_migrations:
// `pocketbase migrate up` silently skips JS migrations (jsvm captures its
// MigrationsDir at plugin-registration time, before flag parsing), so a Go test
// cannot apply them. Schema fidelity against the real migrations is the job of
// scripts/dev/verify-lodging-schema.sh; these fixtures only need the fields the
// code under test touches.
func newSyncTestApp(t *testing.T) core.App {
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

	// Accompanying adults, scraped from custom-field values rather than enrolled.
	// CampMinder enrolls only the children for family camp, so party_size is wrong
	// without this table.
	adults := core.NewBaseCollection("family_camp_adults")
	adults.Fields.Add(&core.RelationField{Name: "household", CollectionId: households.Id, MaxSelect: 1})
	adults.Fields.Add(&core.NumberField{Name: "year"})
	adults.Fields.Add(&core.NumberField{Name: "adult_number"})
	adults.Fields.Add(&core.TextField{Name: "name"})
	saveCollection(t, app, adults)

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
	// Required, mirroring migration 1500000141. PocketBase's Set on a column
	// that does not exist is a silent no-op, so a fixture that forgot this
	// column would resolve every year against a unit stored at year 0 --
	// exactly the failure this field exists to catch loudly, here. Min/Max/
	// OnlyInt mirror the same migration's `min: 2010, max: 2100, onlyInt:
	// true` -- without them a test can store year: 1 or year: 2025.5 and pass
	// on data the real database would reject.
	units.Fields.Add(&core.NumberField{
		Name: "year", Required: true, OnlyInt: true,
		Min: types.Pointer(2010.0), Max: types.Pointer(2100.0),
	})
	// Composite (code, year), matching production's 1500000141: code alone is
	// no longer unique once a row exists per season. Without this a test can
	// seed two rows sharing (code, year), a shape production refuses.
	units.AddIndex("idx_lodging_units_code", true, "code, year", "")
	saveCollection(t, app, units)

	// parent_unit is a self-relation, so it needs the collection's own id --
	// added after the first save, same as production (1500000116).
	units.Fields.Add(&core.RelationField{Name: "parent_unit", CollectionId: units.Id, MaxSelect: 1})
	saveCollection(t, app, units)

	aliases := core.NewBaseCollection("lodging_unit_aliases")
	aliases.Fields.Add(&core.TextField{Name: "alias_string"})
	aliases.Fields.Add(&core.RelationField{Name: "member_units", CollectionId: units.Id, MaxSelect: 20})
	aliases.Fields.Add(&core.NumberField{Name: "valid_from_year"})
	aliases.Fields.Add(&core.NumberField{Name: "valid_to_year"})
	aliases.Fields.Add(&core.TextField{Name: "source_field"})
	saveCollection(t, app, aliases)

	assignments := core.NewBaseCollection("lodging_assignments")
	// Required, mirroring production. cascadeDelete=false only blocks deleting
	// the parent session while the relation is REQUIRED (migration 1500000124),
	// so a fixture that leaves it optional can save detached placement rows that
	// production rejects -- and would pass a test for the very bug #1879 was.
	assignments.Fields.Add(&core.RelationField{
		Name: "session", CollectionId: sessions.Id, MaxSelect: 1, Required: true,
	})
	// Required, mirroring migration 1500000124. PocketBase treats an unset number
	// as 0 and a required number rejects 0, so a writer that forgets this column
	// fails loudly here instead of only in production.
	assignments.Fields.Add(&core.NumberField{Name: "session_cm_id", Required: true, OnlyInt: true})
	assignments.Fields.Add(&core.NumberField{Name: "year"})
	// Migration 1500000134 collapsed the single-select unit/merge pair into one
	// multi-valued relation -- a merged placement is its own member set now,
	// not a row naming it.
	assignments.Fields.Add(&core.RelationField{Name: "units", CollectionId: units.Id, MaxSelect: 20})
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
	// Optional here, unlike the placement tables: migration 1500000124 leaves the
	// audit trail's session relation nullable so a history row outlives its
	// session, and session_cm_id is what lets that surviving row still name the
	// weekend it described.
	history.Fields.Add(&core.NumberField{Name: "session_cm_id", OnlyInt: true})
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

func addUnit(t *testing.T, app core.App, code string, year int) string {
	t.Helper()
	return saveRecord(t, app, "lodging_units", map[string]any{
		"code": code, "name": code, "is_active": true, "is_container": false, "year": year,
	})
}

// addContainerUnit adds a building/grouping row -- the parent a room hangs
// off. Nothing validates a merge against this shape (see
// docs/architecture/lodging-occupancy.md); it models physical structure.
func addContainerUnit(t *testing.T, app core.App, code string, year int) string {
	t.Helper()
	return saveRecord(t, app, "lodging_units", map[string]any{
		"code": code, "name": code, "is_active": true, "is_container": true, "year": year,
	})
}

// addUnitWithParent is addUnit plus the parent_unit link a legal merge fixture
// needs.
func addUnitWithParent(t *testing.T, app core.App, code, parentID string, year int) string {
	t.Helper()
	return saveRecord(t, app, "lodging_units", map[string]any{
		"code": code, "name": code, "is_active": true, "is_container": false,
		"parent_unit": parentID, "year": year,
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

// addAliasWithDanglingMember is addAlias but bypasses relation validation, for
// tests modeling a member_units id that names no lodging_units row at all --
// the unit was deleted after the alias was authored. app.Save refuses that
// shape outright (RelationField.ValidateValue), so a legitimate write can
// never produce it; SaveNoValidate stages the state a real deletion would
// leave behind, the same reason 1500000134's backfill and
// TestLodgingAssignmentsSyncLabelDropsUnresolvableUnits use it.
func addAliasWithDanglingMember(
	t *testing.T, app core.App, aliasString string, unitIDs []string, from, to int,
) string {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("lodging_unit_aliases")
	if err != nil {
		t.Fatalf("find collection lodging_unit_aliases: %v", err)
	}
	r := core.NewRecord(col)
	r.Set("alias_string", aliasString)
	r.Set("member_units", unitIDs)
	r.Set("valid_from_year", from)
	r.Set("valid_to_year", to)
	if err := app.SaveNoValidate(r); err != nil {
		t.Fatalf("save lodging_unit_aliases (no validate): %v", err)
	}
	return r.Id
}

// addFamilyCampAdult records one accompanying adult. These people are never
// enrolled in CampMinder -- they exist only as custom-field values -- so they are
// invisible to attendees and have to be counted separately for party_size.
func addFamilyCampAdult(t *testing.T, app core.App, householdPBID string, year, adultNumber int, name string) {
	t.Helper()
	saveRecord(t, app, "family_camp_adults", map[string]any{
		"household": householdPBID, "year": year, "adult_number": adultNumber, "name": name,
	})
}

// addPersonValue stores one person custom-field answer. Same shape as
// addHouseholdValue; the person grain is where adult weekends live.
func addPersonValue(
	t *testing.T, app core.App, personPBID, fieldDefPBID, value, lastUpdated string, year int,
) string {
	t.Helper()
	return saveRecord(t, app, "person_custom_values", map[string]any{
		"person": personPBID, "field_definition": fieldDefPBID,
		"value": value, "last_updated": lastUpdated, "year": year,
	})
}

// addHouseholdValue stores one household custom-field answer. lastUpdated is
// CampMinder's raw .NET DateTimeOffset string, not a PocketBase date.
func addHouseholdValue(
	t *testing.T, app core.App, householdPBID, fieldDefPBID, value, lastUpdated string, year int,
) string {
	t.Helper()
	return saveRecord(t, app, "household_custom_values", map[string]any{
		"household": householdPBID, "field_definition": fieldDefPBID,
		"value": value, "last_updated": lastUpdated, "year": year,
	})
}

// assertLodgingCollectionsEmpty fails the test if any of the three tables the
// unguarded #2061 bug churns -- placements, the work queue, and the audit
// trail -- hold a row. A guarded skip must leave all three untouched.
func assertLodgingCollectionsEmpty(t *testing.T, app core.App) {
	t.Helper()
	for _, collection := range []string{
		"lodging_assignments", "lodging_ingest_issues", "lodging_assignment_history",
	} {
		rows, err := app.FindRecordsByFilter(collection, "", "", 0, 0)
		if err != nil {
			t.Fatalf("find %s: %v", collection, err)
		}
		if len(rows) != 0 {
			t.Errorf("%s: got %d rows, want 0 -- the year guard must skip before any lodging write", collection, len(rows))
		}
	}
}

// TestLodgingAssignmentsSyncSkipsWhenRegistryNeverLoaded is #2061: with zero
// lodging_units rows for ANY year, AliasResolver.Resolve can never succeed --
// it is all-or-nothing on (code, year), per its own doc comment -- so every
// cabin string in the household/person grains would otherwise queue an
// unresolved_alias issue and grow lodging_assignment_history forever, on a
// season nobody has loaded a registry for at all. Sync must skip the lodging
// portion and return nil, not fail the whole run.
func TestLodgingAssignmentsSyncSkipsWhenRegistryNeverLoaded(t *testing.T) {
	t.Parallel()
	app := newSyncTestApp(t)
	// No addUnit call anywhere: lodging_units is empty for every year.

	sessionID := addSession(t, app, cmIDFamilyCamp1, "Family Camp 1", "family",
		testSessionStart, testSessionEnd, 2027)
	cabinDef := addFieldDef(t, app, cmIDFamilyCampCabin, fieldNameFamilyCampCabin)
	hh := addHousehold(t, app, 9001, 2027)
	emma := addPerson(t, app, 5001, 9001, 2027, hh)
	addAttendee(t, app, emma, sessionID, 5001, 2, 2027)
	addHouseholdValue(t, app, hh, cabinDef, "Ridge A", testLastUpdated, 2027)

	s := NewLodgingAssignmentsSync(app)
	s.Year = 2027
	if err := s.Sync(context.Background()); err != nil {
		t.Fatalf("Sync: %v, want nil -- a registryless season must skip, not fail the run", err)
	}
	if !s.SyncSuccessful {
		t.Error("SyncSuccessful = false, want true -- a guarded skip is not a failure")
	}
	assertLodgingCollectionsEmpty(t, app)
}

// TestLodgingAssignmentsSyncSkipsWhenSeasonNotRolledForward is the shape #2061
// describes production actually hitting: a prior season's registry exists,
// this one has not been carried forward yet. The alias's stored member id
// still points at the prior year's unit row -- "authored once and never
// re-pointed", per AliasResolver's own doc comment -- so idByCodeYear misses
// for the new year and every cabin unresolves unless the guard catches it
// first.
func TestLodgingAssignmentsSyncSkipsWhenSeasonNotRolledForward(t *testing.T) {
	t.Parallel()
	app := newSyncTestApp(t)
	priorYearUnit := addUnit(t, app, "ridge-a", 2026)
	addAlias(t, app, "Ridge A", []string{priorYearUnit}, 0, 0)
	// No lodging_units row for 2027: roll-forward has not run yet.

	sessionID := addSession(t, app, cmIDFamilyCamp1, "Family Camp 1", "family",
		testSessionStart, testSessionEnd, 2027)
	cabinDef := addFieldDef(t, app, cmIDFamilyCampCabin, fieldNameFamilyCampCabin)
	hh := addHousehold(t, app, 9001, 2027)
	emma := addPerson(t, app, 5001, 9001, 2027, hh)
	addAttendee(t, app, emma, sessionID, 5001, 2, 2027)
	addHouseholdValue(t, app, hh, cabinDef, "Ridge A", testLastUpdated, 2027)

	s := NewLodgingAssignmentsSync(app)
	s.Year = 2027
	if err := s.Sync(context.Background()); err != nil {
		t.Fatalf("Sync: %v, want nil", err)
	}
	assertLodgingCollectionsEmpty(t, app)
}

// TestAliasResolverHasUnitsForYear exercises the two lookups Sync's year guard
// depends on, distinguishing "never loaded" from "not this year".
func TestAliasResolverHasUnitsForYear(t *testing.T) {
	t.Parallel()
	app := newSyncTestApp(t)
	addUnit(t, app, "ridge-a", 2026)

	r, err := NewAliasResolver(app)
	if err != nil {
		t.Fatalf("NewAliasResolver: %v", err)
	}
	if !r.HasAnyUnits() {
		t.Error("HasAnyUnits() = false, want true -- 2026 has a row")
	}
	if !r.HasUnitsForYear(2026) {
		t.Error("HasUnitsForYear(2026) = false, want true")
	}
	if r.HasUnitsForYear(2027) {
		t.Error("HasUnitsForYear(2027) = true, want false -- no row seeded for 2027")
	}
}

// TestAliasResolverHasAnyUnitsFalseWhenEmpty covers the other guard branch:
// no registry loaded for any season at all.
func TestAliasResolverHasAnyUnitsFalseWhenEmpty(t *testing.T) {
	t.Parallel()
	app := newSyncTestApp(t)

	r, err := NewAliasResolver(app)
	if err != nil {
		t.Fatalf("NewAliasResolver: %v", err)
	}
	if r.HasAnyUnits() {
		t.Error("HasAnyUnits() = true, want false -- no lodging_units rows seeded")
	}
	if r.HasUnitsForYear(2027) {
		t.Error("HasUnitsForYear(2027) = true, want false")
	}
}

// TestNewLodgingTestAppCoversBunkAssignmentGrain is kindred#2300: the shared
// fixture builder was lodging-only, so bunk_assignments/staff/bunks/bunk_plans
// only ever got hand-built copies scattered across
// bunk_assignments_protection_test.go, bunk_assignments_grain_test.go and
// stranded_assignment_cleanup_test.go -- none of them covered by
// TestLodgingTestsupportFixtureFieldsExistInProductionSchema, which only
// walks whatever newSyncTestApp builds. This pins that those four
// collections are now built by the shared app, so the drift check picks
// them up with NO edit to the check itself.
func TestNewLodgingTestAppCoversBunkAssignmentGrain(t *testing.T) {
	t.Parallel()
	app := newSyncTestApp(t)
	for _, name := range []string{"bunk_assignments", "staff", "bunks", "bunk_plans"} {
		if _, err := app.FindCollectionByNameOrId(name); err != nil {
			t.Errorf("newSyncTestApp does not build %q: %v", name, err)
		}
	}
}
