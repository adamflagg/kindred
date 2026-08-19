package sync

// Tests for the cabin-value change capture (kindred#2482).
//
// The capture exists because `Family Camp Cabin` (cm_id 218072) holds ONE value
// per household per YEAR, so a household attending two weekends overwrites its
// own cabin and the sync cannot tell which weekend a string belonged to. These
// tests pin the WRITE side only: that a change to a retained cabin field lands
// an append-only row, that a bare last_updated bump does not, that non-cabin
// fields are not retained at all, and that a dry run writes nothing.
//
// Nothing here derives a session from the captured rows -- that is deliberately
// out of scope, and no published value changes as a result of this capture.

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

const (
	testCabinValueOld = "Manzanita 3"
	testCabinValueNew = "Manzanita 7"

	testLastUpdatedGenesis    = "2026-05-14 09:00:00.000Z"
	testLastUpdatedTransition = "2026-08-18 11:30:00.000Z"
	testLastUpdatedBumpOnly   = "2026-08-19 07:15:00.000Z"
)

// addLodgingValueHistoryCollection mirrors the collection created by
// pocketbase/pb_migrations/1500000165_lodging_value_history.js. The sync
// package's fixtures build collections by hand (see the CI note on
// TestLodgingTestsupportFixtureFieldsExistInProductionSchema), so this shape has
// to be kept in step with that migration by hand too.
func addLodgingValueHistoryCollection(t *testing.T, app core.App) {
	t.Helper()

	col := core.NewBaseCollection("lodging_value_history")
	col.Fields.Add(&core.NumberField{Name: "year", Required: true, OnlyInt: true})
	col.Fields.Add(&core.NumberField{Name: "field_cm_id", Required: true, OnlyInt: true})
	col.Fields.Add(&core.NumberField{Name: "household_cm_id", OnlyInt: true})
	col.Fields.Add(&core.NumberField{Name: "person_cm_id", OnlyInt: true})
	col.Fields.Add(&core.TextField{Name: "source_field", Max: 200})
	col.Fields.Add(&core.TextField{Name: "old_value", Max: 500})
	col.Fields.Add(&core.TextField{Name: "new_value", Max: 500})
	col.Fields.Add(&core.TextField{Name: "source_changed_at", Max: 100})
	col.Fields.Add(&core.DateField{Name: "observed_at"})
	col.Fields.Add(&core.BoolField{Name: "is_genesis"})
	col.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})

	if err := app.Save(col); err != nil {
		t.Fatalf("save lodging_value_history: %v", err)
	}
}

func historyRows(t *testing.T, app core.App) []*core.Record {
	t.Helper()
	rows, err := app.FindRecordsByFilter("lodging_value_history", "", "created", 0, 0)
	if err != nil {
		t.Fatalf("re-query lodging_value_history: %v", err)
	}
	return rows
}

// newHouseholdCabinSync returns a service with its own ProcessedKeys, so the
// duplicate-in-run guard does not fire across the steps of one test.
func newHouseholdCabinSync(app core.App) *HouseholdCustomFieldValuesSync {
	return &HouseholdCustomFieldValuesSync{
		BaseSyncService: BaseSyncService{App: app, ProcessedKeys: map[string]bool{}, Stats: Stats{}},
	}
}

func newPersonCabinSync(app core.App) *PersonCustomFieldValuesSync {
	return &PersonCustomFieldValuesSync{
		BaseSyncService: BaseSyncService{App: app, ProcessedKeys: map[string]bool{}, Stats: Stats{}},
	}
}

// TestHouseholdCabinValueChangeIsCaptured walks the three cases that matter on
// the household grain: the first observation (genesis), a real value change, and
// a bare last_updated bump that must NOT be recorded as a change.
func TestHouseholdCabinValueChangeIsCaptured(t *testing.T) {
	t.Parallel()

	app := newOrphanSweepTestApp(t, "household_custom_values",
		"household", "field_definition", "value", "last_updated")
	addLodgingValueHistoryCollection(t, app)

	fieldDefMapping := map[int]string{cmIDFamilyCampCabin: testFieldDefPBID}
	const householdCMID = 54321

	// --- 1. genesis -------------------------------------------------------
	create := newHouseholdCabinSync(app)
	existing := map[string]*core.Record{}
	if err := create.processHouseholdCustomFieldValue(
		map[string]any{
			"id": float64(cmIDFamilyCampCabin), "value": testCabinValueOld,
			"lastUpdated": testLastUpdatedGenesis,
		},
		householdCMID, testHouseholdPBID, 2026, fieldDefMapping, existing); err != nil {
		t.Fatalf("create: %v", err)
	}

	rows := historyRows(t, app)
	if len(rows) != 1 {
		t.Fatalf("after genesis: %d history rows, want 1", len(rows))
	}
	g := rows[0]
	if !g.GetBool("is_genesis") {
		t.Errorf("genesis row is_genesis = false, want true")
	}
	if g.GetString("old_value") != "" {
		t.Errorf("genesis old_value = %q, want empty", g.GetString("old_value"))
	}
	if g.GetString("new_value") != testCabinValueOld {
		t.Errorf("genesis new_value = %q, want %q", g.GetString("new_value"), testCabinValueOld)
	}
	if g.GetInt("household_cm_id") != householdCMID {
		t.Errorf("genesis household_cm_id = %d, want %d", g.GetInt("household_cm_id"), householdCMID)
	}
	if g.GetInt("person_cm_id") != 0 {
		t.Errorf("genesis person_cm_id = %d, want 0 on the household grain", g.GetInt("person_cm_id"))
	}
	if g.GetInt("field_cm_id") != cmIDFamilyCampCabin {
		t.Errorf("genesis field_cm_id = %d, want %d", g.GetInt("field_cm_id"), cmIDFamilyCampCabin)
	}
	if g.GetString("source_field") != fieldNameFamilyCampCabin {
		t.Errorf("genesis source_field = %q, want %q", g.GetString("source_field"), fieldNameFamilyCampCabin)
	}
	if g.GetString("source_changed_at") != testLastUpdatedGenesis {
		t.Errorf("genesis source_changed_at = %q, want %q",
			g.GetString("source_changed_at"), testLastUpdatedGenesis)
	}
	if g.GetString("observed_at") == "" {
		t.Errorf("genesis observed_at is empty; the dual clock is the point")
	}
	if g.GetInt("year") != 2026 {
		t.Errorf("genesis year = %d, want 2026", g.GetInt("year"))
	}

	seeded, err := app.FindRecordsByFilter("household_custom_values", "", "", 0, 0)
	if err != nil || len(seeded) != 1 {
		t.Fatalf("seed household_custom_values: %d rows, err=%v", len(seeded), err)
	}
	key := testHouseholdPBID + ":" + testFieldDefPBID + "|2026"

	// --- 2. a real value change ------------------------------------------
	change := newHouseholdCabinSync(app)
	if err := change.processHouseholdCustomFieldValue(
		map[string]any{
			"id": float64(cmIDFamilyCampCabin), "value": testCabinValueNew,
			"lastUpdated": testLastUpdatedTransition,
		},
		householdCMID, testHouseholdPBID, 2026, fieldDefMapping,
		map[string]*core.Record{key: seeded[0]}); err != nil {
		t.Fatalf("update: %v", err)
	}

	rows = historyRows(t, app)
	if len(rows) != 2 {
		t.Fatalf("after value change: %d history rows, want 2", len(rows))
	}
	c := rows[1]
	if c.GetBool("is_genesis") {
		t.Errorf("transition row is_genesis = true, want false")
	}
	if c.GetString("old_value") != testCabinValueOld {
		t.Errorf("transition old_value = %q, want %q", c.GetString("old_value"), testCabinValueOld)
	}
	if c.GetString("new_value") != testCabinValueNew {
		t.Errorf("transition new_value = %q, want %q", c.GetString("new_value"), testCabinValueNew)
	}
	if c.GetString("source_changed_at") != testLastUpdatedTransition {
		t.Errorf("transition source_changed_at = %q, want %q",
			c.GetString("source_changed_at"), testLastUpdatedTransition)
	}

	// --- 3. a bare last_updated bump is NOT a change ----------------------
	reloaded, reloadErr := app.FindRecordById("household_custom_values", seeded[0].Id)
	if reloadErr != nil {
		t.Fatalf("reload: %v", reloadErr)
	}
	bump := newHouseholdCabinSync(app)
	if err := bump.processHouseholdCustomFieldValue(
		map[string]any{
			"id": float64(cmIDFamilyCampCabin), "value": testCabinValueNew,
			"lastUpdated": testLastUpdatedBumpOnly,
		},
		householdCMID, testHouseholdPBID, 2026, fieldDefMapping,
		map[string]*core.Record{key: reloaded}); err != nil {
		t.Fatalf("last_updated bump: %v", err)
	}

	if got := len(historyRows(t, app)); got != 2 {
		t.Errorf("a bare last_updated bump wrote history: %d rows, want 2", got)
	}
}

// TestPersonCabinValueChangeIsCaptured is the person-grain twin: the
// `Reportable Family Camp Cabin` field is retained too, keyed on person_cm_id.
func TestPersonCabinValueChangeIsCaptured(t *testing.T) {
	t.Parallel()

	app := newOrphanSweepTestApp(t, "person_custom_values",
		"person", "field_definition", "value", "last_updated")
	addLodgingValueHistoryCollection(t, app)

	fieldDefMapping := map[int]string{cmIDReportableFamilyCampCabin: testFieldDefPBIDPerson}
	const personCMID = 12345

	create := newPersonCabinSync(app)
	if err := create.processPersonCustomFieldValue(
		map[string]any{
			"id": float64(cmIDReportableFamilyCampCabin), "value": testCabinValueOld,
			"lastUpdated": testLastUpdatedGenesis,
		},
		personCMID, testPersonPBID, 2026, fieldDefMapping, map[string]*core.Record{}); err != nil {
		t.Fatalf("create: %v", err)
	}

	rows := historyRows(t, app)
	if len(rows) != 1 {
		t.Fatalf("after genesis: %d history rows, want 1", len(rows))
	}
	if rows[0].GetInt("person_cm_id") != personCMID {
		t.Errorf("person_cm_id = %d, want %d", rows[0].GetInt("person_cm_id"), personCMID)
	}
	if rows[0].GetInt("household_cm_id") != 0 {
		t.Errorf("household_cm_id = %d, want 0 on the person grain", rows[0].GetInt("household_cm_id"))
	}
	if rows[0].GetString("source_field") != fieldNameReportableFamilyCampCabin {
		t.Errorf("source_field = %q, want %q",
			rows[0].GetString("source_field"), fieldNameReportableFamilyCampCabin)
	}

	seeded, err := app.FindRecordsByFilter("person_custom_values", "", "", 0, 0)
	if err != nil || len(seeded) != 1 {
		t.Fatalf("seed person_custom_values: %d rows, err=%v", len(seeded), err)
	}
	key := testPersonPBID + ":" + testFieldDefPBIDPerson + "|2026"

	change := newPersonCabinSync(app)
	if err := change.processPersonCustomFieldValue(
		map[string]any{
			"id": float64(cmIDReportableFamilyCampCabin), "value": testCabinValueNew,
			"lastUpdated": testLastUpdatedTransition,
		},
		personCMID, testPersonPBID, 2026, fieldDefMapping,
		map[string]*core.Record{key: seeded[0]}); err != nil {
		t.Fatalf("update: %v", err)
	}

	rows = historyRows(t, app)
	if len(rows) != 2 {
		t.Fatalf("after value change: %d history rows, want 2", len(rows))
	}
	if rows[1].GetString("old_value") != testCabinValueOld ||
		rows[1].GetString("new_value") != testCabinValueNew {
		t.Errorf("transition = %q -> %q, want %q -> %q",
			rows[1].GetString("old_value"), rows[1].GetString("new_value"),
			testCabinValueOld, testCabinValueNew)
	}
}

// TestNonCabinFieldIsNotRetained pins the ruled retention scope: cabin fields
// only. The medical-adjacent fields are held out on purpose (api/routers/
// lodging.py records that this surface has no access log, deliberately), and
// widening later is a change to the Go registry, not a migration.
func TestNonCabinFieldIsNotRetained(t *testing.T) {
	t.Parallel()

	app := newOrphanSweepTestApp(t, "household_custom_values",
		"household", "field_definition", "value", "last_updated")
	addLodgingValueHistoryCollection(t, app)

	// cmIDFamCampBathroom is one of the deliberately held-out fields.
	fieldDefMapping := map[int]string{cmIDFamCampBathroom: testFieldDefPBID}

	create := newHouseholdCabinSync(app)
	if err := create.processHouseholdCustomFieldValue(
		map[string]any{"id": float64(cmIDFamCampBathroom), "value": "Yes",
			"lastUpdated": testLastUpdatedGenesis},
		54321, testHouseholdPBID, 2026, fieldDefMapping, map[string]*core.Record{}); err != nil {
		t.Fatalf("create: %v", err)
	}

	seeded, err := app.FindRecordsByFilter("household_custom_values", "", "", 0, 0)
	if err != nil || len(seeded) != 1 {
		t.Fatalf("seed: %d rows, err=%v", len(seeded), err)
	}

	change := newHouseholdCabinSync(app)
	if err := change.processHouseholdCustomFieldValue(
		map[string]any{"id": float64(cmIDFamCampBathroom), "value": "No",
			"lastUpdated": testLastUpdatedTransition},
		54321, testHouseholdPBID, 2026, fieldDefMapping,
		map[string]*core.Record{testHouseholdPBID + ":" + testFieldDefPBID + "|2026": seeded[0]}); err != nil {
		t.Fatalf("update: %v", err)
	}

	if got := len(historyRows(t, app)); got != 0 {
		t.Errorf("a held-out field wrote %d history rows; want 0", got)
	}
}

// TestLodgingValueHistoryDryRunWritesNothing: the capture sits after the
// custom-values Save, so DryRun's existing early return gates it structurally.
func TestLodgingValueHistoryDryRunWritesNothing(t *testing.T) {
	t.Parallel()

	app := newOrphanSweepTestApp(t, "household_custom_values",
		"household", "field_definition", "value", "last_updated")
	addLodgingValueHistoryCollection(t, app)

	fieldDefMapping := map[int]string{cmIDFamilyCampCabin: testFieldDefPBID}

	dry := newHouseholdCabinSync(app)
	dry.SetDryRun(true)
	if err := dry.processHouseholdCustomFieldValue(
		map[string]any{"id": float64(cmIDFamilyCampCabin), "value": testCabinValueOld,
			"lastUpdated": testLastUpdatedGenesis},
		54321, testHouseholdPBID, 2026, fieldDefMapping, map[string]*core.Record{}); err != nil {
		t.Fatalf("dry create: %v", err)
	}
	if got := len(historyRows(t, app)); got != 0 {
		t.Fatalf("dry-run create wrote %d history rows; want 0", got)
	}

	// Seed wet, then dry-run a change over it.
	seed := newHouseholdCabinSync(app)
	if err := seed.processHouseholdCustomFieldValue(
		map[string]any{"id": float64(cmIDFamilyCampCabin), "value": testCabinValueOld,
			"lastUpdated": testLastUpdatedGenesis},
		54321, testHouseholdPBID, 2026, fieldDefMapping, map[string]*core.Record{}); err != nil {
		t.Fatalf("seed: %v", err)
	}
	seeded, err := app.FindRecordsByFilter("household_custom_values", "", "", 0, 0)
	if err != nil || len(seeded) != 1 {
		t.Fatalf("seed: %d rows, err=%v", len(seeded), err)
	}
	before := len(historyRows(t, app))

	dryUpdate := newHouseholdCabinSync(app)
	dryUpdate.SetDryRun(true)
	if err := dryUpdate.processHouseholdCustomFieldValue(
		map[string]any{"id": float64(cmIDFamilyCampCabin), "value": testCabinValueNew,
			"lastUpdated": testLastUpdatedTransition},
		54321, testHouseholdPBID, 2026, fieldDefMapping,
		map[string]*core.Record{testHouseholdPBID + ":" + testFieldDefPBID + "|2026": seeded[0]}); err != nil {
		t.Fatalf("dry update: %v", err)
	}
	if got := len(historyRows(t, app)); got != before {
		t.Errorf("dry-run update wrote history: %d rows, want %d", got, before)
	}
}

// TestLodgingValueHistoryRepeatObservationIsIdempotent: the table is append-only
// and carries a unique index on
// (year, field_cm_id, household_cm_id, person_cm_id, source_changed_at, new_value).
// Re-observing the same change -- which a re-run of the same sync does -- must
// not add a second row or surface an error.
func TestLodgingValueHistoryRepeatObservationIsIdempotent(t *testing.T) {
	t.Parallel()

	app := newOrphanSweepTestApp(t, "household_custom_values",
		"household", "field_definition", "value", "last_updated")
	addLodgingValueHistoryCollection(t, app)

	obs := lodgingValueObservation{
		Year:            2026,
		FieldCMID:       cmIDFamilyCampCabin,
		HouseholdCMID:   54321,
		OldValue:        testCabinValueOld,
		NewValue:        testCabinValueNew,
		SourceChangedAt: testLastUpdatedTransition,
	}
	if err := recordLodgingValueChange(app, &obs); err != nil {
		t.Fatalf("first observation: %v", err)
	}
	if err := recordLodgingValueChange(app, &obs); err != nil {
		t.Fatalf("repeat observation: %v", err)
	}
	if got := len(historyRows(t, app)); got != 1 {
		t.Errorf("repeat observation produced %d rows; want 1", got)
	}
}

// TestLodgingValueHistorySkipsEmptyGenesis: a household with no cabin recorded
// yet is not a fact about where anyone slept, so the first observation of an
// empty string is not worth a genesis row. A change TO empty (staff clearing a
// cabin) still is, and is covered by the transition path above.
func TestLodgingValueHistorySkipsEmptyGenesis(t *testing.T) {
	t.Parallel()

	app := newOrphanSweepTestApp(t, "household_custom_values",
		"household", "field_definition", "value", "last_updated")
	addLodgingValueHistoryCollection(t, app)

	fieldDefMapping := map[int]string{cmIDFamilyCampCabin: testFieldDefPBID}
	create := newHouseholdCabinSync(app)
	if err := create.processHouseholdCustomFieldValue(
		map[string]any{"id": float64(cmIDFamilyCampCabin), "value": "",
			"lastUpdated": testLastUpdatedGenesis},
		54321, testHouseholdPBID, 2026, fieldDefMapping, map[string]*core.Record{}); err != nil {
		t.Fatalf("create: %v", err)
	}
	if got := len(historyRows(t, app)); got != 0 {
		t.Errorf("an empty first observation wrote %d genesis rows; want 0", got)
	}
}
