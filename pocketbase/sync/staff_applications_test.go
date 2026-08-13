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
	}

	// Verify we have all 40 expected columns (excluding staff, person_id, year, created, updated)
	// Note: Plan said 39, but actual count from CampMinder fields is 40
	if len(expectedFields) != 40 {
		t.Errorf("Expected 40 custom fields, got %d", len(expectedFields))
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

// newStaffApplicationsTestApp builds the one collection deleteOrphans touches.
// Like newStaffVehicleTestApp, this fixture is LAXER than production -- it
// carries only the fields the guard reads -- so a green test here is not
// evidence that production writes validate.
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
