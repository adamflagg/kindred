package sync

// Tests for the registration-ask history capture (PR 4a). CampMinder keeps ONE ask per
// camper per season in CA-FinancialAssistanceAmount (28906) and WW-FA Amount (209090), so a
// later registration overwrites it. This table keeps our own dated copy. Nothing reads it yet.

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

const (
	askTestYear      = 2026
	askTestPersonCM  = 4101
	askAt1           = "2026-02-10T17:00:00.000+00:00"
	askAt2           = "2026-03-02T09:30:00.000+00:00"
	askAt3           = "2026-03-09T09:30:00.000+00:00"
	askOtherCMID     = 999002 // any non-ask field
	askFieldPBID     = "askdefpbid0001"
	askPersonPBIDFix = "askpersonpbid01"
)

func addAskHistoryCollection(t *testing.T, app core.App) {
	t.Helper()
	col := core.NewBaseCollection(aidRegistrationAskHistoryCollection)
	col.Fields.Add(&core.NumberField{Name: "year", Required: true, OnlyInt: true})
	col.Fields.Add(&core.NumberField{Name: "person_cm_id", Required: true, OnlyInt: true})
	col.Fields.Add(&core.NumberField{Name: "field_cm_id", Required: true, OnlyInt: true})
	col.Fields.Add(&core.TextField{Name: "old_value", Max: 200})
	col.Fields.Add(&core.TextField{Name: "new_value", Max: 200})
	col.Fields.Add(&core.NumberField{Name: "amount"})
	col.Fields.Add(&core.TextField{Name: "source_changed_at", Max: 100})
	col.Fields.Add(&core.DateField{Name: "observed_at"})
	col.Fields.Add(&core.TextField{Name: "observed_by", Max: 64})
	col.Fields.Add(&core.BoolField{Name: "is_genesis"})
	col.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	// Keep byte-identical in column order to the migration's indexes.
	col.Indexes = []string{
		"CREATE INDEX idx_aid_registration_ask_history_lookup ON aid_registration_ask_history " +
			"(year, field_cm_id, person_cm_id, created)",
		"CREATE INDEX idx_aid_registration_ask_history_person_year ON aid_registration_ask_history (person_cm_id, year)",
	}
	if err := app.Save(col); err != nil {
		t.Fatalf("save %s: %v", aidRegistrationAskHistoryCollection, err)
	}
}

func askRows(t *testing.T, app core.App) []*core.Record {
	t.Helper()
	rows, err := app.FindRecordsByFilter(aidRegistrationAskHistoryCollection, "", "", 0, 0)
	if err != nil {
		t.Fatalf("query ask history: %v", err)
	}
	return rows
}

func askRowFor(t *testing.T, app core.App, newValue string) *core.Record {
	t.Helper()
	var found []*core.Record
	for _, r := range askRows(t, app) {
		if r.GetString("new_value") == newValue {
			found = append(found, r)
		}
	}
	if len(found) != 1 {
		t.Fatalf("want exactly 1 row with new_value=%q, got %d", newValue, len(found))
	}
	return found[0]
}

func newAskHookApp(t *testing.T) core.App {
	t.Helper()
	app := newOrphanSweepTestApp(t, "person_custom_values",
		"person", "field_definition", "value", "last_updated")
	addAskHistoryCollection(t, app)
	return app
}

// askCreate runs the create branch; askUpdate runs the update branch against the stored row.
func askCreate(t *testing.T, app core.App, fieldCM int, value, lastUpdated string, dry bool) {
	t.Helper()
	s := newPersonCabinSync(app)
	s.SetDryRun(dry)
	if err := s.processPersonCustomFieldValue(
		map[string]any{"id": float64(fieldCM), "value": value, "lastUpdated": lastUpdated},
		askTestPersonCM, askPersonPBIDFix, askTestYear, map[int]string{fieldCM: askFieldPBID},
		map[string]*core.Record{}); err != nil {
		t.Fatalf("create: %v", err)
	}
}

func askUpdate(t *testing.T, app core.App, fieldCM int, value, lastUpdated string, dry bool) {
	t.Helper()
	stored, err := app.FindRecordsByFilter("person_custom_values", "", "", 0, 0)
	if err != nil || len(stored) != 1 {
		t.Fatalf("stored custom value: %d rows, err=%v", len(stored), err)
	}
	s := newPersonCabinSync(app)
	s.SetDryRun(dry)
	key := askPersonPBIDFix + ":" + askFieldPBID + "|2026"
	if err := s.processPersonCustomFieldValue(
		map[string]any{"id": float64(fieldCM), "value": value, "lastUpdated": lastUpdated},
		askTestPersonCM, askPersonPBIDFix, askTestYear, map[int]string{fieldCM: askFieldPBID},
		map[string]*core.Record{key: stored[0]}); err != nil {
		t.Fatalf("update: %v", err)
	}
}

// 1. Genesis on create, for 28906 and 209090 only.
func TestAskHistory_GenesisOnCreateForTheTwoAskFieldsOnly(t *testing.T) {
	t.Parallel()
	for _, fieldCM := range []int{cmIDCAFinancialAssistanceAmount, cmIDWWFinancialAssistanceAmount} {
		app := newAskHookApp(t)
		askCreate(t, app, fieldCM, "$4000", askAt1, false)
		rows := askRows(t, app)
		if len(rows) != 1 {
			t.Fatalf("field %d: %d rows, want 1", fieldCM, len(rows))
		}
		r := rows[0]
		if !r.GetBool("is_genesis") || r.GetString("old_value") != "" || r.GetString("new_value") != "$4000" {
			t.Errorf("field %d: genesis shape wrong: genesis=%v old=%q new=%q", fieldCM,
				r.GetBool("is_genesis"), r.GetString("old_value"), r.GetString("new_value"))
		}
		if r.GetInt("field_cm_id") != fieldCM || r.GetInt("person_cm_id") != askTestPersonCM ||
			r.GetInt("year") != askTestYear || r.GetString("source_changed_at") != askAt1 ||
			r.GetFloat("amount") != 4000 {
			t.Errorf("field %d: row columns wrong: %v", fieldCM, r.FieldsData())
		}
		if r.GetString("observed_by") != serviceNamePersonCustomValues {
			t.Errorf("observed_by = %q, want %q", r.GetString("observed_by"), serviceNamePersonCustomValues)
		}
		if r.GetDateTime("observed_at").IsZero() {
			t.Error("observed_at not set")
		}
	}

	// Other fields write nothing here (interest flag, a cabin field).
	for _, fieldCM := range []int{askOtherCMID, cmIDReportableFamilyCampCabin, 999001} {
		app := newAskHookApp(t)
		askCreate(t, app, fieldCM, "Yes", askAt1, false)
		if got := len(askRows(t, app)); got != 0 {
			t.Errorf("field %d wrote %d ask-history rows; want 0", fieldCM, got)
		}
	}
}

// 2. Transition row on a value change; amount is parsed like the mirror parses it.
func TestAskHistory_TransitionRowParsesAmount(t *testing.T) {
	t.Parallel()
	cases := []struct {
		raw  string
		want float64
	}{{"3,695", 3695}, {"$4000", 4000}, {"250.", 250}, {"", 0}, {"abc", 0}}
	for _, c := range cases {
		app := newAskHookApp(t)
		askCreate(t, app, cmIDCAFinancialAssistanceAmount, "100", askAt1, false)
		askUpdate(t, app, cmIDCAFinancialAssistanceAmount, c.raw, askAt2, false)
		rows := askRows(t, app)
		if len(rows) != 2 {
			t.Fatalf("%q: %d rows, want 2", c.raw, len(rows))
		}
		var tr *core.Record
		for _, r := range rows {
			if !r.GetBool("is_genesis") {
				tr = r
			}
		}
		if tr == nil {
			t.Fatalf("%q: no transition row", c.raw)
		}
		if tr.GetString("old_value") != "100" || tr.GetString("new_value") != c.raw ||
			tr.GetString("source_changed_at") != askAt2 || tr.GetFloat("amount") != c.want {
			t.Errorf("%q: transition wrong: old=%q new=%q at=%q amount=%v", c.raw,
				tr.GetString("old_value"), tr.GetString("new_value"),
				tr.GetString("source_changed_at"), tr.GetFloat("amount"))
		}
	}
}

// 3. A last_updated-only change (same amount, re-dated) IS recorded: the deliberate
// difference from lodging.
func TestAskHistory_RedateAtSameAmountIsRecorded(t *testing.T) {
	t.Parallel()
	app := newAskHookApp(t)
	askCreate(t, app, cmIDCAFinancialAssistanceAmount, "500", askAt1, false)
	askUpdate(t, app, cmIDCAFinancialAssistanceAmount, "500", askAt2, false)
	rows := askRows(t, app)
	if len(rows) != 2 {
		t.Fatalf("%d rows, want 2 (genesis + re-date)", len(rows))
	}
	for _, r := range rows {
		if !r.GetBool("is_genesis") {
			if r.GetString("old_value") != "500" || r.GetString("new_value") != "500" ||
				r.GetString("source_changed_at") != askAt2 {
				t.Errorf("re-date row wrong: %v", r.FieldsData())
			}
		}
	}
}

// 4. Re-running adds nothing; A -> B -> A keeps three rows.
func TestAskHistory_RepeatIsIdempotentAndReturnToAKeepsThree(t *testing.T) {
	t.Parallel()
	app := newAskHookApp(t)
	obs := &askObservation{Year: askTestYear, FieldCMID: cmIDCAFinancialAssistanceAmount,
		PersonCMID: askTestPersonCM, NewValue: "100", SourceChangedAt: askAt1, IsGenesis: true,
		ObservedBy: "x"}
	for i := 0; i < 3; i++ {
		if err := recordAskObservation(app, obs); err != nil {
			t.Fatalf("run %d: %v", i, err)
		}
	}
	if got := len(askRows(t, app)); got != 1 {
		t.Fatalf("repeat produced %d rows, want 1", got)
	}

	// A -> B -> A with an EMPTY source_changed_at: old_value must keep the third row alive.
	app2 := newAskHookApp(t)
	for _, step := range [][2]string{{"", "100"}, {"100", "200"}, {"200", "100"}} {
		o := &askObservation{Year: askTestYear, FieldCMID: cmIDCAFinancialAssistanceAmount,
			PersonCMID: askTestPersonCM, OldValue: step[0], NewValue: step[1], IsGenesis: step[0] == "",
			ObservedBy: "x"}
		for i := 0; i < 2; i++ {
			if err := recordAskObservation(app2, o); err != nil {
				t.Fatalf("step %v: %v", step, err)
			}
		}
	}
	if got := len(askRows(t, app2)); got != 3 {
		t.Fatalf("A->B->A kept %d rows, want 3", got)
	}
}

// walkAskSteps records each (old, new) step twice (a re-run) and returns the row count.
func walkAskSteps(t *testing.T, steps [][2]string, sourceFor func(i int) string) int {
	t.Helper()
	app := newAskHookApp(t)
	for i, step := range steps {
		o := &askObservation{Year: askTestYear, FieldCMID: cmIDCAFinancialAssistanceAmount,
			PersonCMID: askTestPersonCM, OldValue: step[0], NewValue: step[1], IsGenesis: step[0] == "",
			SourceChangedAt: sourceFor(i), ObservedBy: "x"}
		for rep := 0; rep < 2; rep++ {
			if err := recordAskObservation(app, o); err != nil {
				t.Fatalf("step %v: %v", step, err)
			}
		}
	}
	return len(askRows(t, app))
}

var askABAB = [][2]string{{"", "100"}, {"100", "200"}, {"200", "100"}, {"100", "200"}}

// 4b. A -> B -> A -> B with an empty last_updated keeps all four rows: only the NEWEST row
// is a duplicate, never an older row that happens to match.
func TestAskHistory_RepeatedTransitionKeptWithEmptyLastUpdated(t *testing.T) {
	t.Parallel()
	if got := walkAskSteps(t, askABAB, func(int) string { return "" }); got != 4 {
		t.Fatalf("A->B->A->B (empty last_updated) kept %d rows, want 4", got)
	}
}

// 4c. The same walk with distinct last_updated also keeps all of them.
func TestAskHistory_RepeatedTransitionKeptWithDistinctLastUpdated(t *testing.T) {
	t.Parallel()
	ats := []string{askAt1, askAt2, askAt3, "2026-03-16T09:30:00.000+00:00"}
	if got := walkAskSteps(t, askABAB, func(i int) string { return ats[i] }); got != 4 {
		t.Fatalf("A->B->A->B (distinct last_updated) kept %d rows, want 4", got)
	}
}

// 4d. Re-running the same sync over an unchanged slot adds nothing (hook path).
func TestAskHistory_UnchangedSlotRerunAddsNothing(t *testing.T) {
	t.Parallel()
	app := newAskHookApp(t)
	askCreate(t, app, cmIDCAFinancialAssistanceAmount, "100", askAt1, false)
	for i := 0; i < 3; i++ {
		askUpdate(t, app, cmIDCAFinancialAssistanceAmount, "100", askAt1, false)
	}
	if got := len(askRows(t, app)); got != 1 {
		t.Fatalf("unchanged slot re-run left %d rows, want 1", got)
	}
}

// 5. DryRun writes nothing.
func TestAskHistory_DryRunWritesNothing(t *testing.T) {
	t.Parallel()
	app := newAskHookApp(t)
	askCreate(t, app, cmIDCAFinancialAssistanceAmount, "100", askAt1, true)
	if got := len(askRows(t, app)); got != 0 {
		t.Fatalf("dry create wrote %d rows", got)
	}
	askCreate(t, app, cmIDCAFinancialAssistanceAmount, "100", askAt1, false)
	before := len(askRows(t, app))
	askUpdate(t, app, cmIDCAFinancialAssistanceAmount, "900", askAt2, true)
	if got := len(askRows(t, app)); got != before {
		t.Fatalf("dry update wrote history: %d, want %d", got, before)
	}
}

// A failing recorder never fails the custom-values sync (non-critical).
func TestAskHistory_MissingCollectionDoesNotFailTheSync(t *testing.T) {
	t.Parallel()
	app := newOrphanSweepTestApp(t, "person_custom_values",
		"person", "field_definition", "value", "last_updated")
	// no history collection at all
	askCreate(t, app, cmIDCAFinancialAssistanceAmount, "100", askAt1, false)
	stored, _ := app.FindRecordsByFilter("person_custom_values", "", "", 0, 0)
	if len(stored) != 1 {
		t.Fatalf("custom value not saved: %d", len(stored))
	}
}

// ---- 6. Reconcile in the FA applications job ----

func newAskReconcileApp(t *testing.T) (app core.App, caDef, wwDef string) {
	t.Helper()
	app = newFAApplicationsTestApp(t)
	addAskHistoryCollection(t, app)
	caDef = faAddDef(t, app, cmIDCAFinancialAssistanceAmount, "CA-FinancialAssistanceAmount", true)
	wwDef = faAddDef(t, app, cmIDWWFinancialAssistanceAmount, "WW-FA Amount", true)
	return app, caDef, wwDef
}

func TestAskHistory_ReconcileSeedsOneGenesisRowPerCurrentSlot(t *testing.T) {
	t.Parallel()
	app, ca, ww := newAskReconcileApp(t)
	p1 := faAddPerson(t, app, 4201)
	p2 := faAddPerson(t, app, 4202)
	faAddValue(t, app, p1, ca, "$585", askAt1)
	faAddValue(t, app, p2, ww, "250", askAt2)

	faRun(t, app)

	rows := askRows(t, app)
	if len(rows) != 2 {
		t.Fatalf("seeded %d rows, want 2", len(rows))
	}
	for _, r := range rows {
		if !r.GetBool("is_genesis") || r.GetString("observed_by") != "financial_aid_applications" ||
			r.GetString("old_value") != "" || r.GetInt("year") != faTestYear {
			t.Errorf("seed row wrong: %v", r.FieldsData())
		}
	}
	if askRowFor(t, app, "$585").GetFloat("amount") != 585 {
		t.Error("amount not parsed")
	}

	// Idempotent: a second run adds nothing.
	faRun(t, app)
	if got := len(askRows(t, app)); got != 2 {
		t.Fatalf("second run: %d rows, want 2", got)
	}
}

func TestAskHistory_ReconcileAddsNothingAfterTheHookWroteATransition(t *testing.T) {
	t.Parallel()
	app, ca, _ := newAskReconcileApp(t)
	p := faAddPerson(t, app, 4203)
	faAddValue(t, app, p, ca, "300", askAt2)
	// The hook already recorded old 100 -> new 300 at askAt2 (a transition, not genesis).
	if err := recordAskObservation(app, &askObservation{Year: faTestYear,
		FieldCMID: cmIDCAFinancialAssistanceAmount, PersonCMID: 4203, OldValue: "100",
		NewValue: "300", SourceChangedAt: askAt2, ObservedBy: "person_custom_values"}); err != nil {
		t.Fatal(err)
	}
	faRun(t, app)
	if got := len(askRows(t, app)); got != 1 {
		t.Fatalf("reconcile added to a covered slot: %d rows, want 1", got)
	}
}

// The reconcile compares the slot to the NEWEST row only: an older differing row does not
// matter, and a newest row that differs gets a genesis row.
func TestAskHistory_ReconcileChecksOnlyTheNewestRow(t *testing.T) {
	t.Parallel()
	app, ca, _ := newAskReconcileApp(t)
	p := faAddPerson(t, app, 4206)
	faAddValue(t, app, p, ca, "300", askAt3)
	rec := func(old, val, at string, genesis bool) {
		t.Helper()
		if err := recordAskObservation(app, &askObservation{Year: faTestYear,
			FieldCMID: cmIDCAFinancialAssistanceAmount, PersonCMID: 4206, OldValue: old,
			NewValue: val, SourceChangedAt: at, IsGenesis: genesis, ObservedBy: "person_custom_values"}); err != nil {
			t.Fatal(err)
		}
	}
	rec("", "100", askAt1, true)
	rec("100", "300", askAt3, false)
	faRun(t, app)
	if got := len(askRows(t, app)); got != 2 {
		t.Fatalf("newest row equals the slot: %d rows, want 2", got)
	}

	// Slot moves on; the newest row (300) no longer equals it, so a genesis row is added
	// even though an older row... also differs.
	stored, err := app.FindRecordsByFilter("person_custom_values", "", "", 0, 0)
	if err != nil || len(stored) != 1 {
		t.Fatalf("stored values: %d, err=%v", len(stored), err)
	}
	stored[0].Set("value", "100")
	stored[0].Set("last_updated", askAt1)
	if err := app.Save(stored[0]); err != nil {
		t.Fatal(err)
	}
	faRun(t, app)
	rows := askRows(t, app)
	if len(rows) != 3 {
		t.Fatalf("newest row differs from the slot: %d rows, want 3", len(rows))
	}
}

func TestAskHistory_ReconcileFillsAHookGap(t *testing.T) {
	t.Parallel()
	app, ca, _ := newAskReconcileApp(t)
	p := faAddPerson(t, app, 4204)
	faAddValue(t, app, p, ca, "300", askAt3)
	// The history holds only an OLDER value; the hook failed for the newer one.
	if err := recordAskObservation(app, &askObservation{Year: faTestYear,
		FieldCMID: cmIDCAFinancialAssistanceAmount, PersonCMID: 4204, NewValue: "100",
		SourceChangedAt: askAt1, IsGenesis: true, ObservedBy: "person_custom_values"}); err != nil {
		t.Fatal(err)
	}
	faRun(t, app)
	rows := askRows(t, app)
	if len(rows) != 2 {
		t.Fatalf("%d rows, want 2 (old genesis + filled gap)", len(rows))
	}
	g := askRowFor(t, app, "300")
	if !g.GetBool("is_genesis") || g.GetString("observed_by") != "financial_aid_applications" ||
		g.GetString("source_changed_at") != askAt3 {
		t.Errorf("gap row wrong: %v", g.FieldsData())
	}
}

func TestAskHistory_ReconcileIgnoresOtherFieldsBlanksAndDryRun(t *testing.T) {
	t.Parallel()
	app, ca, _ := newAskReconcileApp(t)
	interest := faAddDef(t, app, askOtherCMID, "CA-FinancialAssistanceInterest", true)
	p := faAddPerson(t, app, 4205)
	faAddValue(t, app, p, interest, "Yes", askAt1)
	faAddValue(t, app, p, ca, "", askAt1)
	faRun(t, app)
	if got := len(askRows(t, app)); got != 0 {
		t.Fatalf("wrote %d rows for an interest flag / blank ask", got)
	}

	app2, ca2, _ := newAskReconcileApp(t)
	p2 := faAddPerson(t, app2, 4206)
	faAddValue(t, app2, p2, ca2, "100", askAt1)
	s := NewFinancialAidApplicationsSync(app2)
	s.Year = faTestYear
	s.SetDryRun(true)
	if err := s.Sync(t.Context()); err != nil {
		t.Fatal(err)
	}
	if got := len(askRows(t, app2)); got != 0 {
		t.Fatalf("dry run wrote %d rows", got)
	}
}

// Owner ruling: "2024 and prior dont need aid lists". Only intake reads this table, and intake
// takes in no season before AID_INTAKE_FLOOR_YEAR (2025), so no row is written for one. The
// floor is in recordAskObservation, which both writers (the hook and the reconcile) go through.
func TestAskHistory_NothingIsWrittenBeforeTheIntakeFloor(t *testing.T) {
	t.Parallel()
	app := newAskHookApp(t)
	for _, year := range []int{2024, 2025} {
		if err := recordAskObservation(app, &askObservation{Year: year,
			FieldCMID: cmIDCAFinancialAssistanceAmount, PersonCMID: 4301, NewValue: "300",
			SourceChangedAt: askAt1, ObservedBy: "person_custom_values", IsGenesis: true}); err != nil {
			t.Fatalf("record %d: %v", year, err)
		}
	}
	rows := askRows(t, app)
	if len(rows) != 1 || rows[0].GetInt("year") != 2025 {
		years := make([]int, 0, len(rows))
		for _, r := range rows {
			years = append(years, r.GetInt("year"))
		}
		t.Fatalf("ask-history rows for years %v, want only 2025", years)
	}
	if aidAskHistoryFloorYear != 2025 {
		t.Errorf("aidAskHistoryFloorYear = %d, want 2025 (AID_INTAKE_FLOOR_YEAR)", aidAskHistoryFloorYear)
	}
}
