package sync

import (
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
	for i := 1; i <= 6; i++ {
		hh := cadenceAddHousehold(t, app, 9310000+i, year)
		cadenceAddPerson(t, app, 9300000+i, 9310000+i, year, hh)
	}
	aidApplication(t, app, year, 9300001, true)                                  // applicant: in
	aidApplication(t, app, year, 9300002, false)                                 // donation-only: out
	aidPosting(t, app, year+1, 9300003, 9310003, aidCategoryFinancialAssistance) // N+1 posting: in
	aidPosting(t, app, year, 0, 9310004, aidCategoryJFAM)                        // household-only: in
	aidPosting(t, app, year-1, 9300005, 9310005, aidCategoryFinancialAssistance) // N-1: out
	aidPosting(t, app, year, 9300006, 9310006, 22650)                            // tuition: out

	cohort, err := loadAidCohort(app, year)
	if err != nil {
		t.Fatalf("loadAidCohort: %v", err)
	}
	if want := []int{9300001, 9300003, 9300004}; !slices.Equal(cohort.personCMIDs, want) {
		t.Errorf("persons = %v, want %v", cohort.personCMIDs, want)
	}
	if want := []int{9310001, 9310003, 9310004}; !slices.Equal(cohort.householdCMIDs, want) {
		t.Errorf("households = %v, want %v", cohort.householdCMIDs, want)
	}
}

// Review Focus 5: a family new in N+1 has no season-N persons or households row yet.
func TestAidCohort_DropsIDsWithNoSeasonNRecord(t *testing.T) {
	t.Parallel()
	app := cadenceTestApp(t)
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
