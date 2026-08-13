package sync

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	pbtests "github.com/pocketbase/pocketbase/tests"
)

// TestStaffVehicleInfoLoadFieldDefinitionsTrimsNames is a regression test for
// kindred#1873. isStaffVehicleInfoField admits by "SVI-"/"SVI " prefix, which
// a trailing space would not defeat, but MapSVIFieldToColumnImpl exact-matches
// the trimmed literal downstream -- so an untrimmed name would be admitted
// into the map and then silently fail to route. No untrimmed name exists in
// this table today; this pins the fix against a future one.
func TestStaffVehicleInfoLoadFieldDefinitionsTrimsNames(t *testing.T) {
	app := newFieldDefsTestApp(t, map[int]string{
		1: "SVI-are you driving to camp ", // trailing space
		2: "SVI-which friend",             // already clean, must be unaffected
	})

	s := NewStaffVehicleInfoSync(app)
	got, err := s.loadFieldDefinitions(context.Background())
	if err != nil {
		t.Fatalf("loadFieldDefinitions: %v", err)
	}

	want := map[string]bool{
		"SVI-are you driving to camp": true,
		"SVI-which friend":            true,
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

	if col := MapSVIFieldToColumnImpl("SVI-are you driving to camp"); col != colDrivingToCamp {
		t.Errorf("MapSVIFieldToColumnImpl(%q) = %q, want %q", "SVI-are you driving to camp", col, colDrivingToCamp)
	}
}

// TestStaffVehicleInfoServiceName verifies the service name constant
func TestStaffVehicleInfoServiceName(t *testing.T) {
	expected := "staff_vehicle_info"
	if serviceNameStaffVehicleInfo != expected {
		t.Errorf("serviceNameStaffVehicleInfo = %q, want %q", serviceNameStaffVehicleInfo, expected)
	}
}

// TestMapSVIFieldToColumn tests the CampMinder field name to column mapping
// for the 10 SVI- fields used in staff vehicle info, plus the two literals that
// must NOT route: the American plate spelling and an unknown field.
func TestMapSVIFieldToColumn(t *testing.T) {
	tests := []struct {
		cmField  string
		expected string
	}{
		// Driving to camp
		{"SVI-are you driving to camp", "driving_to_camp"},
		{"SVI-how are you get to camp", "how_getting_to_camp"},

		// Bringing others
		{"SVI - bring others", "can_bring_others"},
		{"SVI- Who is driving you to camp", "driver_name"},
		{"SVI-which friend", "which_friend"},

		// Vehicle info
		{"SVI-make of vehicle", "vehicle_make"},
		{"SVI-model vehicle", "vehicle_model"},
		// British spelling -- this is how CampMinder publishes it (kindred#2258).
		{"SVI-licence plate number", "license_plate"},

		// Transport detail that previously had no destination (kindred#2268)
		{"SVI- Where do you need a ride from", "ride_from"},
		{"SVI - other", "transport_notes"},

		// The American spelling is NOT a CampMinder field and must not route.
		{"SVI-license plate number", ""},

		// Unknown field should return empty
		{"Unknown-Field", ""},
		{"SVI-Unknown", ""},
	}

	for _, tt := range tests {
		t.Run(tt.cmField, func(t *testing.T) {
			got := MapSVIFieldToColumnImpl(tt.cmField)
			if got != tt.expected {
				t.Errorf("MapSVIFieldToColumnImpl(%q) = %q, want %q", tt.cmField, got, tt.expected)
			}
		})
	}
}

// TestParseSVIBoolImpl is the first real test of this parser. The function it
// replaces tested a shadow copy declared in this file, so production went
// unexercised.
//
// After the can_bring_others change, parseSVIBoolImpl has exactly ONE caller:
// driving_to_camp, fed by "SVI-are you driving to camp". That field holds 1,780
// answers with exactly two distinct values -- "Yes" and "No" -- so the tolerant
// arms below ("1", "y", "true") match nothing in the live data. They are pinned
// deliberately: this parser reads a CampMinder field, and a form that starts
// emitting 1/0 must not silently read as all-false. Narrowing this set is a
// behavior change, not a cleanup.
func TestParseSVIBoolImpl(t *testing.T) {
	cases := map[string]bool{
		// The only two values the live field actually contains.
		"Yes": true,
		"No":  false,
		// Case and whitespace tolerance.
		"yes":   true,
		"YES":   true,
		"  yes": true,
		"no":    false,
		// Tolerant arms, pinned so they cannot be dropped silently.
		"1":    true,
		"y":    true,
		"true": true,
		// Everything else is false, including the unanswered case.
		"":      false,
		"Maybe": false,
		"0":     false,
	}

	for in, want := range cases {
		t.Run(in, func(t *testing.T) {
			if got := parseSVIBoolImpl(in); got != want {
				t.Errorf("parseSVIBoolImpl(%q) = %v, want %v", in, got, want)
			}
		})
	}
}

// TestStaffVehicleInfoCompositeKey tests the unique key generation
// Key format: personID|year
func TestStaffVehicleInfoCompositeKey(t *testing.T) {
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
			got := makeStaffVehicleKey(tt.personID, tt.year)
			if got != tt.expected {
				t.Errorf("makeStaffVehicleKey(%d, %d) = %q, want %q",
					tt.personID, tt.year, got, tt.expected)
			}
		})
	}
}

// TestMapSVIFieldToRecordKeepsBringOthersVerbatim pins kindred#2262. The
// CampMinder field behind can_bring_others is an open-ended String question --
// 1,044 answers, 629 distinct, longest 328 characters -- and routing it
// through parseSVIBoolImpl stored `false` for 1,022 people who answered.
// Prefix rules do not rescue it: 34% of real answers begin with neither "yes"
// nor "no", so the sentence itself is the only honest storage.
func TestMapSVIFieldToRecordKeepsBringOthersVerbatim(t *testing.T) {
	cases := []struct {
		name  string
		value string
	}{
		{"affirmative prose", "Yes, I can take 2 people from Oakland if they pack light"},
		{"bare no", "No"},
		{"seat count", "3"},
		{"conditional", "Maybe -- depends on luggage"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := &staffVehicleInfoRecord{}
			mapSVIFieldToRecord(rec, "SVI - bring others", tc.value)
			if rec.canBringOthers != tc.value {
				t.Errorf("canBringOthers = %q, want the raw answer %q", rec.canBringOthers, tc.value)
			}
		})
	}
}

// TestMapSVIFieldToRecordLeavesDrivingToCampABool is the guardrail. The same
// parser serves driving_to_camp, whose source really is a two-valued enum
// (1,780 answers, exactly 2 distinct values, 793 rows true). Nothing in
// kindred#2262 may change it.
func TestMapSVIFieldToRecordLeavesDrivingToCampABool(t *testing.T) {
	for value, want := range map[string]bool{"Yes": true, "No": false, "yes": true} {
		rec := &staffVehicleInfoRecord{}
		mapSVIFieldToRecord(rec, "SVI-are you driving to camp", value)
		if rec.drivingToCamp != want {
			t.Errorf("drivingToCamp for %q = %v, want %v", value, rec.drivingToCamp, want)
		}
	}
}

// newStaffVehicleTestApp builds the five collections this service reads and
// writes. Fields are the minimum the code under test touches, not a mirror of
// production -- see kindred#1921 for why that distinction matters.
//
// THIS FIXTURE IS LAXER THAN PRODUCTION, DELIBERATELY. `staff` is a plain
// text field here, but production declares it
// `{type: "relation", required: true, cascadeDelete: true}` against col_staff
// (pb_migrations/1500000047_staff_vehicle_info.js:26-34). So a row with no
// staff value SAVES here and would be REJECTED there.
//
// That trade is accepted because these tests exercise drop-COUNTING logic, not
// save validation. It has one consequence a future reader must not miss:
// a green test in this file is NOT evidence that production writes succeed.
// Real write validation comes from running the sync against the actual schema.
func newStaffVehicleTestApp(t *testing.T) core.App {
	t.Helper()
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)

	defs := core.NewBaseCollection("custom_field_defs")
	defs.Fields.Add(&core.NumberField{Name: "cm_id"})
	defs.Fields.Add(&core.TextField{Name: "name"})
	if err := app.Save(defs); err != nil {
		t.Fatalf("save custom_field_defs: %v", err)
	}

	persons := core.NewBaseCollection("persons")
	persons.Fields.Add(&core.NumberField{Name: "cm_id"})
	persons.Fields.Add(&core.NumberField{Name: "year"})
	if err := app.Save(persons); err != nil {
		t.Fatalf("save persons: %v", err)
	}

	staff := core.NewBaseCollection("staff")
	staff.Fields.Add(&core.NumberField{Name: "person_id"})
	staff.Fields.Add(&core.NumberField{Name: "year"})
	if err := app.Save(staff); err != nil {
		t.Fatalf("save staff: %v", err)
	}

	pcv := core.NewBaseCollection("person_custom_values")
	pcv.Fields.Add(&core.TextField{Name: "person"})
	pcv.Fields.Add(&core.TextField{Name: "field_definition"})
	pcv.Fields.Add(&core.TextField{Name: "value", Max: 5000})
	pcv.Fields.Add(&core.NumberField{Name: "year"})
	if err := app.Save(pcv); err != nil {
		t.Fatalf("save person_custom_values: %v", err)
	}

	svi := core.NewBaseCollection("staff_vehicle_info")
	svi.Fields.Add(&core.TextField{Name: "staff"})
	svi.Fields.Add(&core.NumberField{Name: "person_id"})
	svi.Fields.Add(&core.NumberField{Name: "year"})
	svi.Fields.Add(&core.BoolField{Name: "driving_to_camp"})
	svi.Fields.Add(&core.TextField{Name: "how_getting_to_camp", Max: 500})
	svi.Fields.Add(&core.TextField{Name: "can_bring_others", Max: 1000})
	svi.Fields.Add(&core.TextField{Name: "driver_name", Max: 200})
	svi.Fields.Add(&core.TextField{Name: "which_friend", Max: 200})
	svi.Fields.Add(&core.TextField{Name: "vehicle_make", Max: 100})
	svi.Fields.Add(&core.TextField{Name: "vehicle_model", Max: 100})
	svi.Fields.Add(&core.TextField{Name: "license_plate", Max: 100})
	svi.Fields.Add(&core.TextField{Name: "ride_from", Max: 1000})
	svi.Fields.Add(&core.TextField{Name: "transport_notes", Max: 1000})
	if err := app.Save(svi); err != nil {
		t.Fatalf("save staff_vehicle_info: %v", err)
	}

	return app
}

// seedSVI writes one person, optionally a staff row for the same year, and one
// custom value per field name given.
func seedSVI(t *testing.T, app core.App, cmID, year int, hasStaff bool, values map[string]string) {
	t.Helper()

	personCol, err := app.FindCollectionByNameOrId("persons")
	if err != nil {
		t.Fatalf("find persons: %v", err)
	}
	person := core.NewRecord(personCol)
	person.Set("cm_id", cmID)
	person.Set("year", year)
	if saveErr := app.Save(person); saveErr != nil {
		t.Fatalf("save person %d: %v", cmID, saveErr)
	}

	if hasStaff {
		staffCol, staffErr := app.FindCollectionByNameOrId("staff")
		if staffErr != nil {
			t.Fatalf("find staff: %v", staffErr)
		}
		s := core.NewRecord(staffCol)
		s.Set("person_id", cmID)
		s.Set("year", year)
		if saveErr := app.Save(s); saveErr != nil {
			t.Fatalf("save staff %d: %v", cmID, saveErr)
		}
	}

	defsCol, err := app.FindCollectionByNameOrId("custom_field_defs")
	if err != nil {
		t.Fatalf("find custom_field_defs: %v", err)
	}
	pcvCol, err := app.FindCollectionByNameOrId("person_custom_values")
	if err != nil {
		t.Fatalf("find person_custom_values: %v", err)
	}
	for name, value := range values {
		// Listed rather than filtered: this mirrors loadFieldDefinitions' own
		// FindRecordsByFilter(col, "", "", 0, 0) call and needs no dbx import.
		// A test fixture holds a dozen defs at most.
		existing, err := app.FindRecordsByFilter("custom_field_defs", "", "", 0, 0)
		if err != nil {
			t.Fatalf("list field defs: %v", err)
		}
		var def *core.Record
		for _, d := range existing {
			if d.GetString("name") == name {
				def = d
				break
			}
		}
		if def == nil {
			def = core.NewRecord(defsCol)
			def.Set("name", name)
			if err := app.Save(def); err != nil {
				t.Fatalf("save field def %q: %v", name, err)
			}
		}
		v := core.NewRecord(pcvCol)
		v.Set("person", person.Id)
		v.Set("field_definition", def.Id)
		v.Set("value", value)
		v.Set("year", year)
		if err := app.Save(v); err != nil {
			t.Fatalf("save custom value %q: %v", name, err)
		}
	}
}

// TestLoadPersonCustomValuesCountsStaffGateDrops pins kindred#2273. A person
// who answered the SVI form but has no staff row for that year has every value
// discarded by a bare `continue`. The gate itself is correct -- `staff` is a
// required relation, so the row cannot be written -- but a partial extraction
// and a complete one currently produce identical output.
func TestLoadPersonCustomValuesCountsStaffGateDrops(t *testing.T) {
	app := newStaffVehicleTestApp(t)
	seedSVI(t, app, 1001, 2026, true, map[string]string{
		"SVI-are you driving to camp": "Yes",
		"SVI-make of vehicle":         "Toyota",
	})
	seedSVI(t, app, 1002, 2026, false, map[string]string{
		"SVI-are you driving to camp": "Yes",
	})

	s := NewStaffVehicleInfoSync(app)
	s.Year = 2026

	fieldNames, err := s.loadFieldDefinitions(context.Background())
	if err != nil {
		t.Fatalf("loadFieldDefinitions: %v", err)
	}
	personToStaff, err := s.loadPersonStaffMapping(context.Background(), 2026)
	if err != nil {
		t.Fatalf("loadPersonStaffMapping: %v", err)
	}
	records, err := s.loadPersonCustomValues(context.Background(), 2026, fieldNames, personToStaff)
	if err != nil {
		t.Fatalf("loadPersonCustomValues: %v", err)
	}

	if len(records) != 1 {
		t.Errorf("got %d records, want 1 -- the person with no staff row must be excluded", len(records))
	}
	if _, ok := records[makeStaffVehicleKey(1002, 2026)]; ok {
		t.Error("person 1002 has no staff row for 2026 and must not produce a record")
	}
	if s.Stats.Skipped != 1 {
		t.Errorf("Stats.Skipped = %d, want 1 -- the gate drop must be counted", s.Stats.Skipped)
	}
}

// TestLoadPersonCustomValuesCountsUnmappedFields pins the second silent drop
// site. A field admitted by the SVI- prefix but routed to no column is
// discarded with no counter and no log line.
func TestLoadPersonCustomValuesCountsUnmappedFields(t *testing.T) {
	app := newStaffVehicleTestApp(t)
	seedSVI(t, app, 1001, 2026, true, map[string]string{
		"SVI-are you driving to camp": "Yes",
		"SVI-Unit Head Training":      "Session A", // admitted by prefix, routes nowhere
	})

	s := NewStaffVehicleInfoSync(app)
	s.Year = 2026

	fieldNames, err := s.loadFieldDefinitions(context.Background())
	if err != nil {
		t.Fatalf("loadFieldDefinitions: %v", err)
	}
	personToStaff, err := s.loadPersonStaffMapping(context.Background(), 2026)
	if err != nil {
		t.Fatalf("loadPersonStaffMapping: %v", err)
	}
	if _, err := s.loadPersonCustomValues(context.Background(), 2026, fieldNames, personToStaff); err != nil {
		t.Fatalf("loadPersonCustomValues: %v", err)
	}

	if s.Stats.Skipped != 1 {
		t.Errorf("Stats.Skipped = %d, want 1 -- the unmapped field must be counted", s.Stats.Skipped)
	}
}

// TestDeleteOrphansRefusesEmptyComputedSet pins the destructive path in
// kindred#2273. An empty computed record set against a populated year is
// always a broken input, never a legitimate "everything was removed" -- and
// the current code deletes the year and reports success.
func TestDeleteOrphansRefusesEmptyComputedSet(t *testing.T) {
	app := newStaffVehicleTestApp(t)
	col, err := app.FindCollectionByNameOrId("staff_vehicle_info")
	if err != nil {
		t.Fatalf("find staff_vehicle_info: %v", err)
	}
	rec := core.NewRecord(col)
	rec.Set("person_id", 1001)
	rec.Set("year", 2026)
	if saveErr := app.Save(rec); saveErr != nil {
		t.Fatalf("save existing row: %v", saveErr)
	}

	s := NewStaffVehicleInfoSync(app)
	s.Year = 2026

	existing := map[string]string{makeStaffVehicleKey(1001, 2026): rec.Id}
	deleted, err := s.deleteOrphans(context.Background(),
		map[string]*staffVehicleInfoRecord{}, existing, 2026)

	if err == nil {
		t.Fatal("expected an error when the computed set is empty and rows exist, got nil")
	}
	if !strings.Contains(err.Error(), "2026") {
		t.Errorf("error %q does not name the year -- an operator has no way to tell which season refused", err.Error())
	}
	// An empty computed set has more than one cause. An upstream rename of the
	// whole SVI-* namespace empties fieldNameMap, which empties the computed set
	// with the staff table perfectly healthy -- that is the kindred#2258 failure
	// class Layer 1 exists to catch. Naming only the staff table sends an
	// operator to the wrong place.
	if !strings.Contains(err.Error(), "routing") {
		t.Errorf("error %q points only at the staff table -- it must also point at the "+
			"SVI field routing report, which is where an upstream field rename shows up", err.Error())
	}
	if deleted != 0 {
		t.Errorf("deleted = %d, want 0 -- nothing may be removed on the refusal path", deleted)
	}

	remaining, err := app.FindRecordsByFilter("staff_vehicle_info", "year = 2026", "", 0, 0)
	if err != nil {
		t.Fatalf("re-query: %v", err)
	}
	if len(remaining) != 1 {
		t.Errorf("%d rows survived, want 1 -- the guard must not delete", len(remaining))
	}
}

// TestDeleteOrphansStillSweepsGenuineOrphans proves the guard did not disable
// orphan deletion for the normal case.
func TestDeleteOrphansStillSweepsGenuineOrphans(t *testing.T) {
	app := newStaffVehicleTestApp(t)
	col, err := app.FindCollectionByNameOrId("staff_vehicle_info")
	if err != nil {
		t.Fatalf("find staff_vehicle_info: %v", err)
	}
	orphan := core.NewRecord(col)
	orphan.Set("person_id", 1002)
	orphan.Set("year", 2026)
	if saveErr := app.Save(orphan); saveErr != nil {
		t.Fatalf("save orphan: %v", saveErr)
	}

	s := NewStaffVehicleInfoSync(app)
	s.Year = 2026

	records := map[string]*staffVehicleInfoRecord{
		makeStaffVehicleKey(1001, 2026): {personID: 1001, year: 2026},
	}
	existing := map[string]string{makeStaffVehicleKey(1002, 2026): orphan.Id}

	deleted, err := s.deleteOrphans(context.Background(), records, existing, 2026)
	if err != nil {
		t.Fatalf("deleteOrphans: %v", err)
	}
	if deleted != 1 {
		t.Errorf("deleted = %d, want 1", deleted)
	}
}

// TestSVIRoutingReportAgainstRealFieldNames is the guard that would have
// caught kindred#2258 on the day it was written. Every target column must be
// reachable from at least one field name CampMinder actually publishes.
//
// Per COLUMN, not per literal: an extra defensive spelling is allowed to match
// nothing, but a column that matches nothing is a dead switch arm.
//
// One-way only. The reverse -- every SVI definition must have a column --
// fails by design: "SVI- who are you driving to camp" and
// "SVI-Unit Head Training" are deliberately unrouted and carry no rows.
func TestSVIRoutingReportAgainstRealFieldNames(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("testdata", "svi_field_names.txt"))
	if err != nil {
		t.Fatalf("read testdata: %v", err)
	}
	var names []string
	for _, line := range strings.Split(string(raw), "\n") {
		if line = strings.TrimRight(line, "\r"); line != "" {
			names = append(names, line)
		}
	}
	if len(names) != 12 {
		t.Fatalf("expected 12 SVI field names in testdata, got %d", len(names))
	}

	unrouted, unmapped := sviRoutingReport(names)

	if len(unrouted) != 0 {
		t.Errorf("columns reachable from no CampMinder field: %v -- "+
			"a literal in MapSVIFieldToColumnImpl does not match any published name", unrouted)
	}

	wantUnmapped := []string{"SVI- who are you driving to camp", "SVI-Unit Head Training"}
	if !slices.Equal(unmapped, wantUnmapped) {
		t.Errorf("unmapped fields = %v, want %v", unmapped, wantUnmapped)
	}
}
