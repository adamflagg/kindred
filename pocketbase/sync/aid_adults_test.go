package sync

import (
	"errors"
	"slices"
	"testing"

	pbtests "github.com/pocketbase/pocketbase/tests"

	"github.com/pocketbase/pocketbase/core"
)

const aidAdultsYear = 2026

// aidAdultsTestApp has the households columns the persons sync writes, plus aid_adults, and
// the minimal tables loadAidCohort reads.
func aidAdultsTestApp(t *testing.T) core.App {
	t.Helper()
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)

	households := core.NewBaseCollection("households")
	households.Fields.Add(&core.NumberField{Name: "cm_id"})
	households.Fields.Add(&core.NumberField{Name: "year"})
	for _, name := range []string{
		"greeting", "mailing_title", "alternate_mailing_title", "billing_mailing_title", "household_phone",
		"billing_address1", "billing_address2", "billing_city", "billing_state", "billing_postal_code",
		"billing_country",
	} {
		households.Fields.Add(&core.TextField{Name: name})
	}
	households.Fields.Add(&core.JSONField{Name: "aid_adults", MaxSize: 20000, Hidden: true})
	if err := app.Save(households); err != nil {
		t.Fatalf("save households: %v", err)
	}
	addAidCohortCollections(t, app)
	return app
}

func aidAdultsHousehold(t *testing.T, app core.App, cmID int, adults any) {
	t.Helper()
	values := map[string]any{"cm_id": cmID, "year": aidAdultsYear}
	if adults != nil {
		values["aid_adults"] = adults
	}
	saveRecord(t, app, "households", values)
}

func aidAdultsPerson(t *testing.T, app core.App, cmID, householdCMID int) {
	t.Helper()
	saveRecord(t, app, "persons", map[string]any{"cm_id": cmID, "household_id": householdCMID, "year": aidAdultsYear})
}

// cmRelative is a GetPersons record for a relative: its name, and each [FamilyID, RoleID]
// it holds.
func cmRelative(id int, first, last, preferred string, families ...[2]int) map[string]any {
	fps := make([]any, 0, len(families))
	for _, f := range families {
		fps = append(fps, map[string]any{
			"FamilyID": float64(f[0]), "PersonID": float64(id), "RoleID": float64(f[1]),
		})
	}
	return map[string]any{
		"ID":            float64(id),
		"Name":          map[string]any{"First": first, "Last": last, "Preferred": preferred},
		"FamilyPersons": fps,
	}
}

// fakeFetch serves GetPersons from people, recording each call's ids.
type fakeFetch struct {
	people map[int]map[string]any
	calls  [][]int
	err    error
}

func (f *fakeFetch) fetch(ids []int) ([]map[string]any, error) {
	f.calls = append(f.calls, slices.Clone(ids))
	if f.err != nil {
		return nil, f.err
	}
	var out []map[string]any
	for _, id := range ids {
		if p, ok := f.people[id]; ok {
			out = append(out, p)
		}
	}
	return out, nil
}

func (f *fakeFetch) fetchedIDs() []int {
	var all []int
	for _, c := range f.calls {
		all = append(all, c...)
	}
	slices.Sort(all)
	return all
}

func householdAidAdults(t *testing.T, app core.App, cmID int) []aidAdult {
	t.Helper()
	rec, err := app.FindFirstRecordByFilter("households", "cm_id = {:id} && year = {:y}",
		map[string]any{"id": cmID, "y": aidAdultsYear})
	if err != nil {
		t.Fatalf("household %d: %v", cmID, err)
	}
	var out []aidAdult
	if raw := rec.GetString("aid_adults"); raw != "" && raw != "null" {
		if err := rec.UnmarshalJSONField("aid_adults", &out); err != nil {
			t.Fatalf("household %d aid_adults: %v", cmID, err)
		}
	}
	return out
}

// The cohort: Emma (an applicant) and Liam (in the aid-posting household 9410001). Olivia is
// not in it. Emma's second household is 9410002, where no member persons live.
func seedAidAdultsCohort(t *testing.T, app core.App) (
	relatives map[int][]relativeRef, households map[int]personHouseholdIDs, fetch *fakeFetch,
) {
	t.Helper()
	aidAdultsPerson(t, app, 9400001, 9410001) // Emma Johnson
	aidAdultsPerson(t, app, 9400002, 9410001) // Liam, her brother
	aidAdultsPerson(t, app, 9400003, 9410003) // Olivia Chen: no aid
	aidApplication(t, app, aidAdultsYear, 9400001, true)
	aidPosting(t, app, aidAdultsYear, 0, 9410001, aidCategoryFinancialAssistance)

	relatives = map[int][]relativeRef{
		9400001: {
			{ID: 9400101, IsGuardian: true},
			{ID: 9400102, IsGuardian: false},
			{ID: 9400002, IsGuardian: false}, // her brother: a child in the family, not a principal
			{ID: 9400104, IsGuardian: false}, // a principal of a household no cohort person is in
		},
		9400002: {{ID: 9400101, IsGuardian: false}, {ID: 9400103, IsGuardian: false}},
		9400003: {{ID: 9400201, IsGuardian: true}},
	}
	households = map[int]personHouseholdIDs{
		9400001: {PrimaryChildhoodID: 9410001, AlternateChildhoodID: 9410002},
		9400002: {PrimaryChildhoodID: 9410001},
		9400003: {PrimaryChildhoodID: 9410003},
	}
	fetch = &fakeFetch{people: map[int]map[string]any{
		9400101: cmRelative(9400101, "Maria", "GARCIA", "", [2]int{9410001, 1}),
		9400102: cmRelative(9400102, "David", "Chen", "", [2]int{9410002, 1}),
		9400103: cmRelative(9400103, "Sarah", "Chen", "Sally", [2]int{9410002, 2}),
		9400002: cmRelative(9400002, "Liam", "Garcia", "", [2]int{9410001, 3}),
		9400104: cmRelative(9400104, "Riley", "Sam", "", [2]int{9410004, 1}),
		9400201: cmRelative(9400201, "Samuel", "Johnson", "", [2]int{9410003, 1}),
	}}
	return relatives, households, fetch
}

func TestSyncAidAdults_PlacesEveryCohortRelativeByPrincipalRole(t *testing.T) {
	t.Parallel()
	app := aidAdultsTestApp(t)
	for _, h := range []int{9410001, 9410002, 9410003, 9410004} {
		aidAdultsHousehold(t, app, h, nil)
	}
	relatives, households, fetch := seedAidAdultsCohort(t, app)

	s := NewPersonsSync(app, nil)
	stats, err := s.syncAidAdults(aidAdultsYear, relatives, households, fetch.fetch)
	if err != nil {
		t.Fatalf("syncAidAdults: %v", err)
	}

	// Every relative of the cohort's campers is fetched, guardian or not; Olivia's is not.
	if got, want := fetch.fetchedIDs(), []int{9400002, 9400101, 9400102, 9400103, 9400104}; !slices.Equal(got, want) {
		t.Errorf("fetched %v, want %v", got, want)
	}
	// Maria is named by both campers: one entry, and a guardian because Emma's record says so.
	if got, want := householdAidAdults(t, app, 9410001), []aidAdult{
		{CMID: 9400101, First: "Maria", Last: "Garcia", Role: 1, IsGuardian: true},
	}; !slices.Equal(got, want) {
		t.Errorf("9410001 aid_adults = %+v, want %+v", got, want)
	}
	// The second household is named by its principals, First then Second, though neither is a guardian.
	if got, want := householdAidAdults(t, app, 9410002), []aidAdult{
		{CMID: 9400102, First: "David", Last: "Chen", Role: 1},
		{CMID: 9400103, First: "Sarah", Last: "Chen", Preferred: "Sally", Role: 2},
	}; !slices.Equal(got, want) {
		t.Errorf("9410002 aid_adults = %+v, want %+v", got, want)
	}
	// Outside the cohort's households: nothing written.
	for _, h := range []int{9410003, 9410004} {
		if got := householdAidAdults(t, app, h); len(got) != 0 {
			t.Errorf("%d aid_adults = %+v, want none", h, got)
		}
	}
	if stats.Households != 2 || stats.Adults != 3 {
		t.Errorf("stats = %+v, want 2 households, 3 adults", stats)
	}
}

func TestSyncAidAdults_RewritesEachRunAndClearsHouseholdsThatLeave(t *testing.T) {
	t.Parallel()
	app := aidAdultsTestApp(t)
	stale := []aidAdult{{CMID: 9499999, First: "Olivia", Last: "Chen", Role: 1}}
	aidAdultsHousehold(t, app, 9410001, stale)
	aidAdultsHousehold(t, app, 9410002, []aidAdult{
		{CMID: 9400102, First: "David", Last: "Chen", Role: 1},
		{CMID: 9400103, First: "Sarah", Last: "Chen", Preferred: "Sally", Role: 2},
	})
	aidAdultsHousehold(t, app, 9410003, stale) // Olivia's household: left the cohort
	aidAdultsHousehold(t, app, 9410004, nil)
	relatives, households, fetch := seedAidAdultsCohort(t, app)

	s := NewPersonsSync(app, nil)
	stats, err := s.syncAidAdults(aidAdultsYear, relatives, households, fetch.fetch)
	if err != nil {
		t.Fatalf("syncAidAdults: %v", err)
	}
	if got, want := householdAidAdults(t, app, 9410001), []aidAdult{
		{CMID: 9400101, First: "Maria", Last: "Garcia", Role: 1, IsGuardian: true},
	}; !slices.Equal(got, want) {
		t.Errorf("9410001 aid_adults = %+v, want the stale entry replaced by %+v", got, want)
	}
	if got := householdAidAdults(t, app, 9410003); len(got) != 0 {
		t.Errorf("9410003 aid_adults = %+v, want cleared", got)
	}
	// 9410001 replaced and 9410003 cleared; 9410002 already held its adults, so it is not saved.
	if stats.Updated != 2 {
		t.Errorf("updated = %d, want 2", stats.Updated)
	}
}

func TestSyncAidAdults_FetchFailureWritesNothing(t *testing.T) {
	t.Parallel()
	app := aidAdultsTestApp(t)
	held := []aidAdult{{CMID: 9400101, First: "Maria", Last: "Garcia", Role: 1, IsGuardian: true}}
	aidAdultsHousehold(t, app, 9410001, nil)
	aidAdultsHousehold(t, app, 9410002, nil)
	aidAdultsHousehold(t, app, 9410003, held)
	relatives, households, fetch := seedAidAdultsCohort(t, app)
	fetch.err = errors.New("campminder unavailable")

	s := NewPersonsSync(app, nil)
	if _, err := s.syncAidAdults(aidAdultsYear, relatives, households, fetch.fetch); err == nil {
		t.Fatal("syncAidAdults: want the fetch error, got nil")
	}
	// A failed run must not read as "nobody": the household that held adults keeps them.
	if got := householdAidAdults(t, app, 9410003); !slices.Equal(got, held) {
		t.Errorf("9410003 aid_adults = %+v, want it untouched %+v", got, held)
	}
}

func TestSyncAidAdults_DryRunWritesNothing(t *testing.T) {
	t.Parallel()
	app := aidAdultsTestApp(t)
	for _, h := range []int{9410001, 9410002, 9410003, 9410004} {
		aidAdultsHousehold(t, app, h, nil)
	}
	relatives, households, fetch := seedAidAdultsCohort(t, app)

	s := NewPersonsSync(app, nil)
	s.SetDryRun(true)
	stats, err := s.syncAidAdults(aidAdultsYear, relatives, households, fetch.fetch)
	if err != nil {
		t.Fatalf("syncAidAdults: %v", err)
	}
	if got := householdAidAdults(t, app, 9410002); len(got) != 0 {
		t.Errorf("dry run wrote 9410002 aid_adults = %+v", got)
	}
	if stats.Updated != 2 {
		t.Errorf("dry run updated = %d, want 2 (counted, not written)", stats.Updated)
	}
}

func TestSyncAidAdults_FetchesRelativesInGetPersonsBatches(t *testing.T) {
	t.Parallel()
	app := aidAdultsTestApp(t)
	aidAdultsHousehold(t, app, 9410001, nil)
	aidAdultsPerson(t, app, 9400001, 9410001)
	aidApplication(t, app, aidAdultsYear, 9400001, true)
	many := make([]relativeRef, 0, 1201)
	for i := range 1201 {
		many = append(many, relativeRef{ID: 9500000 + i})
	}
	fetch := &fakeFetch{}

	s := NewPersonsSync(app, nil)
	if _, err := s.syncAidAdults(aidAdultsYear, map[int][]relativeRef{9400001: many},
		map[int]personHouseholdIDs{9400001: {PrimaryChildhoodID: 9410001}}, fetch.fetch); err != nil {
		t.Fatalf("syncAidAdults: %v", err)
	}
	sizes := make([]int, 0, len(fetch.calls))
	for _, c := range fetch.calls {
		sizes = append(sizes, len(c))
	}
	if want := []int{500, 500, 201}; !slices.Equal(sizes, want) {
		t.Errorf("GetPersons batch sizes = %v, want %v", sizes, want)
	}
}

func TestRelativesOf(t *testing.T) {
	t.Parallel()
	person := map[string]any{
		"ID": float64(9400001),
		"Relatives": []any{
			map[string]any{"ID": float64(9400101), "IsGuardian": true, "IsPrimary": true},
			map[string]any{"ID": float64(9400102), "IsGuardian": false, "IsPrimary": false},
			map[string]any{"ID": float64(0), "IsGuardian": true},
			map[string]any{"IsGuardian": true},
			"not a relative",
		},
	}
	want := []relativeRef{{ID: 9400101, IsGuardian: true}, {ID: 9400102}}
	if got := relativesOf(person); !slices.Equal(got, want) {
		t.Errorf("relativesOf = %+v, want %+v", got, want)
	}
	if got := relativesOf(map[string]any{"ID": float64(1)}); len(got) != 0 {
		t.Errorf("relativesOf(no Relatives) = %+v, want none", got)
	}
}

// The persons pass keeps each person's Relatives, which it already fetches, so the aid
// step needs no second call for the campers themselves.
func TestProcessBatchPersons_KeepsEachPersonsRelatives(t *testing.T) {
	t.Parallel()
	app := aidAdultsTestApp(t)
	s := NewPersonsSync(app, nil)
	result := &personBatchResult{
		extractedHouseholds:   map[int]map[string]any{},
		processedHouseholdIDs: map[int]bool{},
		personHouseholdMap:    map[int]personHouseholdIDs{},
		relatives:             map[int][]relativeRef{},
	}
	person := map[string]any{
		"ID":        float64(9400001),
		"Relatives": []any{map[string]any{"ID": float64(9400101), "IsGuardian": true}},
	}
	s.processBatchPersons([]map[string]any{person}, map[int]bool{9400001: true}, map[int]*core.Record{},
		map[string]string{}, map[int]string{}, aidAdultsYear, result)
	if got, want := result.relatives[9400001], []relativeRef{{ID: 9400101, IsGuardian: true}}; !slices.Equal(got, want) {
		t.Errorf("relatives[9400001] = %+v, want %+v", got, want)
	}
}

// The household upsert writes only the keys it builds: an existing household's aid_adults
// survives a persons run that changes its other fields.
func TestProcessHouseholdRecord_LeavesAidAdultsAlone(t *testing.T) {
	t.Parallel()
	app := aidAdultsTestApp(t)
	held := []aidAdult{{CMID: 9400101, First: "Maria", Last: "Garcia", Role: 1, IsGuardian: true}}
	aidAdultsHousehold(t, app, 9410001, held)
	rec, err := app.FindFirstRecordByFilter("households", "cm_id = 9410001")
	if err != nil {
		t.Fatalf("household: %v", err)
	}

	s := NewPersonsSync(app, nil)
	pbData, err := s.transformHouseholdToPB(map[string]any{
		"ID": float64(9410001), "MailingTitle": "Ms. Maria Garcia", "Greeting": "Maria",
	}, aidAdultsYear)
	if err != nil {
		t.Fatalf("transformHouseholdToPB: %v", err)
	}
	if _, ok := pbData["aid_adults"]; ok {
		t.Fatal("transformHouseholdToPB builds aid_adults; the persons upsert must never write it")
	}
	stats := Stats{}
	if err := s.processHouseholdRecord(9410001, pbData, map[int]*core.Record{9410001: rec},
		[]string{"cm_id", "greeting", "mailing_title"}, &stats); err != nil {
		t.Fatalf("processHouseholdRecord: %v", err)
	}
	if stats.Updated != 1 {
		t.Fatalf("updated = %d, want 1 (the mailing title changed)", stats.Updated)
	}
	if got := householdAidAdults(t, app, 9410001); !slices.Equal(got, held) {
		t.Errorf("aid_adults = %+v after the upsert, want %+v", got, held)
	}
}

func TestAidAdultsSeason_OnlyTheCurrentSeason(t *testing.T) {
	t.Parallel()
	season2026 := func() (int, error) { return 2026, nil }
	if !aidAdultsSeason(2026, season2026) {
		t.Error("aidAdultsSeason(2026) = false with the season configured as 2026")
	}
	if aidAdultsSeason(2025, season2026) {
		t.Error("aidAdultsSeason(2025) = true: a historical replay must not rewrite aid_adults")
	}
	unset := func() (int, error) { return 0, errors.New("CAMPMINDER_SEASON_ID not set") }
	if aidAdultsSeason(2026, unset) {
		t.Error("aidAdultsSeason(2026) = true with no season configured")
	}
	if aidAdultsSeason(0, unset) {
		t.Error("aidAdultsSeason(0) = true with no season configured: an unresolved season must fail closed")
	}
}

// The Google Sheets export names its columns, and the Households sheet's are pinned here: a
// column added for aid_adults would publish Camperships-only names to the workbook.
func TestHouseholdsExportColumnsUnchanged(t *testing.T) {
	t.Parallel()
	var households *ExportConfig
	all := append(GetReadableYearExports(), GetReadableGlobalExports()...)
	for i := range all {
		if all[i].Collection == "households" {
			households = &all[i]
		}
		for _, c := range all[i].Columns {
			for _, f := range []string{c.Field, c.RelatedField, c.NestedField, c.WriteInField, c.IntermediateLink} {
				if f == "aid_adults" {
					t.Errorf("%s exports aid_adults", all[i].SheetName)
				}
			}
		}
	}
	if households == nil {
		t.Fatal("no Households export")
	}
	got := make([]string, 0, len(households.Columns))
	for _, c := range households.Columns {
		got = append(got, c.Field)
	}
	if want := []string{"cm_id", "mailing_title"}; !slices.Equal(got, want) {
		t.Errorf("Households sheet columns = %v, want %v", got, want)
	}
}
