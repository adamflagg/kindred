package sync

import (
	"context"
	"sort"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	pbtests "github.com/pocketbase/pocketbase/tests"
)

// Test constants for fictional data
// Fictional, and verified absent from the production snapshot. tests/CLAUDE.md:
// values that appear in real data do not belong in a public test file, and a
// congregation name is exactly the kind of identifying detail the rule covers.
const testCongregation = "Riverside Synagogue"

// testAffiliation is shared by the aggregation tests and the setColumn tests.
const testAffiliation = "Reform"

// Every test in this file calls the PRODUCTION functions.
//
// The suite that shipped here did not. `aggregatePersonValuesByHousehold`,
// `buildDemographicRecord`, `buildDemographicsCompositeKey`,
// `mapHHFieldToColumn`, `mapHouseholdFieldToColumn`, `parseBooleanCustomValue`
// and `isHHField` were test-local reimplementations that production never
// called, so the ten years of answers `mapPersonFieldToRecord` was discarding
// (kindred#2260) never turned a test red. They are gone; nothing in this file
// asserts against a copy of the code under test.

// TestHouseholdDemographicsLoadFieldDefinitionsTrimsNames is a regression test
// for kindred#1873. HH- prefixed fields are admitted by prefix, which a
// trailing space would not defeat, but MapHHFieldToColumn exact-matches the
// trimmed literal downstream -- so an untrimmed name would be admitted into
// the map and then silently fail to route. The household-level fields
// ("Center", "Custody Issues", "Board") are admitted by exact match, so an
// untrimmed name there would fail admission itself. No untrimmed name exists
// in this table today; this pins the fix against a future one.
func TestHouseholdDemographicsLoadFieldDefinitionsTrimsNames(t *testing.T) {
	t.Parallel()
	app := newFieldDefsTestApp(t, map[int]string{
		1: "HH-Family Description ", // trailing space
		2: "Board ",                 // trailing space, exact-match admission
		3: "HH-Military",            // already clean, must be unaffected
	})

	s := NewHouseholdDemographicsSync(app)
	got, err := s.loadFieldDefinitions(context.Background())
	if err != nil {
		t.Fatalf("loadFieldDefinitions: %v", err)
	}

	want := map[string]bool{
		"HH-Family Description": true,
		"Board":                 true,
		"HH-Military":           true,
	}
	for _, name := range got {
		if !want[name] {
			t.Errorf("loadFieldDefinitions returned %q; expected a trimmed name", name)
		}
		delete(want, name)
	}
	for missing := range want {
		t.Errorf("loadFieldDefinitions did not return %q", missing)
	}

	const wantFamilyDescriptionCol = "family_description"
	if col := MapHHFieldToColumn("HH-Family Description"); col != wantFamilyDescriptionCol {
		t.Errorf("MapHHFieldToColumn(%q) = %q, want %q", "HH-Family Description", col, wantFamilyDescriptionCol)
	}
	const wantBoardMemberCol = "board_member"
	if col := MapHouseholdFieldToColumn("Board"); col != wantBoardMemberCol {
		t.Errorf("MapHouseholdFieldToColumn(%q) = %q, want %q", "Board", col, wantBoardMemberCol)
	}
}

// ============================================================================
// Service Identity Tests
// ============================================================================

// TestHouseholdDemographicsSync_Name verifies the service name is correct
func TestHouseholdDemographicsSync_Name(t *testing.T) {
	t.Parallel()
	// The orchestrator registers and looks this service up by name; a rename
	// that missed one of the two registration paths would strand the job.
	if got := NewHouseholdDemographicsSync(nil).Name(); got != "household_demographics" {
		t.Errorf("Name() = %q, want %q", got, "household_demographics")
	}
}

// TestHouseholdDemographicsSync_YearValidation tests year parameter validation
func TestHouseholdDemographicsSync_YearValidation(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name      string
		year      int
		wantValid bool
	}{
		{"valid year 2024", 2024, true},
		{"valid year 2017 (minimum)", 2017, true},
		{"valid year 2025", 2025, true},
		{"year too old 2016", 2016, false},
		{"year too old 2010", 2010, false},
		{"year far future 2100", 2100, false},
		{"zero year", 0, false},
		{"negative year", -2024, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			valid := isValidDemographicsYear(tt.year)
			if valid != tt.wantValid {
				t.Errorf("isValidDemographicsYear(%d) = %v, want %v", tt.year, valid, tt.wantValid)
			}
		})
	}
}

// ============================================================================
// Field Mapping Tests
// ============================================================================

// TestHouseholdDemographicsFieldMapping tests mapping from HH- fields to demographic columns
func TestHouseholdDemographicsFieldMapping(t *testing.T) {
	t.Parallel()
	tests := []struct {
		fieldName      string
		expectedColumn string
	}{
		// Family Description
		{"HH-Family Description", "family_description"},
		{"HH-Family Description Other", "family_description_other"},

		// Jewish Identity
		{"HH-Jewish Affiliation", "jewish_affiliation"},
		{"HH-Jewish Affiliation Other", "jewish_affiliation_other"},
		{"HH-Jewish Identities", "jewish_identities"},

		// Congregation - from person (summer camp)
		{"HH-Name of Congregation", "congregation_summer"},

		// JCC - from person (summer camp)
		{"HH-Name of JCC", "jcc_summer"},

		// Demographics
		{"HH-Military", "military_family"},
		{"HH-parent born outside US", "parent_immigrant"},
		{"HH-if yes parent born outside US, where", "parent_immigrant_origin"},

		// Custody
		{"HH-special living arrangements", "custody_summer"},
		{"HH-special living arrange-yes", "has_custody_considerations"},

		// Away info
		{"HH-Home or Away", "away_during_camp"},
		{"HH-Away location", "away_location"},
		{"HH-Phone number while away", "away_phone"},
		{"HH-Away From (mm/dd/yy)", "away_from_date"},
		{"HH-Returning (mm/dd/yy)", "away_return_date"},

		// Metadata
		{"HH-Who is filling out info", "form_filler"},
	}

	for _, tt := range tests {
		t.Run(tt.fieldName, func(t *testing.T) {
			column := MapHHFieldToColumn(tt.fieldName)
			if column != tt.expectedColumn {
				t.Errorf("MapHHFieldToColumn(%q) = %q, want %q", tt.fieldName, column, tt.expectedColumn)
			}
		})
	}
}

// TestHouseholdCustomFieldMapping tests mapping from household custom fields
func TestHouseholdCustomFieldMapping(t *testing.T) {
	t.Parallel()
	tests := []struct {
		fieldName      string
		expectedColumn string
	}{
		// These come from household_custom_values, not person_custom_values
		{customFieldNameSynagogue, "congregation_family"},
		{"Center", "jcc_family"},
		{"Custody Issues", "custody_family"},
		{"Board", "board_member"},

		// Fields that should be ignored (not relevant to demographics)
		{"Filemaker Household Acct No", ""},
		{"Early Reg", ""},
		{"Family Camp Cabin", ""},   // Handled by family_camp_derived
		{"Family Camp Adult 1", ""}, // Handled by family_camp_derived
		{"Unknown Field Name", ""},
	}

	for _, tt := range tests {
		t.Run(tt.fieldName, func(t *testing.T) {
			column := MapHouseholdFieldToColumn(tt.fieldName)
			if column != tt.expectedColumn {
				t.Errorf("MapHouseholdFieldToColumn(%q) = %q, want %q", tt.fieldName, column, tt.expectedColumn)
			}
		})
	}
}

// ============================================================================
// Boolean Field Parsing Tests
// ============================================================================

// TestHouseholdDemographicsBooleanParsing tests parsing of boolean custom field values
func TestHouseholdDemographicsBooleanParsing(t *testing.T) {
	t.Parallel()
	tests := []struct {
		value    string
		expected bool
	}{
		// True values
		{"Yes", true},
		{"yes", true},
		{"YES", true},
		{"True", true},
		{"true", true},
		{"1", true},
		{"Y", true},
		{"y", true},

		// False values
		{"No", false},
		{"no", false},
		{"NO", false},
		{"False", false},
		{"false", false},
		{"0", false},
		{"N", false},
		{"n", false},
		{"", false},
		{"  ", false}, // Whitespace
		{"Unknown", false},
	}

	for _, tt := range tests {
		t.Run(tt.value, func(t *testing.T) {
			result := ParseBoolValue(tt.value)
			if result != tt.expected {
				t.Errorf("ParseBoolValue(%q) = %v, want %v", tt.value, result, tt.expected)
			}
		})
	}
}

// ============================================================================
// HH Field Detection Tests
// ============================================================================

// TestIsHHField tests detection of HH- prefixed fields
func TestIsHHField(t *testing.T) {
	t.Parallel()
	tests := []struct {
		fieldName string
		isHHField bool
	}{
		{"HH-Family Description", true},
		{"HH-Jewish Affiliation", true},
		{"HH-Military", true},
		{"Family Camp Adult 1", false},
		{customFieldNameSynagogue, false},
		{"Board", false},
		{"hh-lowercase", false}, // Case sensitive
		{"", false},
	}

	for _, tt := range tests {
		t.Run(tt.fieldName, func(t *testing.T) {
			result := IsHHField(tt.fieldName)
			if result != tt.isHHField {
				t.Errorf("IsHHField(%q) = %v, want %v", tt.fieldName, result, tt.isHHField)
			}
		})
	}
}

// ============================================================================
// Grain tests (kindred#2260) -- one row per person per household per year
// ============================================================================

// newHouseholdDemographicsTestApp returns a throwaway PocketBase app carrying
// the three collections this service reads and writes, with
// household_demographics shaped at the person grain.
//
// The unique index is declared here on purpose. It is the third leg of the
// grain triple, and a fixture that left it off would let a household-grain
// write key save two colliding rows and look correct doing it.
func newHouseholdDemographicsTestApp(t *testing.T) (app core.App, households, persons *core.Collection) {
	t.Helper()
	testApp, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(testApp.Cleanup)
	app = testApp

	households = core.NewBaseCollection("households")
	households.Fields.Add(&core.NumberField{Name: "cm_id"})
	households.Fields.Add(&core.NumberField{Name: "year"})
	if err := app.Save(households); err != nil {
		t.Fatalf("create households: %v", err)
	}

	persons = core.NewBaseCollection("persons")
	persons.Fields.Add(&core.NumberField{Name: "cm_id"})
	persons.Fields.Add(&core.RelationField{Name: "household", CollectionId: households.Id, MaxSelect: 1})
	persons.Fields.Add(&core.NumberField{Name: "year"})
	if err := app.Save(persons); err != nil {
		t.Fatalf("create persons: %v", err)
	}

	demo := core.NewBaseCollection("household_demographics")
	demo.Fields.Add(&core.RelationField{Name: "household", CollectionId: households.Id, MaxSelect: 1})
	demo.Fields.Add(&core.RelationField{Name: "person", CollectionId: persons.Id, MaxSelect: 1})
	demo.Fields.Add(&core.NumberField{Name: "person_id"})
	demo.Fields.Add(&core.NumberField{Name: "year"})
	for _, name := range []string{
		"family_description", "family_description_other", "jewish_affiliation",
		"jewish_affiliation_other", "jewish_identities", "congregation_summer",
		"congregation_family", "jcc_summer", "jcc_family", "parent_immigrant_origin",
		"custody_summer", "custody_family", "away_location", "away_phone",
		"away_from_date", "away_return_date", "form_filler",
	} {
		demo.Fields.Add(&core.TextField{Name: name})
	}
	for _, name := range []string{
		"military_family", "parent_immigrant", "has_custody_considerations",
		"away_during_camp", "board_member",
	} {
		demo.Fields.Add(&core.BoolField{Name: name})
	}
	demo.AddIndex("idx_household_demographics_hh_person_year", true,
		"`household`, `person_id`, `year`", "")
	if err := app.Save(demo); err != nil {
		t.Fatalf("create household_demographics: %v", err)
	}

	return app, households, persons
}

// hhPersonEntry is a shorthand for a person-level HH- answer in these tests.
func hhPersonEntry(householdPBID, personPBID string, personCMID int, field, value string) hhCustomValueEntry {
	return hhCustomValueEntry{
		householdPBID: householdPBID,
		personPBID:    personPBID,
		personCMID:    personCMID,
		fieldName:     field,
		value:         value,
	}
}

// hhHouseholdEntry is a shorthand for a household-level (family camp) answer.
// Household answers carry no person, which is what puts them on their own row.
func hhHouseholdEntry(householdPBID, field, value string) hhCustomValueEntry {
	return hhCustomValueEntry{householdPBID: householdPBID, fieldName: field, value: value}
}

// rowKeys returns the sorted keys of a row map, for failure messages.
func rowKeys(rows map[string]*householdDemographicsRecord) []string {
	keys := make([]string, 0, len(rows))
	for k := range rows {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// TestAggregateKeepsEveryPersonAnswer is the regression test for kindred#2260.
// Two campers in one household answering the same HH- question differently used
// to collapse to whichever row the SQLite planner yielded first; every later
// answer was discarded with no log line and no counter. Both answers must now
// survive, on their own row.
func TestAggregateKeepsEveryPersonAnswer(t *testing.T) {
	t.Parallel()
	s := NewHouseholdDemographicsSync(nil)

	values := []hhCustomValueEntry{
		hhPersonEntry("hh1", "p1", 101, "HH-Jewish Affiliation", testAffiliation),
		hhPersonEntry("hh1", "p2", 102, "HH-Jewish Affiliation", "Prefer not to answer"),
	}

	rows := s.aggregateToRows(values, nil, 2026)

	if len(rows) != 2 {
		t.Fatalf("aggregateToRows produced %d rows, want 2 (one per camper): %v", len(rows), rowKeys(rows))
	}
	first := rows[MakeCompositeKey("hh1", 101, 2026)]
	second := rows[MakeCompositeKey("hh1", 102, 2026)]
	if first == nil || second == nil {
		t.Fatalf("rows are not keyed per person: got keys %v", rowKeys(rows))
	}
	if first.jewishAffiliation != testAffiliation {
		t.Errorf("camper 101 jewish_affiliation = %q, want %q", first.jewishAffiliation, testAffiliation)
	}
	if second.jewishAffiliation != "Prefer not to answer" {
		t.Errorf("camper 102 jewish_affiliation = %q, want %q", second.jewishAffiliation, "Prefer not to answer")
	}
	if first.personPBID != "p1" || second.personPBID != "p2" {
		t.Errorf("person relation not carried: %q / %q", first.personPBID, second.personPBID)
	}
}

// TestAggregateIsOrderIndependent pins the property the old code could not
// hold. loadPersonCustomValues pages with no ORDER BY, so the input order is an
// artifact of whichever index the planner picked; the same input supplied in a
// different order must produce byte-identical rows.
func TestAggregateIsOrderIndependent(t *testing.T) {
	t.Parallel()
	s := NewHouseholdDemographicsSync(nil)

	values := []hhCustomValueEntry{
		hhPersonEntry("hh1", "p1", 101, "HH-Family Description", "Interfaith"),
		hhPersonEntry("hh1", "p1", 101, "HH-Name of Congregation", testCongregation),
		hhPersonEntry("hh1", "p2", 102, "HH-Family Description", "Single Parent|LGBTQ"),
		hhPersonEntry("hh1", "p2", 102, "HH-Military", "Yes"),
		hhPersonEntry("hh2", "p3", 103, "HH-Family Description", "Kindred Alum"),
	}
	reversed := make([]hhCustomValueEntry, len(values))
	for i, v := range values {
		reversed[len(values)-1-i] = v
	}

	forward := s.aggregateToRows(values, nil, 2026)
	backward := s.aggregateToRows(reversed, nil, 2026)

	if len(forward) != len(backward) {
		t.Fatalf("row count differs by input order: %d vs %d", len(forward), len(backward))
	}
	for key, want := range forward {
		got, ok := backward[key]
		if !ok {
			t.Fatalf("key %q missing when the same input is supplied in reverse", key)
		}
		if *got != *want {
			t.Errorf("key %q differs by input order:\n forward  = %+v\n backward = %+v", key, *want, *got)
		}
	}
}

// TestAggregateBooleanArmsStillOR covers the five boolean arms under the
// re-grain. They are logical ORs, not first-wins, and kindred#2260 is explicit
// that they were never part of the defect. Two things must hold: the OR is
// still order-independent within one camper's answers, and one camper's "No"
// no longer speaks for a sibling who said "Yes".
func TestAggregateBooleanArmsStillOR(t *testing.T) {
	t.Parallel()
	s := NewHouseholdDemographicsSync(nil)

	// Same camper, two contributing values -- the OR must win either way round.
	within := []hhCustomValueEntry{
		hhPersonEntry("hh1", "p1", 101, "HH-Military", "No"),
		hhPersonEntry("hh1", "p1", 101, "HH-Military", "Yes"),
	}
	key := MakeCompositeKey("hh1", 101, 2026)
	forward := s.aggregateToRows(within, nil, 2026)[key]
	backward := s.aggregateToRows([]hhCustomValueEntry{within[1], within[0]}, nil, 2026)[key]
	if forward == nil || backward == nil {
		t.Fatal("expected a row for camper 101 in both orders")
	}
	if !forward.militaryFamily || !backward.militaryFamily {
		t.Errorf("military_family OR regressed: forward=%v backward=%v",
			forward.militaryFamily, backward.militaryFamily)
	}

	// Two campers disagreeing: each keeps their own answer.
	across := []hhCustomValueEntry{
		hhPersonEntry("hh1", "p1", 101, "HH-Military", "No"),
		hhPersonEntry("hh1", "p2", 102, "HH-Military", "Yes"),
	}
	rows := s.aggregateToRows(across, nil, 2026)
	if got := rows[MakeCompositeKey("hh1", 101, 2026)]; got == nil || got.militaryFamily {
		t.Errorf("camper 101 answered No; military_family = %v", got != nil && got.militaryFamily)
	}
	if got := rows[MakeCompositeKey("hh1", 102, 2026)]; got == nil || !got.militaryFamily {
		t.Errorf("camper 102 answered Yes; military_family = %v", got != nil && got.militaryFamily)
	}
}

// TestAggregateHouseholdValuesGetTheirOwnRow covers the _family columns. They
// come from household_custom_values, which is one row per household per field,
// so they are already at household grain and must not be duplicated onto every
// camper's row. They land on the person-less row (person_id 0), which coexists
// with the camper rows for the same household-year.
func TestAggregateHouseholdValuesGetTheirOwnRow(t *testing.T) {
	t.Parallel()
	s := NewHouseholdDemographicsSync(nil)

	personValues := []hhCustomValueEntry{
		hhPersonEntry("hh1", "p1", 101, "HH-Name of Congregation", testCongregation),
		hhPersonEntry("hh1", "p1", 101, "HH-Name of JCC", "Bayside JCC"),
		hhPersonEntry("hh1", "p1", 101, "HH-special living arrangements", "Shared custody"),
	}
	householdValues := []hhCustomValueEntry{
		hhHouseholdEntry("hh1", customFieldNameSynagogue, "Oak Valley Synagogue"),
		hhHouseholdEntry("hh1", "Center", "Lakeside JCC"),
		hhHouseholdEntry("hh1", "Custody Issues", "Week on/week off"),
		hhHouseholdEntry("hh1", "Board", "Yes"),
	}

	rows := s.aggregateToRows(personValues, householdValues, 2026)
	if len(rows) != 2 {
		t.Fatalf("got %d rows, want 2 (one camper row + one household row): %v", len(rows), rowKeys(rows))
	}

	camper := rows[MakeCompositeKey("hh1", 101, 2026)]
	household := rows[MakeCompositeKey("hh1", 0, 2026)]
	if camper == nil || household == nil {
		t.Fatalf("expected a camper row and a household row, got keys %v", rowKeys(rows))
	}

	// Summer answers stay on the camper who gave them.
	if camper.congregationSummer != testCongregation {
		t.Errorf("camper congregation_summer = %q, want %q", camper.congregationSummer, testCongregation)
	}
	if camper.jccSummer != "Bayside JCC" {
		t.Errorf("camper jcc_summer = %q, want %q", camper.jccSummer, "Bayside JCC")
	}
	if camper.custodySummer != "Shared custody" {
		t.Errorf("camper custody_summer = %q, want %q", camper.custodySummer, "Shared custody")
	}
	if camper.congregationFamily != "" || camper.jccFamily != "" || camper.custodyFamily != "" || camper.boardMember {
		t.Errorf("family columns leaked onto the camper row: %+v", *camper)
	}

	// Family answers stay on the household row.
	if household.congregationFamily != "Oak Valley Synagogue" {
		t.Errorf("household congregation_family = %q", household.congregationFamily)
	}
	if household.jccFamily != "Lakeside JCC" {
		t.Errorf("household jcc_family = %q", household.jccFamily)
	}
	if household.custodyFamily != "Week on/week off" {
		t.Errorf("household custody_family = %q", household.custodyFamily)
	}
	if !household.boardMember {
		t.Error("household board_member = false, want true")
	}
	if household.congregationSummer != "" || household.jccSummer != "" || household.custodySummer != "" {
		t.Errorf("summer columns leaked onto the household row: %+v", *household)
	}
	if household.personPBID != "" || household.personCMID != 0 {
		t.Errorf("household row carries a person: %q / %d", household.personPBID, household.personCMID)
	}
}

// TestAggregateFullRecord drives every arm of both mapping switches for a
// single camper, so a case arm dropped or mis-wired during the re-grain shows
// up as a wrong column rather than as a missing test.
func TestAggregateFullRecord(t *testing.T) {
	t.Parallel()
	s := NewHouseholdDemographicsSync(nil)

	personValues := []hhCustomValueEntry{
		hhPersonEntry("hh1", "p1", 101, "HH-Family Description", "LGBTQ|Interfaith"),
		hhPersonEntry("hh1", "p1", 101, "HH-Family Description Other", "Multigenerational"),
		hhPersonEntry("hh1", "p1", 101, "HH-Jewish Affiliation", testAffiliation),
		hhPersonEntry("hh1", "p1", 101, "HH-Jewish Affiliation Other", "Renewal"),
		hhPersonEntry("hh1", "p1", 101, "HH-Jewish Identities", "Ashkenazi|Sephardi"),
		hhPersonEntry("hh1", "p1", 101, "HH-Name of Congregation", testCongregation),
		hhPersonEntry("hh1", "p1", 101, "HH-Name of JCC", "Bayside JCC"),
		hhPersonEntry("hh1", "p1", 101, "HH-Military", "No"),
		hhPersonEntry("hh1", "p1", 101, "HH-parent born outside US", "Yes"),
		hhPersonEntry("hh1", "p1", 101, "HH-if yes parent born outside US, where", "Israel"),
		hhPersonEntry("hh1", "p1", 101, "HH-special living arrangements", "Shared custody"),
		hhPersonEntry("hh1", "p1", 101, "HH-special living arrange-yes", "Yes"),
		hhPersonEntry("hh1", "p1", 101, "HH-Home or Away", "Yes"),
		hhPersonEntry("hh1", "p1", 101, "HH-Away location", "Cape Cod"),
		hhPersonEntry("hh1", "p1", 101, "HH-Phone number while away", "555-0100"),
		hhPersonEntry("hh1", "p1", 101, "HH-Away From (mm/dd/yy)", "07/01/26"),
		hhPersonEntry("hh1", "p1", 101, "HH-Returning (mm/dd/yy)", "07/15/26"),
		hhPersonEntry("hh1", "p1", 101, "HH-Who is filling out info", "Parent"),
	}
	householdValues := []hhCustomValueEntry{
		hhHouseholdEntry("hh1", customFieldNameSynagogue, "Oak Valley Synagogue"),
		hhHouseholdEntry("hh1", "Center", "Lakeside JCC"),
		hhHouseholdEntry("hh1", "Custody Issues", "Week on/week off"),
		hhHouseholdEntry("hh1", "Board", "Yes"),
	}

	rows := s.aggregateToRows(personValues, householdValues, 2026)
	camper := rows[MakeCompositeKey("hh1", 101, 2026)]
	if camper == nil {
		t.Fatalf("no camper row, got keys %v", rowKeys(rows))
	}

	want := householdDemographicsRecord{
		householdPBID:            "hh1",
		personPBID:               "p1",
		personCMID:               101,
		year:                     2026,
		familyDescription:        "LGBTQ|Interfaith",
		familyDescriptionOther:   "Multigenerational",
		jewishAffiliation:        testAffiliation,
		jewishAffiliationOther:   "Renewal",
		jewishIdentities:         "Ashkenazi|Sephardi",
		congregationSummer:       testCongregation,
		jccSummer:                "Bayside JCC",
		militaryFamily:           false,
		parentImmigrant:          true,
		parentImmigrantOrigin:    "Israel",
		custodySummer:            "Shared custody",
		hasCustodyConsiderations: true,
		awayDuringCamp:           true,
		awayLocation:             "Cape Cod",
		awayPhone:                "555-0100",
		awayFromDate:             "07/01/26",
		awayReturnDate:           "07/15/26",
		formFiller:               "Parent",
	}
	if *camper != want {
		t.Errorf("camper row =\n %+v\nwant\n %+v", *camper, want)
	}

	household := rows[MakeCompositeKey("hh1", 0, 2026)]
	if household == nil {
		t.Fatalf("no household row, got keys %v", rowKeys(rows))
	}
	wantHousehold := householdDemographicsRecord{
		householdPBID:      "hh1",
		year:               2026,
		congregationFamily: "Oak Valley Synagogue",
		jccFamily:          "Lakeside JCC",
		custodyFamily:      "Week on/week off",
		boardMember:        true,
	}
	if *household != wantHousehold {
		t.Errorf("household row =\n %+v\nwant\n %+v", *household, wantHousehold)
	}
}

// TestAggregatePreservesMultiSelectVerbatim covers the pipe-delimited
// multi-selects, which is why kindred#2260 rejected both a newest-wins collapse
// and a union: the newest answer is missing a token a sibling carries in 86% of
// colliding cells, and pairs like "Prefer not to answer" against a named
// affiliation cannot be unioned coherently. Each camper's string is stored as
// given, untouched.
func TestAggregatePreservesMultiSelectVerbatim(t *testing.T) {
	t.Parallel()
	s := NewHouseholdDemographicsSync(nil)

	rows := s.aggregateToRows([]hhCustomValueEntry{
		hhPersonEntry("hh1", "p1", 101, "HH-Family Description", "LGBTQ|Interfaith"),
		hhPersonEntry("hh1", "p2", 102, "HH-Family Description", "Single Parent|LGBTQ"),
		hhPersonEntry("hh2", "p3", 103, "HH-Family Description", "Kindred Alum"),
	}, nil, 2026)

	want := map[string]string{
		MakeCompositeKey("hh1", 101, 2026): "LGBTQ|Interfaith",
		MakeCompositeKey("hh1", 102, 2026): "Single Parent|LGBTQ",
		MakeCompositeKey("hh2", 103, 2026): "Kindred Alum",
	}
	if len(rows) != len(want) {
		t.Fatalf("got %d rows, want %d: %v", len(rows), len(want), rowKeys(rows))
	}
	for key, value := range want {
		got := rows[key]
		if got == nil {
			t.Fatalf("row %q missing, got keys %v", key, rowKeys(rows))
		}
		if got.familyDescription != value {
			t.Errorf("row %q family_description = %q, want %q", key, got.familyDescription, value)
		}
	}
}

// TestMakeCompositeKeyCarriesPerson pins leg one of the grain triple, the write
// key. A key that omits the person collapses siblings back together no matter
// what the index says.
func TestMakeCompositeKeyCarriesPerson(t *testing.T) {
	t.Parallel()
	tests := []struct {
		household string
		personCM  int
		year      int
		want      string
	}{
		{"abc123", 5001, 2026, "abc123|5001|2026"},
		{"abc123", 5002, 2026, "abc123|5002|2026"},
		{"abc123", 0, 2026, "abc123|0|2026"}, // the household-level row
		{"abc123", 5001, 2025, "abc123|5001|2025"},
		{"xyz789", 5001, 2026, "xyz789|5001|2026"},
	}

	seen := make(map[string]bool, len(tests))
	for _, tt := range tests {
		got := MakeCompositeKey(tt.household, tt.personCM, tt.year)
		if got != tt.want {
			t.Errorf("MakeCompositeKey(%q, %d, %d) = %q, want %q",
				tt.household, tt.personCM, tt.year, got, tt.want)
		}
		if seen[got] {
			t.Errorf("MakeCompositeKey collided on %q", got)
		}
		seen[got] = true
	}
}

// TestUpsertAndOrphanSweepAgreeOnGrain is the grain-triple test. kindred#2257
// states the trap plainly: widen the write key and the unique index but not the
// orphan key, and the next sync run deletes the rows the widening just created
// and reports success. This drives the real write path and the real sweep
// against a fixture carrying the real unique index, so a key that disagrees
// with either of the other two legs fails here rather than in production.
func TestUpsertAndOrphanSweepAgreeOnGrain(t *testing.T) {
	t.Parallel()
	app, households, persons := newHouseholdDemographicsTestApp(t)
	ctx := context.Background()

	hh := core.NewRecord(households)
	hh.Set("cm_id", 9001)
	hh.Set("year", 2026)
	if err := app.Save(hh); err != nil {
		t.Fatalf("save household: %v", err)
	}
	personPBIDs := make(map[int]string, 2)
	for _, cmID := range []int{101, 102} {
		p := core.NewRecord(persons)
		p.Set("cm_id", cmID)
		p.Set("household", hh.Id)
		p.Set("year", 2026)
		if err := app.Save(p); err != nil {
			t.Fatalf("save person %d: %v", cmID, err)
		}
		personPBIDs[cmID] = p.Id
	}

	s := NewHouseholdDemographicsSync(app)
	both := []hhCustomValueEntry{
		hhPersonEntry(hh.Id, personPBIDs[101], 101, "HH-Jewish Affiliation", testAffiliation),
		hhPersonEntry(hh.Id, personPBIDs[102], 102, "HH-Jewish Affiliation", "Prefer not to answer"),
	}

	rows := s.aggregateToRows(both, nil, 2026)
	existing, err := s.loadExistingRecords(ctx, 2026)
	if err != nil {
		t.Fatalf("loadExistingRecords: %v", err)
	}
	created, _, _, errs := s.upsertRecords(ctx, rows, existing, 2026)
	if errs != 0 {
		t.Fatalf("upsertRecords reported %d errors", errs)
	}
	if created != 2 {
		t.Fatalf("upsertRecords created %d rows, want 2 (one per camper)", created)
	}

	// Leg two: the sweep must recognize both rows as computed. A household-grain
	// orphan key matches neither and deletes the pair it just wrote.
	existing, err = s.loadExistingRecords(ctx, 2026)
	if err != nil {
		t.Fatalf("loadExistingRecords after upsert: %v", err)
	}
	if len(existing) != 2 {
		t.Fatalf("loadExistingRecords keyed %d rows, want 2 -- a household-grain key hides a sibling", len(existing))
	}
	if deleted, sweepErr := s.deleteOrphans(ctx, rows, existing, 2026); sweepErr != nil || deleted != 0 {
		t.Fatalf("deleteOrphans removed %d of the rows the write path just created (err=%v)", deleted, sweepErr)
	}
	if n := countDemographicsRows(t, app); n != 2 {
		t.Fatalf("household_demographics holds %d rows after a no-op sweep, want 2", n)
	}

	// A camper who stops answering is a real orphan -- exactly one row goes.
	onlyFirst := s.aggregateToRows(both[:1], nil, 2026)
	existing, err = s.loadExistingRecords(ctx, 2026)
	if err != nil {
		t.Fatalf("loadExistingRecords before sweep: %v", err)
	}
	if deleted, sweepErr := s.deleteOrphans(ctx, onlyFirst, existing, 2026); sweepErr != nil || deleted != 1 {
		t.Fatalf("deleteOrphans removed %d rows, want 1 (err=%v)", deleted, sweepErr)
	}
	if n := countDemographicsRows(t, app); n != 1 {
		t.Fatalf("household_demographics holds %d rows, want 1", n)
	}
	survivor, err := app.FindFirstRecordByFilter("household_demographics", "year = 2026")
	if err != nil {
		t.Fatalf("find survivor: %v", err)
	}
	if survivor.GetInt("person_id") != 101 {
		t.Errorf("survivor person_id = %d, want 101", survivor.GetInt("person_id"))
	}
	if survivor.GetString("person") != personPBIDs[101] {
		t.Errorf("survivor person relation = %q, want %q", survivor.GetString("person"), personPBIDs[101])
	}
}

// TestDeleteOrphansRefusesToEmptyTheTable guards the sweep against an upstream
// load that came back empty. Every row here is recomputed from
// person_custom_values on each run, so an empty computed set is far more likely
// to be a failed read than a year in which nobody answered anything -- and the
// sweep is the one step of this sync that a re-run cannot undo.
func TestDeleteOrphansRefusesToEmptyTheTable(t *testing.T) {
	t.Parallel()
	app, households, persons := newHouseholdDemographicsTestApp(t)
	ctx := context.Background()

	hh := core.NewRecord(households)
	hh.Set("cm_id", 9001)
	hh.Set("year", 2026)
	if err := app.Save(hh); err != nil {
		t.Fatalf("save household: %v", err)
	}
	p := core.NewRecord(persons)
	p.Set("cm_id", 101)
	p.Set("household", hh.Id)
	p.Set("year", 2026)
	if err := app.Save(p); err != nil {
		t.Fatalf("save person: %v", err)
	}

	s := NewHouseholdDemographicsSync(app)
	rows := s.aggregateToRows([]hhCustomValueEntry{
		hhPersonEntry(hh.Id, p.Id, 101, "HH-Jewish Affiliation", testAffiliation),
	}, nil, 2026)
	existing, err := s.loadExistingRecords(ctx, 2026)
	if err != nil {
		t.Fatalf("loadExistingRecords: %v", err)
	}
	if _, _, _, errs := s.upsertRecords(ctx, rows, existing, 2026); errs != 0 {
		t.Fatalf("upsertRecords reported %d errors", errs)
	}
	existing, err = s.loadExistingRecords(ctx, 2026)
	if err != nil {
		t.Fatalf("loadExistingRecords after upsert: %v", err)
	}

	deleted, err := s.deleteOrphans(ctx, map[string]*householdDemographicsRecord{}, existing, 2026)
	if err == nil {
		t.Error("deleteOrphans against an empty computed set returned nil; want a refusal error")
	}
	if deleted != 0 {
		t.Errorf("deleteOrphans removed %d rows against an empty computed set; want a refusal", deleted)
	}
	if n := countDemographicsRows(t, app); n != 1 {
		t.Errorf("household_demographics holds %d rows, want 1 (nothing swept)", n)
	}
}

// countDemographicsRows returns the number of household_demographics rows.
func countDemographicsRows(t *testing.T, app core.App) int {
	t.Helper()
	records, err := app.FindRecordsByFilter("household_demographics", "year > 0", "", 0, 0)
	if err != nil {
		t.Fatalf("count household_demographics: %v", err)
	}
	return len(records)
}

// setColumn is the must-be-unique rule that REPLACED first-non-empty-wins, and
// it is the behavioral core of kindred#2260. Nothing covered it, so a refactor
// restoring `if *dst == "" { *dst = value }` -- the exact shape that discarded
// 7,781 answers over ten years -- passed the whole suite green.
//
// The three arms are pinned separately because only the third one distinguishes
// the new rule from the old one.
func TestSetColumnIsMustBeUniqueNotFirstWins(t *testing.T) {
	t.Parallel()
	t.Run("writes into an empty column", func(t *testing.T) {
		s := &HouseholdDemographicsSync{}
		rec := &householdDemographicsRecord{householdPBID: "hh1", personCMID: 11, year: 2026}

		s.setColumn(rec, &rec.jewishAffiliation, "jewish_affiliation", testAffiliation)

		if rec.jewishAffiliation != testAffiliation {
			t.Errorf("column = %q, want %q", rec.jewishAffiliation, testAffiliation)
		}
		if s.columnConflicts != 0 {
			t.Errorf("conflicts = %d, want 0 -- a first write is not a conflict", s.columnConflicts)
		}
	})

	t.Run("the same answer twice is not a conflict", func(t *testing.T) {
		s := &HouseholdDemographicsSync{}
		rec := &householdDemographicsRecord{householdPBID: "hh1", personCMID: 11, year: 2026}

		s.setColumn(rec, &rec.jewishAffiliation, "jewish_affiliation", testAffiliation)
		s.setColumn(rec, &rec.jewishAffiliation, "jewish_affiliation", testAffiliation)

		if s.columnConflicts != 0 {
			t.Errorf("conflicts = %d, want 0 -- an identical repeat discards nothing", s.columnConflicts)
		}
	})

	// The arm that matters. Under the old first-non-empty-wins code this case was
	// silent: the second value vanished and nothing counted it. It must now be
	// counted, and the stored value must not flip -- a silent overwrite would be
	// the same defect pointing the other way.
	t.Run("a genuinely different answer is counted, not swallowed", func(t *testing.T) {
		s := &HouseholdDemographicsSync{}
		rec := &householdDemographicsRecord{householdPBID: "hh1", personCMID: 11, year: 2026}

		s.setColumn(rec, &rec.jewishAffiliation, "jewish_affiliation", testAffiliation)
		s.setColumn(rec, &rec.jewishAffiliation, "jewish_affiliation", "Just Jewish")

		if s.columnConflicts != 1 {
			t.Errorf("conflicts = %d, want 1 -- a disagreement must be audible", s.columnConflicts)
		}
		if rec.jewishAffiliation != testAffiliation {
			t.Errorf("column = %q, want %q -- the refusal must not overwrite", rec.jewishAffiliation, testAffiliation)
		}
	})

	t.Run("conflicts accumulate across columns", func(t *testing.T) {
		s := &HouseholdDemographicsSync{}
		rec := &householdDemographicsRecord{householdPBID: "hh1", personCMID: 11, year: 2026}

		s.setColumn(rec, &rec.jewishAffiliation, "jewish_affiliation", testAffiliation)
		s.setColumn(rec, &rec.jewishAffiliation, "jewish_affiliation", "Just Jewish")
		s.setColumn(rec, &rec.familyDescription, "family_description", "Interfaith")
		s.setColumn(rec, &rec.familyDescription, "family_description", "Multicultural")

		if s.columnConflicts != 2 {
			t.Errorf("conflicts = %d, want 2", s.columnConflicts)
		}
	})
}

// TestHouseholdDemographicsDeleteOrphansRefusesPartialCollapse is the point of
// kindred#2283: this file carried its OWN hand-rolled guard that caught only a
// TOTAL collapse (computed set empty). A PARTIAL collapse -- a handful of rows
// computed against hundreds on disk -- sailed straight past it and swept
// everything else. The shared OrphanSweepGuard widens "empty" to "suspiciously
// small"; this test only passes once that guard is wired in, because the old
// local check (`len(records) == 0`) does not fire when records has 3 entries.
func TestHouseholdDemographicsDeleteOrphansRefusesPartialCollapse(t *testing.T) {
	t.Parallel()
	app := newOrphanSweepTestApp(t, "household_demographics", "household", "person_id")
	col, err := app.FindCollectionByNameOrId("household_demographics")
	if err != nil {
		t.Fatalf("find household_demographics: %v", err)
	}

	existing := make(map[string]string, OrphanSweepMinRows+5)
	for i := range OrphanSweepMinRows + 5 {
		rec := core.NewRecord(col)
		rec.Set("household", "hh_fixed")
		rec.Set("person_id", i+1)
		rec.Set("year", 2026)
		if saveErr := app.Save(rec); saveErr != nil {
			t.Fatalf("save existing row %d: %v", i, saveErr)
		}
		existing[MakeCompositeKey("hh_fixed", i+1, 2026)] = rec.Id
	}

	s := NewHouseholdDemographicsSync(app)
	// Only 3 computed against 25 on disk -- well under the 50% floor, and well
	// past the old hand-rolled guard's "== 0" check.
	computed := map[string]*householdDemographicsRecord{
		MakeCompositeKey("hh_fixed", 1, 2026): {householdPBID: "hh_fixed", personCMID: 1, year: 2026},
		MakeCompositeKey("hh_fixed", 2, 2026): {householdPBID: "hh_fixed", personCMID: 2, year: 2026},
		MakeCompositeKey("hh_fixed", 3, 2026): {householdPBID: "hh_fixed", personCMID: 3, year: 2026},
	}

	deleted, err := s.deleteOrphans(context.Background(), computed, existing, 2026)
	if err == nil {
		t.Fatal("expected an error when the computed set covers a fraction of what is on disk, got nil")
	}
	if deleted != 0 {
		t.Errorf("deleted = %d, want 0 -- nothing may be removed on the refusal path", deleted)
	}

	remaining, err := app.FindRecordsByFilter("household_demographics", "year = 2026", "", 0, 0)
	if err != nil {
		t.Fatalf("re-query: %v", err)
	}
	if len(remaining) != OrphanSweepMinRows+5 {
		t.Errorf("%d rows survived, want %d -- the guard must not delete", len(remaining), OrphanSweepMinRows+5)
	}
}

// newHouseholdDemographicsSyncTestApp extends newHouseholdDemographicsTestApp
// with the three collections Sync() reads on its way to the sweep, so a test
// can drive the whole run rather than calling deleteOrphans directly.
func newHouseholdDemographicsSyncTestApp(t *testing.T) (app core.App, households, persons *core.Collection) {
	t.Helper()
	app, households, persons = newHouseholdDemographicsTestApp(t)

	defs := core.NewBaseCollection("custom_field_defs")
	defs.Fields.Add(&core.TextField{Name: "name"})
	if err := app.Save(defs); err != nil {
		t.Fatalf("create custom_field_defs: %v", err)
	}

	pcv := core.NewBaseCollection("person_custom_values")
	pcv.Fields.Add(&core.TextField{Name: "person"})
	pcv.Fields.Add(&core.TextField{Name: "field_definition"})
	pcv.Fields.Add(&core.TextField{Name: "value"})
	pcv.Fields.Add(&core.NumberField{Name: "year"})
	if err := app.Save(pcv); err != nil {
		t.Fatalf("create person_custom_values: %v", err)
	}

	hcv := core.NewBaseCollection("household_custom_values")
	hcv.Fields.Add(&core.TextField{Name: "household"})
	hcv.Fields.Add(&core.TextField{Name: "field_definition"})
	hcv.Fields.Add(&core.TextField{Name: "value"})
	hcv.Fields.Add(&core.NumberField{Name: "year"})
	if err := app.Save(hcv); err != nil {
		t.Fatalf("create household_custom_values: %v", err)
	}

	return app, households, persons
}

// TestHouseholdDemographicsSyncPropagatesSweepRefusal is the caller-propagation
// test for kindred#2283. The guard tests above prove deleteOrphans REFUSES; on
// their own they prove nothing about whether anyone listens. Sibling PR
// kindred#2294 shipped exactly that gap -- a counted failure that never reached
// the returned error, so the run went green on a broken sweep.
//
// This drives the real Sync() and asserts the refusal comes back out of it.
// Deleting the `if orphanErr != nil` return in household_demographics.go makes
// this test fail; without it the whole sync suite stays green.
func TestHouseholdDemographicsSyncPropagatesSweepRefusal(t *testing.T) {
	t.Parallel()
	app, households, persons := newHouseholdDemographicsSyncTestApp(t)

	hh := core.NewRecord(households)
	hh.Set("cm_id", 9001)
	hh.Set("year", 2026)
	if err := app.Save(hh); err != nil {
		t.Fatalf("save household: %v", err)
	}

	defs, err := app.FindCollectionByNameOrId("custom_field_defs")
	if err != nil {
		t.Fatalf("find custom_field_defs: %v", err)
	}
	def := core.NewRecord(defs)
	def.Set("name", "HH-Jewish Affiliation")
	if saveErr := app.Save(def); saveErr != nil {
		t.Fatalf("save field def: %v", saveErr)
	}

	pcvCol, err := app.FindCollectionByNameOrId("person_custom_values")
	if err != nil {
		t.Fatalf("find person_custom_values: %v", err)
	}
	// Three campers answered this year -- a believable computed set on its own,
	// but a collapse against what is already stored.
	for _, cmID := range []int{101, 102, 103} {
		p := core.NewRecord(persons)
		p.Set("cm_id", cmID)
		p.Set("household", hh.Id)
		p.Set("year", 2026)
		if saveErr := app.Save(p); saveErr != nil {
			t.Fatalf("save person %d: %v", cmID, saveErr)
		}
		v := core.NewRecord(pcvCol)
		v.Set("person", p.Id)
		v.Set("field_definition", def.Id)
		v.Set("value", testAffiliation)
		v.Set("year", 2026)
		if saveErr := app.Save(v); saveErr != nil {
			t.Fatalf("save custom value for %d: %v", cmID, saveErr)
		}
	}

	// OrphanSweepMinRows+5 rows already on disk that this run does not compute.
	demoCol, err := app.FindCollectionByNameOrId("household_demographics")
	if err != nil {
		t.Fatalf("find household_demographics: %v", err)
	}
	for i := range OrphanSweepMinRows + 5 {
		rec := core.NewRecord(demoCol)
		rec.Set("household", hh.Id)
		rec.Set("person_id", 900+i)
		rec.Set("year", 2026)
		if saveErr := app.Save(rec); saveErr != nil {
			t.Fatalf("save existing row %d: %v", i, saveErr)
		}
	}

	s := NewHouseholdDemographicsSync(app)
	s.Year = 2026
	syncErr := s.Sync(context.Background())

	if syncErr == nil {
		t.Fatal("Sync returned nil on a refused sweep -- the refusal never reached the caller")
	}
	if !strings.Contains(syncErr.Error(), "orphan sweep refused") {
		t.Errorf("Sync error = %q, want it to carry the sweep refusal", syncErr.Error())
	}
	if s.SyncSuccessful {
		t.Error("SyncSuccessful is true after a refused sweep")
	}

	// The refusal must not have deleted: the seeded rows plus the three this
	// run wrote before the sweep.
	remaining, err := app.FindRecordsByFilter("household_demographics", "year = 2026", "", 0, 0)
	if err != nil {
		t.Fatalf("re-query: %v", err)
	}
	if want := OrphanSweepMinRows + 5 + 3; len(remaining) != want {
		t.Errorf("%d rows survived, want %d -- a refused sweep must delete nothing", len(remaining), want)
	}
}
