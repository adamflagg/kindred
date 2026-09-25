package sync

import (
	"fmt"
	"slices"
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

// addAidCohortCollections gives a fixture the minimal columns loadAidCohort reads,
// creating each collection only if the fixture does not already have it.
func addAidCohortCollections(t *testing.T, app core.App) {
	t.Helper()
	ensure := func(name string, numbers []string, bools []string) {
		if _, err := app.FindCollectionByNameOrId(name); err == nil {
			return
		}
		c := core.NewBaseCollection(name)
		for _, n := range numbers {
			c.Fields.Add(&core.NumberField{Name: n})
		}
		for _, n := range bools {
			c.Fields.Add(&core.BoolField{Name: n})
		}
		if err := app.Save(c); err != nil {
			t.Fatalf("save %s: %v", name, err)
		}
	}
	ensure("financial_aid_applications", []string{"person_id", "year"}, []string{"is_applicant"})
	ensure("financial_transactions",
		[]string{"year", "person_cm_id", "household_cm_id", "financial_category_cm_id"}, nil)
	ensure("households", []string{"cm_id", "year"}, nil)
	ensure("persons", []string{"cm_id", "household_id", "year"}, nil)
}

func aidPosting(t *testing.T, app core.App, year, personCMID, householdCMID, category int) {
	t.Helper()
	saveRecord(t, app, "financial_transactions", map[string]any{
		"year": year, "person_cm_id": personCMID, "household_cm_id": householdCMID,
		"financial_category_cm_id": category,
	})
}

func aidApplication(t *testing.T, app core.App, year, personCMID int, applicant bool) {
	t.Helper()
	saveRecord(t, app, "financial_aid_applications", map[string]any{
		"year": year, "person_id": personCMID, "is_applicant": applicant,
	})
}

func TestAidCohort_ApplicantsAndPostingsInSeasonsNAndNPlus1(t *testing.T) {
	t.Parallel()
	app := cadenceTestApp(t) // includes addAidCohortCollections (below)
	const year = 2026
	for i := 1; i <= 7; i++ {
		hh := cadenceAddHousehold(t, app, 9310000+i, year)
		cadenceAddPerson(t, app, 9300000+i, 9310000+i, year, hh)
	}
	cadenceAddPerson(t, app, 9300008, 0, year, "") // household_id 0: on no household
	// A season-N households row with cm_id 0. Without it no zero id can reach the household
	// set, and the no-zero assertion below could never fail: with it, dropping either `> 0`
	// guard (on a posting's household_cm_id, or on a cohort person's household_id) leaks 0.
	cadenceAddHousehold(t, app, 0, year)

	aidApplication(t, app, year, 9300001, true)  // applicant: in
	aidApplication(t, app, year, 9300008, true)  // applicant on no household: in, household not
	aidApplication(t, app, year, 9300002, false) // donation-only: out
	// N+1 posting names 9300003 only (household_cm_id 0) -- case (b) alone must carry him
	// in, and his season-N household (9310003) must still surface as the household of a
	// cohort person (fixture no longer relies on this posting also naming the household).
	aidPosting(t, app, year+1, 9300003, 0, aidCategoryFinancialAssistance)
	aidPosting(t, app, year, 0, 9310004, aidCategoryJFAM)                        // household-only: in
	aidPosting(t, app, year-1, 9300005, 9310005, aidCategoryFinancialAssistance) // N-1: out
	aidPosting(t, app, year, 9300006, 9310006, 22650)                            // tuition: out
	aidApplication(t, app, year-1, 9300007, true)                                // wrong-year applicant: out
	aidPosting(t, app, year, 0, 0, aidCategoryFinancialAssistance)               // all-zero ids: out

	cohort, err := loadAidCohort(app, year)
	if err != nil {
		t.Fatalf("loadAidCohort: %v", err)
	}
	if want := []int{9300001, 9300003, 9300004, 9300008}; !slices.Equal(cohort.personCMIDs, want) {
		t.Errorf("persons = %v, want %v", cohort.personCMIDs, want)
	}
	if want := []int{9310001, 9310003, 9310004}; !slices.Equal(cohort.householdCMIDs, want) {
		t.Errorf("households = %v, want %v", cohort.householdCMIDs, want)
	}
	if slices.Contains(cohort.personCMIDs, 0) || slices.Contains(cohort.householdCMIDs, 0) {
		t.Errorf("cohort = %+v, want no zero id (person_cm_id/household_cm_id 0 means absent)", cohort)
	}
}

// Review Focus 5: a family new in N+1 has no season-N persons or households row yet. The
// person and household exist ONLY as N+1 rows, so this also pins that loadAidCohort reads
// persons/households filtered to season N rather than fetching them unfiltered.
func TestAidCohort_DropsIDsWithNoSeasonNRecord(t *testing.T) {
	t.Parallel()
	app := cadenceTestApp(t)
	hh := cadenceAddHousehold(t, app, 9310099, 2027)
	cadenceAddPerson(t, app, 9300099, 9310099, 2027, hh)
	aidPosting(t, app, 2027, 9300099, 9310099, aidCategoryFinancialAssistance)

	cohort, err := loadAidCohort(app, 2026)
	if err != nil {
		t.Fatalf("loadAidCohort: %v", err)
	}
	if len(cohort.personCMIDs) != 0 || len(cohort.householdCMIDs) != 0 {
		t.Errorf("cohort = %+v, want empty (no season-N record to store values against)", cohort)
	}
}

func TestUnionCMIDs(t *testing.T) {
	t.Parallel()
	if got := unionCMIDs([]int{3, 1}, []int{1, 2}); !slices.Equal(got, []int{3, 1, 2}) {
		t.Errorf("unionCMIDs = %v, want [3 1 2] (first-seen order, deduplicated)", got)
	}
}

func TestPersonCustomFieldValuesSync_DailyPassAddsAidCohort(t *testing.T) {
	t.Parallel()
	app := cadenceTestApp(t)
	const year = 2026
	fc := cadenceAddSession(t, app, 1001, sessionTypeFamily, year)
	hhFC := cadenceAddHousehold(t, app, 701, year)
	pFC := cadenceAddPerson(t, app, 801, 701, year, hhFC)
	cadenceAddAttendee(t, app, pFC, fc, "enrolled", 801, statusIDActiveEnrolled, year)

	hhAid := cadenceAddHousehold(t, app, 9310001, year)
	cadenceAddPerson(t, app, 9300001, 9310001, year, hhAid)
	aidApplication(t, app, year, 9300001, true)

	s := NewPersonCustomFieldValuesSync(app, nil)
	s.Scope = ScopeFamilyCamp
	ids, err := s.getPersonIDsToSync(year)
	if err != nil {
		t.Fatalf("getPersonIDsToSync: %v", err)
	}
	if !intsEqual(ids, []int{801, 9300001}) {
		t.Errorf("daily cohort = %v, want [801 9300001] (family camp + aid)", ids)
	}

	// Refresh Housing's one-weekend run must NOT pick up the aid cohort.
	s.Session = "1001"
	ids, err = s.getPersonIDsToSync(year)
	if err != nil {
		t.Fatalf("getPersonIDsToSync(session): %v", err)
	}
	if !intsEqual(ids, []int{801}) {
		t.Errorf("one-weekend cohort = %v, want [801] only", ids)
	}
}

func TestHouseholdCustomFieldValuesSync_DailyPassAddsAidCohort(t *testing.T) {
	t.Parallel()
	app := cadenceTestApp(t)
	const year = 2026
	fc := cadenceAddSession(t, app, 1001, sessionTypeFamily, year)
	hhFC := cadenceAddHousehold(t, app, 701, year)
	pFC := cadenceAddPerson(t, app, 801, 701, year, hhFC)
	cadenceAddAttendee(t, app, pFC, fc, "enrolled", 801, statusIDActiveEnrolled, year)
	cadenceAddHousehold(t, app, 9310004, year)
	aidPosting(t, app, year, 0, 9310004, aidCategoryJFAM)

	s := NewHouseholdCustomFieldValuesSync(app, nil)
	s.Scope = ScopeFamilyCamp
	ids, err := s.getHouseholdIDsToSync(year)
	if err != nil {
		t.Fatalf("getHouseholdIDsToSync: %v", err)
	}
	if !intsEqual(ids, []int{701, 9310004}) {
		t.Errorf("daily household cohort = %v, want [701 9310004]", ids)
	}
}

// If the aid half cannot be read, the family-camp half (which the weekend board reads)
// still runs.
func TestDailyPassKeepsFamilyCampCohortWhenAidCohortFails(t *testing.T) {
	t.Parallel()
	app := cadenceTestApp(t)
	const year = 2026
	fc := cadenceAddSession(t, app, 1001, sessionTypeFamily, year)
	hhFC := cadenceAddHousehold(t, app, 701, year)
	pFC := cadenceAddPerson(t, app, 801, 701, year, hhFC)
	cadenceAddAttendee(t, app, pFC, fc, "enrolled", 801, statusIDActiveEnrolled, year)
	col, err := app.FindCollectionByNameOrId("financial_aid_applications")
	if err != nil {
		t.Fatalf("find: %v", err)
	}
	if delErr := app.Delete(col); delErr != nil {
		t.Fatalf("drop financial_aid_applications: %v", delErr)
	}

	s := NewPersonCustomFieldValuesSync(app, nil)
	s.Scope = ScopeFamilyCamp
	ids, err := s.getPersonIDsToSync(year)
	if err != nil {
		t.Fatalf("getPersonIDsToSync must not fail on the aid half: %v", err)
	}
	if !intsEqual(ids, []int{801}) {
		t.Errorf("cohort = %v, want [801]", ids)
	}
}

// The widened pass's orphan sweep judges only the persons it fetched. A person outside
// the cohort keeps their stored values; an in-cohort person's stale value is swept.
func TestWidenedDailyPassSweepStaysInsideItsCohort(t *testing.T) {
	t.Parallel()
	app := cadenceTestApp(t)
	grain := declaredFullGrain(t, "person_custom_values", "person_custom_values")
	setupCustomValuesReplayCollection(t, app, "person_custom_values", "person", &grain)
	const year = 2026

	hhAid := cadenceAddHousehold(t, app, 9310001, year)
	aidPB := cadenceAddPerson(t, app, 9300001, 9310001, year, hhAid)
	aidApplication(t, app, year, 9300001, true)
	hhOut := cadenceAddHousehold(t, app, 9310002, year)
	outsiderPB := cadenceAddPerson(t, app, 9300002, 9310002, year, hhOut)

	saveRecord(t, app, "person_custom_values", map[string]any{
		"person": aidPB, "field_definition": "pb_field_900", "value": "stale", "year": year})
	saveRecord(t, app, "person_custom_values", map[string]any{
		"person": outsiderPB, "field_definition": "pb_field_901", "value": "keep", "year": year})

	s := &PersonCustomFieldValuesSync{
		BaseSyncService: BaseSyncService{App: app, ProcessedKeys: map[string]bool{}},
		Scope:           ScopeFamilyCamp,
	}
	ids, err := s.getPersonIDsToSync(year)
	if err != nil {
		t.Fatalf("getPersonIDsToSync: %v", err)
	}
	if !slices.Contains(ids, 9300001) || slices.Contains(ids, 9300002) {
		t.Fatalf("cohort = %v, want 9300001 in and 9300002 out", ids)
	}

	// Simulate Sync's fetch loop for the cohort: one fresh answer each, owners marked swept.
	filter := fmt.Sprintf("year = %d", year)
	existing, err := s.PreloadCompositeRecords("person_custom_values", filter, customValuesPreloadKey("person"))
	if err != nil {
		t.Fatalf("preload: %v", err)
	}
	pbByCM := map[int]string{9300001: aidPB, 9300002: outsiderPB}
	sweptOwners := map[string]bool{}
	for _, cm := range ids {
		pb, ok := pbByCM[cm]
		if !ok {
			continue
		}
		if err := s.processPersonCustomFieldValue(map[string]any{"id": float64(100), "value": "Yes"},
			cm, pb, year, map[int]string{100: "pb_field_100"}, existing); err != nil {
			t.Fatalf("process: %v", err)
		}
		sweptOwners[pb] = true
	}
	s.SyncSuccessful = true
	if err := s.deleteOrphans(year, sweptOwners); err != nil {
		t.Fatalf("deleteOrphans: %v", err)
	}

	if _, err := app.FindFirstRecordByFilter("person_custom_values",
		"person = {:p} && field_definition = 'pb_field_901'", map[string]any{"p": outsiderPB}); err != nil {
		t.Error("the sweep deleted a value belonging to a person outside the pass's cohort")
	}
	if _, err := app.FindFirstRecordByFilter("person_custom_values",
		"person = {:p} && field_definition = 'pb_field_900'", map[string]any{"p": aidPB}); err == nil {
		t.Error("positive control: the in-cohort person's stale value was not swept")
	}
}
