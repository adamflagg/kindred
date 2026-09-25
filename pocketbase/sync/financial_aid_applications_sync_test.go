package sync

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	pbtests "github.com/pocketbase/pocketbase/tests"
)

const faTestYear = 2026

// newFAApplicationsTestApp builds the four collections the FA transform reads and writes.
// financial_aid_applications is derived from toRecordData's own keys, so the fixture cannot
// drift from what the sync writes; carryover_last_updated is a real JSON field so the
// idempotency test exercises the production comparison.
func newFAApplicationsTestApp(t *testing.T) core.App {
	t.Helper()
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)

	defs := core.NewBaseCollection("custom_field_defs")
	defs.Fields.Add(&core.NumberField{Name: "cm_id"})
	defs.Fields.Add(&core.TextField{Name: "name"})
	defs.Fields.Add(&core.BoolField{Name: "is_seasonal"})
	mustSave(t, app, defs)

	persons := core.NewBaseCollection("persons")
	persons.Fields.Add(&core.NumberField{Name: "cm_id"})
	persons.Fields.Add(&core.TextField{Name: "household"})
	persons.Fields.Add(&core.NumberField{Name: "year"})
	mustSave(t, app, persons)

	pcv := core.NewBaseCollection("person_custom_values")
	for _, n := range []string{"person", "field_definition", "value", "last_updated"} {
		pcv.Fields.Add(&core.TextField{Name: n})
	}
	pcv.Fields.Add(&core.NumberField{Name: "year"})
	mustSave(t, app, pcv)

	fa := core.NewBaseCollection("financial_aid_applications")
	for name, value := range (&faApplicationData{}).toRecordData(faTestYear) {
		if name == "carryover_last_updated" {
			fa.Fields.Add(&core.JSONField{Name: name, MaxSize: 10000})
			continue
		}
		switch value.(type) {
		case bool:
			fa.Fields.Add(&core.BoolField{Name: name})
		case string:
			fa.Fields.Add(&core.TextField{Name: name})
		default:
			fa.Fields.Add(&core.NumberField{Name: name})
		}
	}
	mustSave(t, app, fa)
	return app
}

func mustSave(t *testing.T, app core.App, c *core.Collection) {
	t.Helper()
	if err := app.Save(c); err != nil {
		t.Fatalf("save %s: %v", c.Name, err)
	}
}

func faAddDef(t *testing.T, app core.App, cmID int, name string, seasonal bool) string {
	t.Helper()
	return saveRecord(t, app, "custom_field_defs", map[string]any{"cm_id": cmID, "name": name, "is_seasonal": seasonal})
}

func faAddPerson(t *testing.T, app core.App, cmID int) string {
	t.Helper()
	return saveRecord(t, app, "persons", map[string]any{
		"cm_id": cmID, "household": fmt.Sprintf("hh%d", cmID), "year": faTestYear,
	})
}

func faAddValue(t *testing.T, app core.App, personPBID, defPBID, value, lastUpdated string) {
	t.Helper()
	saveRecord(t, app, "person_custom_values", map[string]any{
		"person": personPBID, "field_definition": defPBID, "value": value,
		"last_updated": lastUpdated, "year": faTestYear,
	})
}

func faRun(t *testing.T, app core.App) *FinancialAidApplicationsSync {
	t.Helper()
	s := NewFinancialAidApplicationsSync(app)
	s.Year = faTestYear
	if err := s.Sync(context.Background()); err != nil {
		t.Fatalf("Sync: %v", err)
	}
	return s
}

func faRow(t *testing.T, app core.App, personPBID string) *core.Record {
	t.Helper()
	rec, err := app.FindFirstRecordByFilter("financial_aid_applications",
		"person = {:p} && year = {:y}", map[string]any{"p": personPBID, "y": faTestYear})
	if err != nil {
		t.Fatalf("no application row for %s: %v", personPBID, err)
	}
	return rec
}

const faSeasonalAt = "2026-02-10T17:00:00.000+00:00"

// Design §6.4: donation-only rows stay out of applicant counts; carry-over-only rows too.
func TestFASync_MarksApplicantsAndLeavesDonationOnlyRowsOut(t *testing.T) {
	t.Parallel()
	app := newFAApplicationsTestApp(t)
	interest := faAddDef(t, app, 1, "CA-FinancialAssistanceInterest", true)
	income := faAddDef(t, app, 2, "FA-Total Gross Pre-Tax Income", true)
	donation := faAddDef(t, app, 3, "CA-Donation amount", true)
	govSubsidies := faAddDef(t, app, 4, "FA-Gov Subsidies", false)
	noInterest := faAddDef(t, app, 5, "WW-FA", true)

	applicant := faAddPerson(t, app, 9200001)
	faAddValue(t, app, applicant, interest, "Yes", faSeasonalAt)
	faAddValue(t, app, applicant, income, "$85,000", faSeasonalAt)

	donor := faAddPerson(t, app, 9200002)
	faAddValue(t, app, donor, donation, "$50", faSeasonalAt)

	carryOverOnly := faAddPerson(t, app, 9200003)
	faAddValue(t, app, carryOverOnly, govSubsidies, "Yes", "2019-03-02T18:04:05.000+00:00")

	saidNo := faAddPerson(t, app, 9200004)
	faAddValue(t, app, saidNo, noInterest, "No", faSeasonalAt)

	faRun(t, app)

	for pb, want := range map[string]bool{applicant: true, donor: false, carryOverOnly: false, saidNo: false} {
		if got := faRow(t, app, pb).GetBool("is_applicant"); got != want {
			t.Errorf("is_applicant for %s = %v, want %v", pb, got, want)
		}
	}
}

func TestFASync_StampsCarryOverAnswersOnly(t *testing.T) {
	t.Parallel()
	app := newFAApplicationsTestApp(t)
	income := faAddDef(t, app, 2, "FA-Total Gross Pre-Tax Income", true)
	govSubsidies := faAddDef(t, app, 4, "FA-Gov Subsidies", false)
	parentName := faAddDef(t, app, 6, "FA-Parent 2 Name", false)

	p := faAddPerson(t, app, 9200011)
	faAddValue(t, app, p, income, "$60,000", faSeasonalAt)
	faAddValue(t, app, p, govSubsidies, "Yes", "2019-03-02T18:04:05.000+00:00")
	faAddValue(t, app, p, parentName, "Olivia Chen", "")

	faRun(t, app)

	var stamps map[string]string
	if err := faRow(t, app, p).UnmarshalJSONField("carryover_last_updated", &stamps); err != nil {
		t.Fatalf("read carryover_last_updated: %v", err)
	}
	want := map[string]string{"FA-Gov Subsidies": "2019-03-02", "FA-Parent 2 Name": ""}
	if fmt.Sprint(stamps) != fmt.Sprint(want) {
		t.Errorf("carryover_last_updated = %v, want %v (seasonal answers are not stamped)", stamps, want)
	}
}

func TestFASync_ConfirmedIncomeIsANumber(t *testing.T) {
	t.Parallel()
	app := newFAApplicationsTestApp(t)
	confirmed := faAddDef(t, app, 7, "FA-confirmpretax income", true)
	p := faAddPerson(t, app, 9200021)
	faAddValue(t, app, p, confirmed, "$72,500", faSeasonalAt)

	faRun(t, app)

	if got := faRow(t, app, p).GetFloat("income_confirmed"); got != 72500 {
		t.Errorf("income_confirmed = %v, want 72500", got)
	}
}

func TestFASync_RegistrationRequestReplacesAmountAwarded(t *testing.T) {
	t.Parallel()
	app := newFAApplicationsTestApp(t)
	amount := faAddDef(t, app, 8, "CA-FinancialAssistanceAmount", true)
	p := faAddPerson(t, app, 9200031)
	faAddValue(t, app, p, amount, "$1,200", faSeasonalAt)

	faRun(t, app)

	if got := faRow(t, app, p).GetFloat("registration_request_amount"); got != 1200 {
		t.Errorf("registration_request_amount = %v, want 1200", got)
	}
	data := (&faApplicationData{}).toRecordData(faTestYear)
	for _, gone := range []string{"amount_awarded", "amount_requested", "deposit_paid"} {
		if _, present := data[gone]; present {
			t.Errorf("toRecordData still writes %q", gone)
		}
	}
}

// Pin (already true before this plan): the grant cross-check answers are mirrored.
func TestFASync_MirrorsGrantCrossCheckAnswers(t *testing.T) {
	t.Parallel()
	app := newFAApplicationsTestApp(t)
	ohc := faAddDef(t, app, 9, "FA-OneHappy Camper", true)
	synagogue := faAddDef(t, app, 10, "FA-SynagogueGrant", true)
	p := faAddPerson(t, app, 9200041)
	faAddValue(t, app, p, ohc, "Yes", faSeasonalAt)
	faAddValue(t, app, p, synagogue, "No", faSeasonalAt)

	faRun(t, app)

	rec := faRow(t, app, p)
	if rec.GetString("one_happy_camper") != "Yes" || rec.GetString("synagogue_grant") != "No" {
		t.Errorf("one_happy_camper=%q synagogue_grant=%q, want Yes/No",
			rec.GetString("one_happy_camper"), rec.GetString("synagogue_grant"))
	}
}

func TestFASync_SweepsAnApplicationWhoseAnswersAreGone(t *testing.T) {
	t.Parallel()
	app := newFAApplicationsTestApp(t)
	interest := faAddDef(t, app, 1, "CA-FinancialAssistanceInterest", true)
	kept := faAddPerson(t, app, 9200051)
	gone := faAddPerson(t, app, 9200052)
	faAddValue(t, app, kept, interest, "Yes", faSeasonalAt)
	faAddValue(t, app, gone, interest, "Yes", faSeasonalAt)
	faRun(t, app)

	rows, err := app.FindRecordsByFilter("person_custom_values", "person = {:p}", "", 0, 0, map[string]any{"p": gone})
	if err != nil || len(rows) != 1 {
		t.Fatalf("find gone's value: %v (%d rows)", err, len(rows))
	}
	if err := app.Delete(rows[0]); err != nil {
		t.Fatalf("delete value: %v", err)
	}

	s := faRun(t, app)
	if s.Stats.Deleted != 1 {
		t.Errorf("Stats.Deleted = %d, want 1", s.Stats.Deleted)
	}
	if _, err := app.FindFirstRecordByFilter("financial_aid_applications", "person = {:p}",
		map[string]any{"p": gone}); err == nil {
		t.Error("the application whose answers are gone was not swept")
	}
	faRow(t, app, kept)
}

// A sweep covers only its own season.
func TestFASync_SweepLeavesOtherSeasonsAlone(t *testing.T) {
	t.Parallel()
	app := newFAApplicationsTestApp(t)
	interest := faAddDef(t, app, 1, "CA-FinancialAssistanceInterest", true)
	p := faAddPerson(t, app, 9200061)
	faAddValue(t, app, p, interest, "Yes", faSeasonalAt)
	saveRecord(t, app, "financial_aid_applications", map[string]any{"person": "prior", "person_id": 9200062, "year": 2025})

	faRun(t, app)

	if _, err := app.FindFirstRecordByFilter("financial_aid_applications", "year = 2025"); err != nil {
		t.Error("a 2026 run swept a 2025 application")
	}
}

// No answers at all for a season with stored applications is a collapse, not a mass
// withdrawal: nothing is deleted and the run fails loudly.
func TestFASync_RefusesToSweepWhenNoAnswersLoad(t *testing.T) {
	t.Parallel()
	app := newFAApplicationsTestApp(t)
	for i := range 3 {
		saveRecord(t, app, "financial_aid_applications", map[string]any{
			"person": fmt.Sprintf("p%d", i), "person_id": 9200070 + i, "year": faTestYear,
		})
	}
	s := NewFinancialAidApplicationsSync(app)
	s.Year = faTestYear
	err := s.Sync(context.Background())
	if err == nil || !strings.Contains(err.Error(), "refus") {
		t.Errorf("Sync = %v, want a refused-sweep error", err)
	}
	rows, _ := app.FindRecordsByFilter("financial_aid_applications", fmt.Sprintf("year = %d", faTestYear), "", 0, 0)
	if len(rows) != 3 {
		t.Errorf("rows = %d, want 3 (nothing deleted)", len(rows))
	}
}

// Review Focus 4: an unchanged season rewrites nothing, including the JSON column.
func TestFASync_SecondIdenticalRunUpdatesNothing(t *testing.T) {
	t.Parallel()
	app := newFAApplicationsTestApp(t)
	income := faAddDef(t, app, 2, "FA-Total Gross Pre-Tax Income", true)
	govSubsidies := faAddDef(t, app, 4, "FA-Gov Subsidies", false)
	confirmed := faAddDef(t, app, 7, "FA-confirmpretax income", true)
	p := faAddPerson(t, app, 9200081)
	faAddValue(t, app, p, income, "$60,000", faSeasonalAt)
	faAddValue(t, app, p, govSubsidies, "Yes", "2019-03-02T18:04:05.000+00:00")
	faAddValue(t, app, p, confirmed, "$60,000", faSeasonalAt)
	donorOnly := faAddPerson(t, app, 9200082)
	faAddValue(t, app, donorOnly, faAddDef(t, app, 3, "CA-Donation amount", true), "$25", faSeasonalAt)

	faRun(t, app)
	s := faRun(t, app)
	if s.Stats.Created != 0 || s.Stats.Updated != 0 || s.Stats.Deleted != 0 {
		t.Errorf("second run stats = %+v, want nothing created, updated or deleted", s.Stats)
	}
}
