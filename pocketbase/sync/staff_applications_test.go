package sync

import (
	"context"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	pbtests "github.com/pocketbase/pocketbase/tests"
)

// TestStaffApplicationsLoadFieldDefinitionsTrimsNames is a regression test for
// kindred#1873: CampMinder ships "App-I responded to my stress ", "App-Someone
// whose work I " and "App-My closest friend at camp " with a trailing space,
// while MapStaffAppFieldToColumn exact-matches the trimmed literal. Before the
// fix, loadFieldDefinitions stored the untrimmed name, so the switch never
// matched and 3,492 answers across the three columns were silently dropped.
func TestStaffApplicationsLoadFieldDefinitionsTrimsNames(t *testing.T) {
	t.Parallel()
	app := newFieldDefsTestApp(t, map[int]string{
		1: "App-I responded to my stress ",  // trailing space, verbatim from CampMinder
		2: "App-Someone whose work I ",      // trailing space, verbatim from CampMinder
		3: "App-My closest friend at camp ", // trailing space, verbatim from CampMinder
		4: "App-Why Tawonga?",               // already clean, must be unaffected
	})

	s := NewStaffApplicationsSync(app)
	got, err := s.loadFieldDefinitions(context.Background())
	if err != nil {
		t.Fatalf("loadFieldDefinitions: %v", err)
	}

	want := map[string]bool{
		"App-I responded to my stress":  true,
		"App-Someone whose work I":      true,
		"App-My closest friend at camp": true,
		"App-Why Tawonga?":              true,
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

	// The whole point: the trimmed names must round-trip through the routing
	// switch, which is what silently dropped the three fields before the fix.
	routingCases := map[string]string{
		"App-I responded to my stress":  "stress_response",
		"App-Someone whose work I":      "someone_admire",
		"App-My closest friend at camp": "closest_friend",
	}
	for name, wantCol := range routingCases {
		if gotCol := MapStaffAppFieldToColumn(name); gotCol != wantCol {
			t.Errorf("MapStaffAppFieldToColumn(%q) = %q, want %q", name, gotCol, wantCol)
		}
	}
}

// TestStaffApplicationsServiceName verifies the service name constant
func TestStaffApplicationsServiceName(t *testing.T) {
	t.Parallel()
	expected := "staff_applications"
	if serviceNameStaffApplications != expected {
		t.Errorf("serviceNameStaffApplications = %q, want %q", serviceNameStaffApplications, expected)
	}
}

// TestMapAppFieldToColumn tests the CampMinder field name to column mapping
// for the 39 App- fields used in staff applications
func TestMapAppFieldToColumn(t *testing.T) {
	t.Parallel()
	tests := []struct {
		cmField  string
		expected string
	}{
		// Work availability fields
		{"App-Work Camp Dates?", "can_work_dates"},
		{"App-Can't Work Camp Dates Expl", "cant_work_explain"},
		{"App- Work Camp Dates Supervisor?", "work_dates_supervisor"},
		{"App-Work Camp Dates WILD?", "work_dates_wild"},
		{"App- Work Camp Dates Driver?", "work_dates_driver"},

		// Qualifications and expectations
		{"App-Work Expectations", "work_expectations"},
		{"App-Qualifications", "qualifications"},
		{"App-Qualification changes", "qualification_changes"},

		// Position preferences
		{"Position Preference 1", "position_pref_1"},
		{"Position Preference 2", "position_pref_2"},
		{"Position Preference 3", "position_pref_3"},

		// Essays and reflections
		{"App-Why Tawonga?", "why_tawonga"},
		{"App-Why work at camp again?", "why_work_again"},
		{"App-Jewish Community", "jewish_community"},
		{"App-Three Rules...", "three_rules"},
		{"App-Autobiography...", "autobiography"},
		{"App-Community Means...", "community_means"},
		{"App- Working Across Differences", "working_across_differences"},

		// Personal info
		{"App-languages", "languages"},
		{"App-Dietary Needs", "dietary_needs"},
		{"App-Dietary Needs (Other)", "dietary_needs_other"},
		{"App-Over 21", "over_21"},

		// Reference fields
		{"App-Ref 1 Name", "ref_1_name"},
		{"App-Ref 1 Phone Number", "ref_1_phone"},
		{"App-Ref 1 Email", "ref_1_email"},
		{"App-Ref 1 Relationship", "ref_1_relationship"},
		{"App-Ref 1 Yrs of Acquaintance", "ref_1_years"},

		// Reflection prompts (returning staff)
		{"App-I got stressed when", "stress_situation"},
		{"App-I responded to my stress", "stress_response"},
		{"App-I had a spiritual moment", "spiritual_moment"},
		{"App-An activity or program", "activity_program"},
		{"App-Someone whose work I", "someone_admire"},
		{"App-Since camp I've been", "since_camp"},
		{"App-I wish I had gotten toknow", "wish_knew"},
		{"App-Last summer I learned", "last_summer_learned"},
		{"App-My favorite camper moment", "favorite_camper_moment"},
		{"App-My closest friend at camp", "closest_friend"},
		{"App-Tawonga makes me think of", "tawonga_makes_think"},
		{"App-what advice would you", "advice_would_give"},
		{"App-How do you look at camp", "how_look_at_camp"},

		// Live 2026 fields, routed per owner ruling (see #2271)
		{"App-over 18", "over_18"},
		{"App-Work Camp Dates Kitchen Supervisor", "work_dates_kitchen_supervisor"},
		{"App-JEDIreturner", "jedi_returner"},
		{"App-JEDInewstaff", "jedi_new_staff"},

		// Unknown field should return empty
		{"Unknown-Field", ""},
	}

	for _, tt := range tests {
		t.Run(tt.cmField, func(t *testing.T) {
			got := MapAppFieldToColumn(tt.cmField)
			if got != tt.expected {
				t.Errorf("MapAppFieldToColumn(%q) = %q, want %q", tt.cmField, got, tt.expected)
			}
		})
	}
}

// TestParseAppBool tests boolean parsing for staff application fields
func TestParseAppBool(t *testing.T) {
	t.Parallel()
	tests := []struct {
		input    string
		expected bool
	}{
		{"Yes", true},
		{"yes", true},
		{"YES", true},
		{"No", false},
		{"no", false},
		{"NO", false},
		{"", false},
		{"Maybe", false},
		{"1", false}, // Only "Yes" variants are true
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := parseAppBool(tt.input)
			if got != tt.expected {
				t.Errorf("parseAppBool(%q) = %v, want %v", tt.input, got, tt.expected)
			}
		})
	}
}

// TestStaffApplicationsCompositeKey tests the unique key generation
// Key format: personID|year
func TestStaffApplicationsCompositeKey(t *testing.T) {
	t.Parallel()
	tests := []struct {
		personID int
		year     int
		expected string
	}{
		{12345, 2025, "12345|2025"},
		{67890, 2026, "67890|2026"},
		{100001, 2024, "100001|2024"},
	}

	for _, tt := range tests {
		t.Run(tt.expected, func(t *testing.T) {
			got := makeStaffApplicationsKey(tt.personID, tt.year)
			if got != tt.expected {
				t.Errorf("makeStaffApplicationsKey(%d, %d) = %q, want %q",
					tt.personID, tt.year, got, tt.expected)
			}
		})
	}
}

// TestStaffApplicationsFieldMapping tests that all expected fields are present
func TestStaffApplicationsFieldMapping(t *testing.T) {
	t.Parallel()
	expectedFields := []string{
		// Work availability
		"can_work_dates",
		"cant_work_explain",
		"work_dates_supervisor",
		"work_dates_wild",
		"work_dates_driver",
		// Qualifications
		"work_expectations",
		"qualifications",
		"qualification_changes",
		// Position preferences
		"position_pref_1",
		"position_pref_2",
		"position_pref_3",
		// Essays
		"why_tawonga",
		"why_work_again",
		"jewish_community",
		"three_rules",
		"autobiography",
		"community_means",
		"working_across_differences",
		// Personal info
		"languages",
		"dietary_needs",
		"dietary_needs_other",
		"over_21",
		// Reference
		"ref_1_name",
		"ref_1_phone",
		"ref_1_email",
		"ref_1_relationship",
		"ref_1_years",
		// Reflection prompts
		"stress_situation",
		"stress_response",
		"spiritual_moment",
		"activity_program",
		"someone_admire",
		"since_camp",
		"wish_knew",
		"last_summer_learned",
		"favorite_camper_moment",
		"closest_friend",
		"tawonga_makes_think",
		"advice_would_give",
		"how_look_at_camp",
		// Live 2026 fields, routed per owner ruling (see #2271)
		"over_18",
		"work_dates_kitchen_supervisor",
		"jedi_returner",
		"jedi_new_staff",
	}

	// Verify we have all 44 expected columns (excluding staff, person_id, year, created, updated)
	// Note: Plan said 39, then 40; four more were routed 2026-08-14 (see #2271)
	if len(expectedFields) != 44 {
		t.Errorf("Expected 44 custom fields, got %d", len(expectedFields))
	}

	// Test each field has a valid CM field mapping back
	for _, field := range expectedFields {
		cmField := getAppCMFieldForColumn(field)
		if cmField == "" {
			t.Errorf("Column %q has no CampMinder field mapping", field)
		}

		// Verify round-trip
		backToColumn := MapAppFieldToColumn(cmField)
		if backToColumn != field {
			t.Errorf("Round-trip failed: column %q -> cmField %q -> column %q",
				field, cmField, backToColumn)
		}
	}
}

// Note: MapAppFieldToColumn wrapper calls implementation function MapStaffAppFieldToColumn
func MapAppFieldToColumn(cmField string) string {
	return MapStaffAppFieldToColumn(cmField)
}

// getAppCMFieldForColumn is the reverse mapping
func getAppCMFieldForColumn(column string) string {
	mapping := map[string]string{
		// Work availability
		"can_work_dates":        "App-Work Camp Dates?",
		"cant_work_explain":     "App-Can't Work Camp Dates Expl",
		"work_dates_supervisor": "App- Work Camp Dates Supervisor?",
		"work_dates_wild":       "App-Work Camp Dates WILD?",
		"work_dates_driver":     "App- Work Camp Dates Driver?",

		// Qualifications
		"work_expectations":     "App-Work Expectations",
		"qualifications":        "App-Qualifications",
		"qualification_changes": "App-Qualification changes",

		// Position preferences
		"position_pref_1": "Position Preference 1",
		"position_pref_2": "Position Preference 2",
		"position_pref_3": "Position Preference 3",

		// Essays
		"why_tawonga":                "App-Why Tawonga?",
		"why_work_again":             "App-Why work at camp again?",
		"jewish_community":           "App-Jewish Community",
		"three_rules":                "App-Three Rules...",
		"autobiography":              "App-Autobiography...",
		"community_means":            "App-Community Means...",
		"working_across_differences": "App- Working Across Differences",

		// Personal info
		"languages":           "App-languages",
		"dietary_needs":       "App-Dietary Needs",
		"dietary_needs_other": "App-Dietary Needs (Other)",
		"over_21":             "App-Over 21",

		// Reference
		"ref_1_name":         "App-Ref 1 Name",
		"ref_1_phone":        "App-Ref 1 Phone Number",
		"ref_1_email":        "App-Ref 1 Email",
		"ref_1_relationship": "App-Ref 1 Relationship",
		"ref_1_years":        "App-Ref 1 Yrs of Acquaintance",

		// Reflection prompts
		"stress_situation":       "App-I got stressed when",
		"stress_response":        "App-I responded to my stress",
		"spiritual_moment":       "App-I had a spiritual moment",
		"activity_program":       "App-An activity or program",
		"someone_admire":         "App-Someone whose work I",
		"since_camp":             "App-Since camp I've been",
		"wish_knew":              "App-I wish I had gotten toknow",
		"last_summer_learned":    "App-Last summer I learned",
		"favorite_camper_moment": "App-My favorite camper moment",
		"closest_friend":         "App-My closest friend at camp",
		"tawonga_makes_think":    "App-Tawonga makes me think of",
		"advice_would_give":      "App-what advice would you",
		"how_look_at_camp":       "App-How do you look at camp",

		// Live 2026 fields, routed per owner ruling (see #2271)
		"over_18":                       "App-over 18",
		"work_dates_kitchen_supervisor": "App-Work Camp Dates Kitchen Supervisor",
		"jedi_returner":                 "App-JEDIreturner",
		"jedi_new_staff":                "App-JEDInewstaff",
	}

	return mapping[column]
}

// Note: parseAppBool calls implementation function parseStaffAppBool
func parseAppBool(value string) bool {
	return parseStaffAppBool(value)
}

// Note: makeStaffApplicationsKey calls implementation function makeStaffAppKey
func makeStaffApplicationsKey(personID, year int) string {
	return makeStaffAppKey(personID, year)
}

// newStaffApplicationsTestApp builds the one collection deleteOrphans touches,
// plus the four columns added for the live 2026 App-* fields (see #2271) so
// that TestUpsertRecordsWritesTheFourLive2026Columns can read them back.
//
// Like newStaffVehicleTestApp, this fixture is LAXER than production -- it
// carries only the fields the tests below read, not all 44 routed columns --
// so a green test here is not evidence that production writes validate. It is
// evidence that upsertRecords writes THESE columns under THESE names, which is
// the part nothing else pins: record.Set on a name the collection does not
// carry is a silent no-op in PocketBase, so a dropped or misspelled setter
// leaves the whole package green.
func newStaffApplicationsTestApp(t *testing.T) core.App {
	t.Helper()
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)

	apps := core.NewBaseCollection("staff_applications")
	apps.Fields.Add(&core.TextField{Name: "staff"})
	apps.Fields.Add(&core.NumberField{Name: "person_id"})
	apps.Fields.Add(&core.NumberField{Name: "year"})
	// Live 2026 fields (see #2271). Types mirror
	// 1500000156_staff_applications_live_2026_fields.js.
	apps.Fields.Add(&core.BoolField{Name: "over_18"})
	apps.Fields.Add(&core.BoolField{Name: "work_dates_kitchen_supervisor"})
	apps.Fields.Add(&core.TextField{Name: "jedi_returner", Max: 5000})
	apps.Fields.Add(&core.TextField{Name: "jedi_new_staff", Max: 5000})
	if saveErr := app.Save(apps); saveErr != nil {
		t.Fatalf("save staff_applications: %v", saveErr)
	}

	return app
}

// seedStaffApplication writes one staff_applications row and returns its PB ID.
func seedStaffApplication(t *testing.T, app core.App, cmID, year int) string {
	t.Helper()

	col, err := app.FindCollectionByNameOrId("staff_applications")
	if err != nil {
		t.Fatalf("find staff_applications: %v", err)
	}
	rec := core.NewRecord(col)
	rec.Set("person_id", cmID)
	rec.Set("year", year)
	if saveErr := app.Save(rec); saveErr != nil {
		t.Fatalf("save staff_applications row: %v", saveErr)
	}
	return rec.Id
}

// TestStaffApplicationsDeleteOrphansRefusesEmptyComputedSet is kindred#2279
// Gap 2. staff_applications builds its computed set from the SAME
// loadPersonStaffMapping(ctx, year) gate as staff_vehicle_info, so it has the
// identical year-wipe path: an empty staff mapping makes every value fail the
// gate, the computed set comes back empty, and the unguarded sweep deletes the
// whole year and then sets SyncSuccessful = true.
func TestStaffApplicationsDeleteOrphansRefusesEmptyComputedSet(t *testing.T) {
	t.Parallel()
	app := newStaffApplicationsTestApp(t)
	recID := seedStaffApplication(t, app, 1001, 2026)

	s := NewStaffApplicationsSync(app)
	s.Year = 2026

	existing := map[string]string{makeStaffAppKey(1001, 2026): recID}
	deleted, err := s.deleteOrphans(context.Background(),
		map[string]*staffApplicationRecord{}, existing, 2026)

	if err == nil {
		t.Fatal("expected an error when the computed set is empty and rows exist, got nil")
	}
	if !strings.Contains(err.Error(), "2026") {
		t.Errorf("error %q does not name the year -- an operator has no way to tell which season refused", err.Error())
	}
	if deleted != 0 {
		t.Errorf("deleted = %d, want 0 -- nothing may be removed on the refusal path", deleted)
	}

	remaining, err := app.FindRecordsByFilter("staff_applications", "year = 2026", "", 0, 0)
	if err != nil {
		t.Fatalf("re-query: %v", err)
	}
	if len(remaining) != 1 {
		t.Errorf("%d rows survived, want 1 -- the guard must not delete", len(remaining))
	}
}

// unroutedAppFieldNames is the 44 App-* / Position Preference field names
// admitted by isStaffApplicationField that have no case in
// MapStaffAppFieldToColumn, byte-verified against the production snapshot at
// kindred#2271: 22 retired-2023 essay prompts, 9 prior-camp-employment-history
// fields (6 of which carried data through 2023, 3 of which -- the "Previous
// Camp 3" trio -- never held a value), 5 Reference #2 fields that never held a
// value (the form only ever collected one reference), 2 other retired-2023
// gates, 2 retired-2025 fields, and 4 never-populated leftovers.
//
// A former Category G held the four fields still receiving 2026 answers
// ("App-over 18", "App-JEDIreturner", "App-JEDInewstaff", "App-Work Camp
// Dates Kitchen Supervisor"). kindred#2271 originally decided against columns
// for them; the owner reversed that call for these four specifically (see
// #2271), so they are routed by MapStaffAppFieldToColumn now instead of
// appearing here.
var unroutedAppFieldNames = []string{
	// Category A: retired 2023 essay prompts (22)
	"App-85th Birthday...",
	"App-Admire...",
	"App-Angry When...",
	"App-Camp Goals",
	"App-Center By...",
	"App-Friends Say...",
	"App-Future Profession...",
	"App-Great At...",
	"App-Hours Alone...",
	"App-Kids Are...",
	"App-Life Lesson",
	"App-Memorable Travel...",
	"App-Nature Moment...",
	"App-Original Because...",
	"App-Respond to Anger...",
	"App-Rustic Living...",
	"App-Spiritual Highlight...",
	"App-Still Learning...",
	"App-Strengths",
	"App-When Alone...",
	"App-Work Ethic",
	"App-Worked Hardest At...",
	// Category B: prior-camp employment history (9)
	"App-Previous Camp 1",
	"App-Previous Camp 1 Type",
	"App-Previous Camp 1 Years",
	"App-Previous Camp 2",
	"App-Previous Camp 2 Type",
	"App-Previous Camp 2 Years",
	"App-Previous Camp 3",
	"App-Previous Camp 3 Type",
	"App-Previous Camp 3 Years",
	// Category C: Reference #2 block, never populated (5)
	"App-Ref 2 Email",
	"App-Ref 2 Name",
	"App-Ref 2 Phone Number",
	"App-Ref 2 Relationship",
	"App-Ref 2 Yrs of Acquaintance",
	// Category D: other retired-2023 gates (2)
	"App-COVID policies",
	"App-What additional responsibi",
	// Category E: retired-2025 fields (2)
	"App-Weakensses",
	"App-Wild Dates EXPLAIN",
	// Category F: never-populated leftovers (4)
	"App-Assess specific strengths",
	"App-Help Meet Goals",
	"App-Hobbies/Interests/Skills",
	"App-Relevant Courses",
}

// TestRetiredAppFieldReasonsCoversExactlyTheFortyFourUnroutedNames pins
// kindred#2271's inventory: 88 App-*/Position-Preference definitions
// admitted, 44 routed, 44 with no case in MapStaffAppFieldToColumn. Every one
// of those 44 must carry an explicit reason in retiredAppFieldReasons, and
// MapStaffAppFieldToColumn must agree that none of them route anywhere -- or
// the "known" bucket in classifyUnmappedAppFields would silently swallow a
// field that actually needs a routing case added.
func TestRetiredAppFieldReasonsCoversExactlyTheFortyFourUnroutedNames(t *testing.T) {
	t.Parallel()

	if len(retiredAppFieldReasons) != len(unroutedAppFieldNames) {
		t.Errorf("retiredAppFieldReasons has %d entries, want %d -- a name was added or dropped without updating this test",
			len(retiredAppFieldReasons), len(unroutedAppFieldNames))
	}

	for _, name := range unroutedAppFieldNames {
		reason, ok := retiredAppFieldReasons[name]
		if !ok {
			t.Errorf("retiredAppFieldReasons is missing %q", name)
			continue
		}
		if strings.TrimSpace(reason) == "" {
			t.Errorf("retiredAppFieldReasons[%q] has an empty reason", name)
		}
		if col := MapStaffAppFieldToColumn(name); col != "" {
			t.Errorf("%q is listed in retiredAppFieldReasons but MapStaffAppFieldToColumn routes it to %q -- "+
				"remove it from the retired list or the switch, not both", name, col)
		}
	}
}

// TestClassifyUnmappedAppFields pins the split classifyUnmappedAppFields makes
// between discards retiredAppFieldReasons already explains and any name that
// is not on that list -- the second bucket is the one that should worry an
// operator, because it means a new CampMinder App-* field showed up with no
// routing case and no documented reason to leave it that way.
func TestClassifyUnmappedAppFields(t *testing.T) {
	t.Parallel()
	counts := map[string]int{
		"App-Camp Goals":          3, // known -- retired 2023 essay prompt
		"App-Space Rocket Camper": 1, // not on any list
	}

	known, unexpected := classifyUnmappedAppFields(counts)

	if got := known["App-Camp Goals"]; got != 3 {
		t.Errorf("known[%q] = %d, want 3", "App-Camp Goals", got)
	}
	if _, leaked := unexpected["App-Camp Goals"]; leaked {
		t.Error("a known-unmapped field leaked into the unexpected bucket")
	}
	if got := unexpected["App-Space Rocket Camper"]; got != 1 {
		t.Errorf("unexpected[%q] = %d, want 1", "App-Space Rocket Camper", got)
	}
	if _, leaked := known["App-Space Rocket Camper"]; leaked {
		t.Error("a field with no retired-field reason must not land in the known bucket")
	}
}

// TestMapAppFieldToRecordReturnsColumnWritten pins the return-value contract
// kindred#2271 adds: mapAppFieldToRecord now reports which column (if any) it
// wrote to, so its caller -- the aggregation loop in loadPersonCustomValues,
// the only place with access to the receiver and therefore to Stats -- can
// count and log an unmapped field instead of discarding it in silence.
func TestMapAppFieldToRecordReturnsColumnWritten(t *testing.T) {
	t.Parallel()

	t.Run("mapped field returns its column and writes the value", func(t *testing.T) {
		// wantColumn is a var, not a second "why_tawonga" literal, so this
		// doesn't trip goconst (min-occurrences: 3) against the two switch
		// cases in MapStaffAppFieldToColumn/mapAppFieldToRecord that already
		// spell that column name.
		const wantColumn = "why_tawonga"
		rec := &staffApplicationRecord{}
		got := mapAppFieldToRecord(rec, "App-Why Tawonga?", "because it's home")
		if got != wantColumn {
			t.Errorf("mapAppFieldToRecord returned %q, want %q", got, wantColumn)
		}
		if rec.whyTawonga != "because it's home" {
			t.Errorf("value not written: whyTawonga = %q", rec.whyTawonga)
		}
	})

	t.Run("unmapped field returns empty string and writes nothing", func(t *testing.T) {
		rec := &staffApplicationRecord{}
		got := mapAppFieldToRecord(rec, "App-Camp Goals", "Yes")
		if got != "" {
			t.Errorf("mapAppFieldToRecord returned %q, want \"\"", got)
		}
	})
}

// TestMapAppFieldToRecordRoutesTheFourLive2026Fields pins the owner's
// 2026-08-14 reversal of kindred#2271's original "no columns" call for these
// four fields specifically (see #2271). App-over 18 and App-Work Camp Dates
// Kitchen Supervisor are boolean gates parsed the same way as the existing
// over_21 column; App-JEDIreturner and App-JEDInewstaff are free text, split
// returner/new-staff halves of the single retired "App- Working Across
// Differences" question rather than a new topic.
func TestMapAppFieldToRecordRoutesTheFourLive2026Fields(t *testing.T) {
	t.Parallel()

	// Named once and referenced by variable everywhere below, not repeated as
	// raw literals -- same reasoning as wantColumn in
	// TestMapAppFieldToRecordReturnsColumnWritten: this file and
	// staff_applications.go's switch/return/Set already spell each of these
	// column names three times each, so a second raw literal per name here
	// trips goconst (min-occurrences: 3).
	const (
		colOver18             = "over_18"
		colKitchenSupervisor  = "work_dates_kitchen_supervisor"
		colJediReturner       = "jedi_returner"
		colJediNewStaff       = "jedi_new_staff"
		fieldJediReturnerName = "App-JEDIreturner"
	)

	t.Run("over 18 Yes parses true", func(t *testing.T) {
		rec := &staffApplicationRecord{}
		if got := mapAppFieldToRecord(rec, "App-over 18", "Yes"); got != colOver18 {
			t.Errorf("mapAppFieldToRecord returned %q, want %q", got, colOver18)
		}
		if !rec.over18 {
			t.Error("over18 = false, want true for a Yes value")
		}
	})

	t.Run("over 18 No parses false", func(t *testing.T) {
		rec := &staffApplicationRecord{}
		if got := mapAppFieldToRecord(rec, "App-over 18", "No"); got != colOver18 {
			t.Errorf("mapAppFieldToRecord returned %q, want %q", got, colOver18)
		}
		if rec.over18 {
			t.Error("over18 = true, want false for a No value")
		}
	})

	t.Run("kitchen supervisor Yes parses true", func(t *testing.T) {
		rec := &staffApplicationRecord{}
		got := mapAppFieldToRecord(rec, "App-Work Camp Dates Kitchen Supervisor", "Yes")
		if got != colKitchenSupervisor {
			t.Errorf("mapAppFieldToRecord returned %q, want %q", got, colKitchenSupervisor)
		}
		if !rec.workDatesKitchenSupervisor {
			t.Error("workDatesKitchenSupervisor = false, want true for a Yes value")
		}
	})

	t.Run("kitchen supervisor No parses false", func(t *testing.T) {
		rec := &staffApplicationRecord{}
		got := mapAppFieldToRecord(rec, "App-Work Camp Dates Kitchen Supervisor", "No")
		if got != colKitchenSupervisor {
			t.Errorf("mapAppFieldToRecord returned %q, want %q", got, colKitchenSupervisor)
		}
		if rec.workDatesKitchenSupervisor {
			t.Error("workDatesKitchenSupervisor = true, want false for a No value")
		}
	})

	t.Run("JEDI returner free text is written verbatim", func(t *testing.T) {
		rec := &staffApplicationRecord{}
		got := mapAppFieldToRecord(rec, fieldJediReturnerName, "a returner's reflection")
		if got != colJediReturner {
			t.Errorf("mapAppFieldToRecord returned %q, want %q", got, colJediReturner)
		}
		if rec.jediReturner != "a returner's reflection" {
			t.Errorf("jediReturner = %q, want %q", rec.jediReturner, "a returner's reflection")
		}
	})

	t.Run("JEDI new-staff free text is written verbatim", func(t *testing.T) {
		rec := &staffApplicationRecord{}
		got := mapAppFieldToRecord(rec, "App-JEDInewstaff", "a new applicant's reflection")
		if got != colJediNewStaff {
			t.Errorf("mapAppFieldToRecord returned %q, want %q", got, colJediNewStaff)
		}
		if rec.jediNewStaff != "a new applicant's reflection" {
			t.Errorf("jediNewStaff = %q, want %q", rec.jediNewStaff, "a new applicant's reflection")
		}
	})

	t.Run("first-write-wins like every other text column", func(t *testing.T) {
		rec := &staffApplicationRecord{}
		mapAppFieldToRecord(rec, fieldJediReturnerName, "first")
		mapAppFieldToRecord(rec, fieldJediReturnerName, "second")
		if rec.jediReturner != "first" {
			t.Errorf("jediReturner = %q, want %q (first write should win)", rec.jediReturner, "first")
		}
	})
}

// TestLoadPersonCustomValuesCountsAndLogsUnmappedAppFields is the end-to-end
// pin for kindred#2271's actual fix: before this, an App-* field accepted by
// isStaffApplicationField but missing a case in MapStaffAppFieldToColumn was
// discarded with no counter and no log line. It now must increment
// Stats.SkippedValues once per discard (kindred#2356 split this off
// Stats.Skipped -- a discarded field value is not a skipped record) and log
// the field name, split into the known bucket (documented in
// retiredAppFieldReasons) and the unrecognized bucket (a name this run has
// never been told about).
//
// Reuses newTransportValuesTestApp/addPersonCustomValue from
// camper_transportation_test.go -- same package, same person_custom_values +
// persons fixture, and loadPersonCustomValues here takes fieldNameMap and
// personToStaff as plain maps rather than deriving them, so no staff
// collection is needed.
func TestLoadPersonCustomValuesCountsAndLogsUnmappedAppFields(t *testing.T) {
	app := newTransportValuesTestApp(t)

	personsCol, err := app.FindCollectionByNameOrId("persons")
	if err != nil {
		t.Fatalf("find persons: %v", err)
	}
	person := core.NewRecord(personsCol)
	person.Set("cm_id", 8001)
	if saveErr := app.Save(person); saveErr != nil {
		t.Fatalf("save person: %v", saveErr)
	}

	const year = 2023
	// One routed field (must still work), one known-unmapped field, and one
	// field this run has never seen before (simulates a hypothetical new
	// CampMinder App-* definition).
	addPersonCustomValue(t, app, "fd_routed", person.Id, "because it's home", year)
	addPersonCustomValue(t, app, "fd_retired", person.Id, "essay text", year)
	addPersonCustomValue(t, app, "fd_novel", person.Id, "unexpected value", year)

	fieldNameMap := map[string]string{
		"fd_routed":  "App-Why Tawonga?",
		"fd_retired": "App-Camp Goals",
		"fd_novel":   "App-Space Rocket Camper",
	}
	personToStaff := map[int]string{8001: "staffpbid1"}

	logs := captureSweepLogs(t)

	s := NewStaffApplicationsSync(app)
	records, err := s.loadPersonCustomValues(context.Background(), year, fieldNameMap, personToStaff)
	if err != nil {
		t.Fatalf("loadPersonCustomValues: %v", err)
	}

	key := makeStaffAppKey(8001, year)
	rec, ok := records[key]
	if !ok {
		t.Fatalf("no record for key %q; got %d records", key, len(records))
	}
	if rec.whyTawonga != "because it's home" {
		t.Errorf("routed field was not written: whyTawonga = %q, want %q", rec.whyTawonga, "because it's home")
	}

	// kindred#2356: discarded field VALUES must land on Stats.SkippedValues, not
	// Stats.Skipped -- the record itself was still created (see rec above), so
	// counting these two discard events against the record-level Skipped counter
	// would misrepresent them as skipped records to a toast reader.
	if s.Stats.SkippedValues != 2 {
		t.Errorf("Stats.SkippedValues = %d, want 2 -- one discard event each for the known-unmapped and the novel field",
			s.Stats.SkippedValues)
	}
	if s.Stats.Skipped != 0 {
		t.Errorf("Stats.Skipped = %d, want 0 -- a discarded field value is not a skipped record", s.Stats.Skipped)
	}

	logged := logs.String()
	if !strings.Contains(logged, "App-Camp Goals") {
		t.Errorf("known-unmapped field name missing from logs:\n%s", logged)
	}
	if !strings.Contains(logged, "App-Space Rocket Camper") {
		t.Errorf("unrecognized field name missing from logs:\n%s", logged)
	}
	if !strings.Contains(logged, "level=WARN") {
		t.Errorf("expected the discard to be logged at WARN level:\n%s", logged)
	}
	// The routed field must never appear as a discard.
	if strings.Contains(logged, "App-Why Tawonga?") {
		t.Errorf("a successfully routed field was logged as a discard:\n%s", logged)
	}
}

// TestLoadPersonCustomValuesNoDiscardsMeansNoWarnAppLog proves the fix does
// not spam every ordinary sync run: a year with nothing unmapped must not log
// at all and must leave Stats.Skipped at zero.
func TestLoadPersonCustomValuesNoDiscardsMeansNoWarnAppLog(t *testing.T) {
	app := newTransportValuesTestApp(t)

	personsCol, err := app.FindCollectionByNameOrId("persons")
	if err != nil {
		t.Fatalf("find persons: %v", err)
	}
	person := core.NewRecord(personsCol)
	person.Set("cm_id", 8002)
	if saveErr := app.Save(person); saveErr != nil {
		t.Fatalf("save person: %v", saveErr)
	}

	const year = 2026
	addPersonCustomValue(t, app, "fd_routed", person.Id, "because it's home", year)

	fieldNameMap := map[string]string{"fd_routed": "App-Why Tawonga?"}
	personToStaff := map[int]string{8002: "staffpbid2"}

	logs := captureSweepLogs(t)

	s := NewStaffApplicationsSync(app)
	if _, err := s.loadPersonCustomValues(context.Background(), year, fieldNameMap, personToStaff); err != nil {
		t.Fatalf("loadPersonCustomValues: %v", err)
	}

	if s.Stats.Skipped != 0 {
		t.Errorf("Stats.Skipped = %d, want 0", s.Stats.Skipped)
	}
	if s.Stats.SkippedValues != 0 {
		t.Errorf("Stats.SkippedValues = %d, want 0", s.Stats.SkippedValues)
	}
	if logged := logs.String(); logged != "" {
		t.Errorf("expected no log output when nothing was discarded, got:\n%s", logged)
	}
}

// TestLoadPersonCustomValuesRoutesTheFourLive2026FieldsAndDoesNotSkipThem is
// the end-to-end pin for the owner's reversal on #2271: before this change
// these four field names had no case in MapStaffAppFieldToColumn, so each one
// present in a year's person_custom_values counted as a Stats.Skipped
// discard event. Now all four must land on the record and Stats.Skipped must
// stay zero.
func TestLoadPersonCustomValuesRoutesTheFourLive2026FieldsAndDoesNotSkipThem(t *testing.T) {
	app := newTransportValuesTestApp(t)

	personsCol, err := app.FindCollectionByNameOrId("persons")
	if err != nil {
		t.Fatalf("find persons: %v", err)
	}
	person := core.NewRecord(personsCol)
	person.Set("cm_id", 8003)
	if saveErr := app.Save(person); saveErr != nil {
		t.Fatalf("save person: %v", saveErr)
	}

	const year = 2026
	addPersonCustomValue(t, app, "fd_over18", person.Id, "Yes", year)
	addPersonCustomValue(t, app, "fd_kitchen", person.Id, "No", year)
	addPersonCustomValue(t, app, "fd_jedi_returner", person.Id, "a returner reflection", year)
	addPersonCustomValue(t, app, "fd_jedi_new", person.Id, "a new-staff reflection", year)

	fieldNameMap := map[string]string{
		"fd_over18":        "App-over 18",
		"fd_kitchen":       "App-Work Camp Dates Kitchen Supervisor",
		"fd_jedi_returner": "App-JEDIreturner",
		"fd_jedi_new":      "App-JEDInewstaff",
	}
	personToStaff := map[int]string{8003: "staffpbid3"}

	logs := captureSweepLogs(t)

	s := NewStaffApplicationsSync(app)
	records, err := s.loadPersonCustomValues(context.Background(), year, fieldNameMap, personToStaff)
	if err != nil {
		t.Fatalf("loadPersonCustomValues: %v", err)
	}

	key := makeStaffAppKey(8003, year)
	rec, ok := records[key]
	if !ok {
		t.Fatalf("no record for key %q; got %d records", key, len(records))
	}
	if !rec.over18 {
		t.Error("over18 = false, want true")
	}
	if rec.workDatesKitchenSupervisor {
		t.Error("workDatesKitchenSupervisor = true, want false")
	}
	if rec.jediReturner != "a returner reflection" {
		t.Errorf("jediReturner = %q, want %q", rec.jediReturner, "a returner reflection")
	}
	if rec.jediNewStaff != "a new-staff reflection" {
		t.Errorf("jediNewStaff = %q, want %q", rec.jediNewStaff, "a new-staff reflection")
	}

	if s.Stats.Skipped != 0 {
		t.Errorf("Stats.Skipped = %d, want 0 -- these four fields must no longer be discarded", s.Stats.Skipped)
	}
	if logged := logs.String(); logged != "" {
		t.Errorf("expected no discard log for fields that now route to columns, got:\n%s", logged)
	}
}

// TestUpsertRecordsWritesTheFourLive2026Columns closes the last gap in the
// #2271 routing chain. Extraction is pinned above (MapStaffAppFieldToColumn ->
// mapAppFieldToRecord -> loadPersonCustomValues), but the value only becomes
// data when upsertRecords writes it, and PocketBase's record.Set is a silent
// no-op for a name the collection does not carry. So a dropped setter, or one
// whose column name does not match the migration's, produces four columns that
// are added, populated in memory and never persisted -- with every other test
// in this package still green. Measured: deleting all four record.Set lines
// left `go test ./sync/` passing before this test existed.
//
// The reciprocal risk this canNOT cover is a Go/migration name disagreement:
// the fixture declares these column names by hand rather than replaying
// pb_migrations. CI's Migration Smoke Test + PocketBase types freshness step
// is what ties the migration's names to the checked-in
// frontend/src/types/pocketbase-types.ts.
func TestUpsertRecordsWritesTheFourLive2026Columns(t *testing.T) {
	t.Parallel()

	const (
		colOver18            = "over_18"
		colKitchenSupervisor = "work_dates_kitchen_supervisor"
		colJediReturner      = "jedi_returner"
		colJediNewStaff      = "jedi_new_staff"

		wantReturner = "a returner reflection"
		wantNewStaff = "a new-staff reflection"
	)

	app := newStaffApplicationsTestApp(t)
	s := NewStaffApplicationsSync(app)

	const (
		personID = 9101
		year     = 2026
	)
	records := map[string]*staffApplicationRecord{
		makeStaffAppKey(personID, year): {
			personID: personID,
			year:     year,
			// over18 true / workDatesKitchenSupervisor false is deliberate: a
			// setter that never runs leaves a bool column false, so only the
			// true one proves the write happened. The false one proves the
			// column is real rather than swallowed as unknown custom data.
			over18:                     true,
			workDatesKitchenSupervisor: false,
			jediReturner:               wantReturner,
			jediNewStaff:               wantNewStaff,
		},
	}

	created, updated, errCount := s.upsertRecords(
		context.Background(), records, map[string]string{}, year)
	if errCount != 0 {
		t.Fatalf("upsertRecords reported %d errors, want 0", errCount)
	}
	if created != 1 || updated != 0 {
		t.Fatalf("created=%d updated=%d, want created=1 updated=0", created, updated)
	}

	saved, err := app.FindRecordsByFilter("staff_applications", "year = 2026", "", 0, 0)
	if err != nil {
		t.Fatalf("re-query: %v", err)
	}
	if len(saved) != 1 {
		t.Fatalf("%d rows persisted, want 1", len(saved))
	}
	rec := saved[0]

	if !rec.GetBool(colOver18) {
		t.Errorf("%s = false on the persisted row, want true", colOver18)
	}
	if rec.GetBool(colKitchenSupervisor) {
		t.Errorf("%s = true on the persisted row, want false", colKitchenSupervisor)
	}
	if got := rec.GetString(colJediReturner); got != wantReturner {
		t.Errorf("%s = %q, want %q", colJediReturner, got, wantReturner)
	}
	if got := rec.GetString(colJediNewStaff); got != wantNewStaff {
		t.Errorf("%s = %q, want %q", colJediNewStaff, got, wantNewStaff)
	}
}

// TestStaffApplicationsDeleteOrphansStillSweepsGenuineOrphans proves the guard
// did not disable orphan deletion for the normal case.
func TestStaffApplicationsDeleteOrphansStillSweepsGenuineOrphans(t *testing.T) {
	t.Parallel()
	app := newStaffApplicationsTestApp(t)
	keepID := seedStaffApplication(t, app, 1001, 2026)
	orphanID := seedStaffApplication(t, app, 1002, 2026)

	s := NewStaffApplicationsSync(app)
	s.Year = 2026

	// 1001 is still computed; 1002 is not, and must be swept.
	computed := map[string]*staffApplicationRecord{
		makeStaffAppKey(1001, 2026): {personID: 1001, year: 2026},
	}
	existing := map[string]string{
		makeStaffAppKey(1001, 2026): keepID,
		makeStaffAppKey(1002, 2026): orphanID,
	}

	deleted, err := s.deleteOrphans(context.Background(), computed, existing, 2026)
	if err != nil {
		t.Fatalf("unexpected error on a non-empty computed set: %v", err)
	}
	if deleted != 1 {
		t.Errorf("deleted = %d, want 1 -- the guard must not block a genuine sweep", deleted)
	}

	remaining, err := app.FindRecordsByFilter("staff_applications", "year = 2026", "", 0, 0)
	if err != nil {
		t.Fatalf("re-query: %v", err)
	}
	if len(remaining) != 1 {
		t.Errorf("%d rows survived, want 1", len(remaining))
	}
}
