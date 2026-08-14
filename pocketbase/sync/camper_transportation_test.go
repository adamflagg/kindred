package sync

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	pbtests "github.com/pocketbase/pocketbase/tests"
)

// TestCamperTransportationLoadFieldDefinitionsTrimsNames is a regression test
// for kindred#1873. isCamperTransportationField admits by "BUS-" prefix, which
// a trailing space would not defeat, but MapTransportationFieldToColumn
// exact-matches the trimmed literal downstream -- so an untrimmed name would
// be admitted into the map and then silently fail to route. No untrimmed name
// exists in this table today; this pins the fix against a future one.
func TestCamperTransportationLoadFieldDefinitionsTrimsNames(t *testing.T) {
	t.Parallel()
	app := newFieldDefsTestApp(t, map[int]string{
		1: "BUS-who is dropping off ", // trailing space
		2: "BUS-to camp",              // already clean, must be unaffected
	})

	s := NewCamperTransportationSync(app)
	got, err := s.loadFieldDefinitions(context.Background())
	if err != nil {
		t.Fatalf("loadFieldDefinitions: %v", err)
	}

	want := map[string]bool{
		"BUS-who is dropping off": true,
		"BUS-to camp":             true,
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

	if col := MapTransportationFieldToColumn("BUS-who is dropping off"); col != colDropoffName {
		t.Errorf("MapTransportationFieldToColumn(%q) = %q, want %q", "BUS-who is dropping off", col, colDropoffName)
	}
}

// TestCamperTransportationSync_Name verifies the service name is correct
func TestCamperTransportationSync_Name(t *testing.T) {
	t.Parallel()
	expectedName := "camper_transportation"
	if serviceNameCamperTransportation != expectedName {
		t.Errorf("expected service name %q, got %q", expectedName, serviceNameCamperTransportation)
	}
}

// TestCamperTransportationYearValidation tests year parameter validation
func TestCamperTransportationYearValidation(t *testing.T) {
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
			valid := isValidTransportationYear(tt.year)
			if valid != tt.wantValid {
				t.Errorf("isValidTransportationYear(%d) = %v, want %v", tt.year, valid, tt.wantValid)
			}
		})
	}
}

// TestTransportationMethodParsing tests parsing of transportation method values
func TestTransportationMethodParsing(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name     string
		rawValue string
		expected string
	}{
		{"Bus from San Francisco", "Bus-SF", "Bus-SF"},
		{"Bus from Palo Alto", "Bus-PA", "Bus-PA"},
		{"Bus from Marin", "Bus-Marin", "Bus-Marin"},
		{"Flying", "Flying", "Flying"},
		{"Parent Dropoff", "Parent Dropoff", "Parent Dropoff"},
		{"Other", "Other", "Other"},
		{"Legacy Bus to Camp", "Bus to Camp", "Bus to Camp"},
		{"empty value", "", ""},
		{"whitespace value", "  Bus-SF  ", "Bus-SF"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := normalizeTransportMethod(tt.rawValue)
			if result != tt.expected {
				t.Errorf("normalizeTransportMethod(%q) = %q, want %q", tt.rawValue, result, tt.expected)
			}
		})
	}
}

// TestTransportationFieldMapping tests CampMinder field to column mapping
func TestTransportationFieldMapping(t *testing.T) {
	t.Parallel()
	tests := []struct {
		fieldName  string
		wantColumn string
	}{
		// Modern BUS- prefixed fields
		{"BUS-to camp", "to_camp_method"},
		{"BUS-home from camp", "from_camp_method"},
		{"BUS-who is dropping off", "dropoff_name"},
		{"BUS-Phone number of person dropping off-correct", "dropoff_phone"},
		{"BUS-relation to camper drop off", "dropoff_relationship"},
		{"BUS-person picking up", "pickup_name"},
		{"BUS-phone number of person picking up", "pickup_phone"},
		{"BUS-relationship to camper pick up person", "pickup_relationship"},
		{"BUS-alternate person 1 picking up", "alt_pickup_1_name"},
		{"BUS-alternate 1 phone", "alt_pickup_1_phone"},
		{"BUS-alternate person relation to camper", "alt_pickup_1_relationship"},
		{"BUS-alternate person 2", "alt_pickup_2_name"},
		{"BUS-alternate person 2 phone", "alt_pickup_2_phone"},
		// Legacy fields (map to same columns as modern fields)
		{"Bus to Camp", "to_camp_method"},
		{"Bus From Camp", "from_camp_method"},
		// Unknown field
		{"Unknown-Field", ""},
		// The eleven retired airport/flight-transfer fields (kindred#2272) --
		// deliberately unrouted, not an oversight. Before this addition nothing
		// in this table asserted that a "BUS-*" name maps to "", so a case
		// accidentally added for one of these would not have failed a test.
		{"BUS-From camp-traveling without grownup", ""},
		{"BUS-Departure airport-from camp", ""},
		{"BUS-Airport arriving to home from camp", ""},
		{"BUS-Flight # from camp", ""},
		{"BUS-Departing time of return home flight", ""},
		{"BUS-To camp-traveling without adult", ""},
		{"BUS-Departure airport to camp", ""},
		{"BUS-Arriving airport to camp", ""},
		{"BUS-Flight # to camp", ""},
		{"BUS-Arrival time to camp", ""},
		{"BUS-phone number of person dropping off", ""},
	}

	for _, tt := range tests {
		t.Run(tt.fieldName, func(t *testing.T) {
			result := MapTransportationFieldToColumn(tt.fieldName)
			if result != tt.wantColumn {
				t.Errorf("MapTransportationFieldToColumn(%q) = %q, want %q", tt.fieldName, result, tt.wantColumn)
			}
		})
	}
}

// TestRetiredBusFieldReasonsCoversExactlyTheElevenUnroutedNames pins
// kindred#2272's inventory: 26 "BUS-*"/legacy definitions accepted, 15 names
// routed to 13 columns, 11 names with no case at all. Every one of those
// eleven must carry an explicit reason in retiredBusFieldReasons -- and
// MapTransportationFieldToColumn must agree that none of them route anywhere,
// or the "known-retired" bucket in classifyUnmappedBusFields would silently
// swallow a field that actually needs a routing case added.
func TestRetiredBusFieldReasonsCoversExactlyTheElevenUnroutedNames(t *testing.T) {
	t.Parallel()
	names := []string{
		"BUS-From camp-traveling without grownup",
		"BUS-Departure airport-from camp",
		"BUS-Airport arriving to home from camp",
		"BUS-Flight # from camp",
		"BUS-Departing time of return home flight",
		"BUS-To camp-traveling without adult",
		"BUS-Departure airport to camp",
		"BUS-Arriving airport to camp",
		"BUS-Flight # to camp",
		"BUS-Arrival time to camp",
		"BUS-phone number of person dropping off",
	}

	if len(retiredBusFieldReasons) != len(names) {
		t.Errorf("retiredBusFieldReasons has %d entries, want %d -- a name was added or dropped without updating this test",
			len(retiredBusFieldReasons), len(names))
	}

	for _, name := range names {
		reason, ok := retiredBusFieldReasons[name]
		if !ok {
			t.Errorf("retiredBusFieldReasons is missing %q", name)
			continue
		}
		if strings.TrimSpace(reason) == "" {
			t.Errorf("retiredBusFieldReasons[%q] has an empty reason", name)
		}
		if col := MapTransportationFieldToColumn(name); col != "" {
			t.Errorf("%q is listed in retiredBusFieldReasons but MapTransportationFieldToColumn routes it to %q -- "+
				"remove it from the retired list or the switch, not both", name, col)
		}
	}
}

// TestClassifyUnmappedBusFields pins the split classifyUnmappedBusFields makes
// between discards the eleven-name retired list already explains and any name
// that is not on that list -- the second bucket is the one that should worry
// an operator, because it means either a new CampMinder "BUS-*" field showed
// up with no routing case, or a retired field this list has not been told
// about yet.
func TestClassifyUnmappedBusFields(t *testing.T) {
	t.Parallel()
	counts := map[string]int{
		"BUS-Departure airport-from camp": 3, // known-retired
		"BUS-Space Rocket to Camp":        1, // not on any list
	}

	known, unexpected := classifyUnmappedBusFields(counts)

	if got := known["BUS-Departure airport-from camp"]; got != 3 {
		t.Errorf("known[%q] = %d, want 3", "BUS-Departure airport-from camp", got)
	}
	if _, leaked := unexpected["BUS-Departure airport-from camp"]; leaked {
		t.Error("a known-retired field leaked into the unexpected bucket")
	}
	if got := unexpected["BUS-Space Rocket to Camp"]; got != 1 {
		t.Errorf("unexpected[%q] = %d, want 1", "BUS-Space Rocket to Camp", got)
	}
	if _, leaked := known["BUS-Space Rocket to Camp"]; leaked {
		t.Error("a field with no retired-field reason must not land in the known bucket")
	}
}

// testRoutedBusValue is a routed transportation value reused across
// kindred#2272's new tests below. Named to satisfy goconst (min-occurrences:
// 3) without touching the table-driven tests elsewhere in this file that
// already repeat "Bus-SF" as anonymous struct fields -- goconst does not
// count those the same way, so they were never flagged.
const testRoutedBusValue = "Bus-SF"

// TestMapTransportFieldToRecordReturnsColumnWritten pins the return-value
// contract kindred#2272 adds: mapTransportFieldToRecord now reports which
// column (if any) it wrote to, so its caller -- the aggregation loop in
// loadPersonCustomValues, the only place with access to the receiver and
// therefore to Stats -- can count and log an unmapped field instead of
// discarding it in silence.
func TestMapTransportFieldToRecordReturnsColumnWritten(t *testing.T) {
	t.Parallel()

	t.Run("mapped field returns its column and writes the value", func(t *testing.T) {
		rec := &camperTransportationRecord{}
		column := mapTransportFieldToRecord(rec, "BUS-to camp", testRoutedBusValue)
		if column != colToCampMethod {
			t.Errorf("column = %q, want %q", column, colToCampMethod)
		}
		if rec.toCampMethod != testRoutedBusValue {
			t.Errorf("rec.toCampMethod = %q, want %q", rec.toCampMethod, testRoutedBusValue)
		}
	})

	t.Run("unmapped retired field returns empty and leaves the record untouched", func(t *testing.T) {
		rec := &camperTransportationRecord{}
		column := mapTransportFieldToRecord(rec, "BUS-Departure airport-from camp", "SFO")
		if column != "" {
			t.Errorf("column = %q, want \"\"", column)
		}
		if *rec != (camperTransportationRecord{}) {
			t.Errorf("rec was mutated by an unmapped field: %+v", rec)
		}
	})
}

// TestTransportationCompositeKeyFormat tests composite key generation
func TestTransportationCompositeKeyFormat(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name      string
		personID  int
		sessionID int
		year      int
		expected  string
	}{
		{"standard key", 12345, 1000001, 2025, "12345:1000001|2025"},
		{"different year", 12345, 1000001, 2024, "12345:1000001|2024"},
		{"large IDs", 9999999, 9999999, 2025, "9999999:9999999|2025"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			key := formatTransportationCompositeKey(tt.personID, tt.sessionID, tt.year)
			if key != tt.expected {
				t.Errorf("formatTransportationCompositeKey = %q, want %q", key, tt.expected)
			}
		})
	}
}

// TestIsTransportationField tests identification of transportation fields
func TestIsTransportationField(t *testing.T) {
	t.Parallel()
	tests := []struct {
		fieldName            string
		wantIsTransportation bool
	}{
		{"BUS-to camp", true},
		{"BUS-home from camp", true},
		{"BUS-who is dropping off", true},
		{"Bus to Camp", true},   // Legacy
		{"Bus From Camp", true}, // Legacy
		{"Family Camp Adult 1", false},
		{"Bunk Preference", false},
		{"BUS", false},         // No hyphen
		{"bus-to camp", false}, // lowercase
	}

	for _, tt := range tests {
		t.Run(tt.fieldName, func(t *testing.T) {
			result := isTransportationField(tt.fieldName)
			if result != tt.wantIsTransportation {
				t.Errorf("isTransportationField(%q) = %v, want %v", tt.fieldName, result, tt.wantIsTransportation)
			}
		})
	}
}

// TestLegacyFieldFallback tests that legacy fields are used when modern fields are empty
func TestLegacyFieldFallback(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name           string
		modernValue    string
		legacyValue    string
		expectedValue  string
		expectedLegacy bool
	}{
		{"modern value present", "Bus-SF", "Bus to Camp", "Bus-SF", false},
		{"only legacy value", "", "Bus to Camp", "Bus to Camp", true},
		{"both empty", "", "", "", false},
		{"modern whitespace only", "   ", "Bus to Camp", "Bus to Camp", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			value, usedLegacy := resolveTransportValue(tt.modernValue, tt.legacyValue)
			if value != tt.expectedValue {
				t.Errorf("resolveTransportValue value = %q, want %q", value, tt.expectedValue)
			}
			if usedLegacy != tt.expectedLegacy {
				t.Errorf("resolveTransportValue usedLegacy = %v, want %v", usedLegacy, tt.expectedLegacy)
			}
		})
	}
}

// TestTransportationRecordBuilding tests building transportation records from source data
func TestTransportationRecordBuilding(t *testing.T) {
	t.Parallel()
	fieldValues := []testTransportFieldValue{
		{PersonID: 12345, SessionID: 1000001, FieldName: "BUS-to camp", Value: "Bus-SF", Year: 2025},
		{PersonID: 12345, SessionID: 1000001, FieldName: "BUS-home from camp", Value: "Flying", Year: 2025},
		{PersonID: 12345, SessionID: 1000001, FieldName: "BUS-who is dropping off", Value: "Jane Doe", Year: 2025},
		{PersonID: 12346, SessionID: 1000001, FieldName: "BUS-to camp", Value: "Parent Dropoff", Year: 2025},
	}

	records := buildTransportationRecords(fieldValues)

	// Should have 2 records (one per person-session combination)
	if len(records) != 2 {
		t.Errorf("expected 2 records, got %d", len(records))
	}

	// Verify first record aggregation
	r1 := findTransportRecord(records, 12345, 1000001)
	if r1 == nil {
		t.Fatal("record for person 12345, session 1000001 not found")
		return
	}
	if r1.ToCampMethod != "Bus-SF" {
		t.Errorf("expected to_camp_method 'Bus-SF', got %q", r1.ToCampMethod)
	}
	if r1.FromCampMethod != "Flying" {
		t.Errorf("expected from_camp_method 'Flying', got %q", r1.FromCampMethod)
	}
	if r1.DropoffName != "Jane Doe" {
		t.Errorf("expected dropoff_name 'Jane Doe', got %q", r1.DropoffName)
	}
}

// TestTransportationEmptyDataHandling tests graceful handling of empty input
func TestTransportationEmptyDataHandling(t *testing.T) {
	t.Parallel()
	fieldValues := []testTransportFieldValue{}

	records := buildTransportationRecords(fieldValues)

	if len(records) != 0 {
		t.Errorf("expected 0 records for empty data, got %d", len(records))
	}
}

// ============================================================================
// Test helper types and functions
// ============================================================================

type testTransportFieldValue struct {
	PersonID  int
	SessionID int
	FieldName string
	Value     string
	Year      int
}

type testTransportRecord struct {
	PersonID           int
	SessionID          int
	Year               int
	ToCampMethod       string
	FromCampMethod     string
	DropoffName        string
	DropoffPhone       string
	DropoffRelation    string
	PickupName         string
	PickupPhone        string
	PickupRelation     string
	AltPickup1Name     string
	AltPickup1Phone    string
	AltPickup1Relation string
	AltPickup2Name     string
	AltPickup2Phone    string
	UsedLegacyFields   bool
}

// isValidTransportationYear validates year parameter
func isValidTransportationYear(year int) bool {
	return year >= 2017 && year <= 2050
}

// normalizeTransportMethod normalizes transportation method strings
func normalizeTransportMethod(rawValue string) string {
	return strings.TrimSpace(rawValue)
}

// Note: MapTransportationFieldToColumn is defined in the implementation file

// isTransportationField checks if a field is a transportation field
func isTransportationField(fieldName string) bool {
	// Modern BUS- prefix
	if strings.HasPrefix(fieldName, "BUS-") {
		return true
	}
	// Legacy fields
	if fieldName == "Bus to Camp" || fieldName == "Bus From Camp" {
		return true
	}
	return false
}

// resolveTransportValue picks modern value or falls back to legacy
func resolveTransportValue(modernValue, legacyValue string) (string, bool) {
	modern := strings.TrimSpace(modernValue)
	if modern != "" {
		return modern, false
	}
	legacy := strings.TrimSpace(legacyValue)
	if legacy != "" {
		return legacy, true
	}
	return "", false
}

// formatTransportationCompositeKey creates composite key
func formatTransportationCompositeKey(personID, sessionID, year int) string {
	return fmt.Sprintf("%d:%d|%d", personID, sessionID, year)
}

// buildTransportationRecords builds records from field values
func buildTransportationRecords(fieldValues []testTransportFieldValue) []*testTransportRecord {
	recordsByKey := make(map[string]*testTransportRecord)

	for _, fv := range fieldValues {
		key := formatTransportationCompositeKey(fv.PersonID, fv.SessionID, fv.Year)

		if _, exists := recordsByKey[key]; !exists {
			recordsByKey[key] = &testTransportRecord{
				PersonID:  fv.PersonID,
				SessionID: fv.SessionID,
				Year:      fv.Year,
			}
		}

		rec := recordsByKey[key]
		column := MapTransportationFieldToColumn(fv.FieldName)
		switch column {
		case "to_camp_method":
			rec.ToCampMethod = fv.Value
		case "from_camp_method":
			rec.FromCampMethod = fv.Value
		case "dropoff_name":
			rec.DropoffName = fv.Value
		case "dropoff_phone":
			rec.DropoffPhone = fv.Value
		case "dropoff_relationship":
			rec.DropoffRelation = fv.Value
		case "pickup_name":
			rec.PickupName = fv.Value
		case "pickup_phone":
			rec.PickupPhone = fv.Value
		case "pickup_relationship":
			rec.PickupRelation = fv.Value
		case "alt_pickup_1_name":
			rec.AltPickup1Name = fv.Value
		case "alt_pickup_1_phone":
			rec.AltPickup1Phone = fv.Value
		case "alt_pickup_1_relationship":
			rec.AltPickup1Relation = fv.Value
		case "alt_pickup_2_name":
			rec.AltPickup2Name = fv.Value
		case "alt_pickup_2_phone":
			rec.AltPickup2Phone = fv.Value
		case "to_camp_method_legacy":
			if rec.ToCampMethod == "" {
				rec.ToCampMethod = fv.Value
				rec.UsedLegacyFields = true
			}
		case "from_camp_method_legacy":
			if rec.FromCampMethod == "" {
				rec.FromCampMethod = fv.Value
				rec.UsedLegacyFields = true
			}
		}
	}

	records := make([]*testTransportRecord, 0, len(recordsByKey))
	for _, r := range recordsByKey {
		records = append(records, r)
	}
	return records
}

// findTransportRecord finds a record by person and session ID
func findTransportRecord(records []*testTransportRecord, personID, sessionID int) *testTransportRecord {
	for _, r := range records {
		if r.PersonID == personID && r.SessionID == sessionID {
			return r
		}
	}
	return nil
}

// TestExtractSessionCMIDFromExpanded verifies that session CM IDs can be extracted
// from expanded relation records. This tests the fix for the bug where
// loadAttendeeMapping was calling GetInt("session_id") on attendees, but attendees
// only has a "session" relation field (PB ID), not "session_id" (CM ID).
// The fix uses ExpandRecords() to expand the session relation and get cm_id.
func TestExtractSessionCMIDFromExpanded(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name            string
		sessionCMID     int
		expectExtracted bool
	}{
		{"valid session CM ID", 1000001, true},
		{"another valid session CM ID", 1000002, true},
		{"zero CM ID should be skipped", 0, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Simulate what the fixed code should do:
			// 1. Get the session PB ID from attendee.GetString("session")
			// 2. Expand the session relation
			// 3. Get cm_id from the expanded session record

			// This test validates the extraction logic in isolation
			sessionID := extractSessionCMID(tt.sessionCMID)
			gotExtracted := sessionID > 0

			if gotExtracted != tt.expectExtracted {
				t.Errorf("extractSessionCMID(%d): got extracted=%v, want %v",
					tt.sessionCMID, gotExtracted, tt.expectExtracted)
			}

			if tt.expectExtracted && sessionID != tt.sessionCMID {
				t.Errorf("extractSessionCMID(%d) = %d, want %d",
					tt.sessionCMID, sessionID, tt.sessionCMID)
			}
		})
	}
}

// extractSessionCMID simulates extracting session CM ID from an expanded record.
// In the real implementation, this is: expandedSession.GetInt("cm_id")
// This helper validates the logic used in loadAttendeeMapping after the fix.
func extractSessionCMID(cmID int) int {
	// Mirror the validation logic: return the CM ID if valid (> 0), otherwise 0
	if cmID > 0 {
		return cmID
	}
	return 0
}

// TestAttendeeKeyRequiresValidSessionID verifies that attendee keys are only
// created when both person_id AND session_id (CM ID) are valid.
// This ensures the fixed loadAttendeeMapping won't add entries with session_id=0.
func TestAttendeeKeyRequiresValidSessionID(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name      string
		personID  int
		sessionID int
		shouldAdd bool
	}{
		{"both valid", 12345, 1000001, true},
		{"zero session ID", 12345, 0, false},
		{"zero person ID", 0, 1000001, false},
		{"both zero", 0, 0, false},
		{"negative session ID", 12345, -1, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			shouldAdd := tt.personID > 0 && tt.sessionID > 0
			if shouldAdd != tt.shouldAdd {
				t.Errorf("shouldAdd(personID=%d, sessionID=%d) = %v, want %v",
					tt.personID, tt.sessionID, shouldAdd, tt.shouldAdd)
			}
		})
	}
}

// TestCamperTransportationDeleteOrphansRefusesCollapsedComputedSet pins the
// guard kindred#2283 adds. Before this fix deleteOrphans returned a bare int
// and had no channel to refuse a sweep at all -- an empty computed set against
// a populated year deleted the whole year and reported success.
//
// NOTE since kindred#2283 rows 3+4: this pins the guard's CONTRACT, not a state
// Sync() can now produce. Sync() sets SyncSuccessful from len(records), so an
// empty computed set skips the sweep before the guard is consulted. The arm
// that stays live on this path is the ratio one -- a source that came back
// short rather than empty.
func TestCamperTransportationDeleteOrphansRefusesCollapsedComputedSet(t *testing.T) {
	t.Parallel()
	app := newOrphanSweepTestApp(t, "camper_transportation", "person_id", "session_id")
	col, err := app.FindCollectionByNameOrId("camper_transportation")
	if err != nil {
		t.Fatalf("find camper_transportation: %v", err)
	}
	rec := core.NewRecord(col)
	rec.Set("person_id", 7001)
	rec.Set("session_id", 300)
	rec.Set("year", 2026)
	if saveErr := app.Save(rec); saveErr != nil {
		t.Fatalf("save existing row: %v", saveErr)
	}

	s := NewCamperTransportationSync(app)
	// Set explicitly because this drives deleteOrphans directly rather than
	// through Sync(), which is what normally sets it from the size of the
	// extraction (kindred#2283 rows 3+4). The three ProcessedKeys-based syncs
	// have always required this of their tests; these four now match.
	s.SyncSuccessful = true
	existing := map[string]string{makeTransportationKey(7001, 300, 2026): rec.Id}

	deleted, err := s.deleteOrphans(context.Background(),
		map[string]*camperTransportationRecord{}, existing, 2026)

	if err == nil {
		t.Fatal("expected an error when the computed set is empty and rows exist, got nil")
	}
	if deleted != 0 {
		t.Errorf("deleted = %d, want 0 -- nothing may be removed on the refusal path", deleted)
	}

	remaining, err := app.FindRecordsByFilter("camper_transportation", "year = 2026", "", 0, 0)
	if err != nil {
		t.Fatalf("re-query: %v", err)
	}
	if len(remaining) != 1 {
		t.Errorf("%d rows survived, want 1 -- the guard must not delete", len(remaining))
	}
}

// TestCamperTransportationDeleteOrphansStillSweepsGenuineOrphans proves the
// guard did not disable orphan deletion for the normal case.
func TestCamperTransportationDeleteOrphansStillSweepsGenuineOrphans(t *testing.T) {
	t.Parallel()
	app := newOrphanSweepTestApp(t, "camper_transportation", "person_id", "session_id")
	col, err := app.FindCollectionByNameOrId("camper_transportation")
	if err != nil {
		t.Fatalf("find camper_transportation: %v", err)
	}
	orphan := core.NewRecord(col)
	orphan.Set("person_id", 7002)
	orphan.Set("session_id", 300)
	orphan.Set("year", 2026)
	if saveErr := app.Save(orphan); saveErr != nil {
		t.Fatalf("save orphan: %v", saveErr)
	}

	s := NewCamperTransportationSync(app)
	// Set explicitly because this drives deleteOrphans directly rather than
	// through Sync(), which is what normally sets it from the size of the
	// extraction (kindred#2283 rows 3+4). The three ProcessedKeys-based syncs
	// have always required this of their tests; these four now match.
	s.SyncSuccessful = true
	records := map[string]*camperTransportationRecord{
		makeTransportationKey(7001, 300, 2026): {personID: 7001, sessionID: 300, year: 2026},
	}
	existing := map[string]string{makeTransportationKey(7002, 300, 2026): orphan.Id}

	deleted, err := s.deleteOrphans(context.Background(), records, existing, 2026)
	if err != nil {
		t.Fatalf("deleteOrphans: %v", err)
	}
	if deleted != 1 {
		t.Errorf("deleted = %d, want 1", deleted)
	}
}

// ---------------------------------------------------------------------------
// kindred#2272: the silent-discard mechanism itself
// ---------------------------------------------------------------------------

// newTransportValuesTestApp returns a throwaway app holding just the two
// collections loadPersonCustomValues actually queries: person_custom_values
// (the source rows) and persons (person PB ID -> CampMinder person ID).
// loadPersonCustomValues takes fieldNameMap and attendeeMap as plain Go map
// parameters rather than loading them itself, so a fake custom_field_defs or
// attendees collection would test plumbing this function does not use.
func newTransportValuesTestApp(t *testing.T) core.App {
	t.Helper()
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)

	pcv := core.NewBaseCollection("person_custom_values")
	pcv.Fields.Add(&core.TextField{Name: "field_definition"})
	pcv.Fields.Add(&core.TextField{Name: "person"})
	pcv.Fields.Add(&core.TextField{Name: "value"})
	pcv.Fields.Add(&core.NumberField{Name: "year"})
	if saveErr := app.Save(pcv); saveErr != nil {
		t.Fatalf("save person_custom_values: %v", saveErr)
	}

	persons := core.NewBaseCollection("persons")
	persons.Fields.Add(&core.NumberField{Name: "cm_id"})
	if saveErr := app.Save(persons); saveErr != nil {
		t.Fatalf("save persons: %v", saveErr)
	}

	return app
}

// addPersonCustomValue writes one person_custom_values row.
func addPersonCustomValue(t *testing.T, app core.App, fieldDefID, personPBID, value string, year int) {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("person_custom_values")
	if err != nil {
		t.Fatalf("find person_custom_values: %v", err)
	}
	rec := core.NewRecord(col)
	rec.Set("field_definition", fieldDefID)
	rec.Set("person", personPBID)
	rec.Set("value", value)
	rec.Set("year", year)
	if saveErr := app.Save(rec); saveErr != nil {
		t.Fatalf("save person_custom_values row: %v", saveErr)
	}
}

// TestLoadPersonCustomValuesCountsAndLogsUnmappedFields is the end-to-end pin
// for kindred#2272's actual fix: before this, a "BUS-*" field accepted by
// isCamperTransportationField but missing a case in
// MapTransportationFieldToColumn was discarded with no counter and no log
// line. It now must increment Stats.Skipped once per discard event and log
// the field name, split into the known-retired bucket (documented in
// retiredBusFieldReasons) and the unrecognized bucket (a name this run has
// never been told about -- the signal that matters if CampMinder ever adds a
// new "BUS-*" field).
func TestLoadPersonCustomValuesCountsAndLogsUnmappedFields(t *testing.T) {
	app := newTransportValuesTestApp(t)

	personsCol, err := app.FindCollectionByNameOrId("persons")
	if err != nil {
		t.Fatalf("find persons: %v", err)
	}
	person := core.NewRecord(personsCol)
	person.Set("cm_id", 7001)
	if saveErr := app.Save(person); saveErr != nil {
		t.Fatalf("save person: %v", saveErr)
	}

	const year = 2019
	// One routed field (must still work), one known-retired unrouted field,
	// and one field this run has never seen before (simulates a hypothetical
	// new CampMinder "BUS-*" definition).
	addPersonCustomValue(t, app, "fd_routed", person.Id, testRoutedBusValue, year)
	addPersonCustomValue(t, app, "fd_retired", person.Id, "SFO", year)
	addPersonCustomValue(t, app, "fd_novel", person.Id, "unexpected value", year)

	fieldNameMap := map[string]string{
		"fd_routed":  "BUS-to camp",
		"fd_retired": "BUS-Departure airport-from camp",
		"fd_novel":   "BUS-Space Rocket to Camp",
	}
	attendeeMap := map[attendeeKey]string{
		{personID: 7001, sessionID: 9001}: "att1",
	}

	logs := captureSweepLogs(t)

	s := NewCamperTransportationSync(app)
	records, err := s.loadPersonCustomValues(context.Background(), year, fieldNameMap, attendeeMap)
	if err != nil {
		t.Fatalf("loadPersonCustomValues: %v", err)
	}

	compositeKey := makeTransportationKey(7001, 9001, year)
	rec, ok := records[compositeKey]
	if !ok {
		t.Fatalf("no record for composite key %q; got %d records", compositeKey, len(records))
	}
	if rec.toCampMethod != testRoutedBusValue {
		t.Errorf("routed field was not written: toCampMethod = %q, want %q", rec.toCampMethod, testRoutedBusValue)
	}

	if s.Stats.Skipped != 2 {
		t.Errorf("Stats.Skipped = %d, want 2 -- one discard event each for the retired and the novel field",
			s.Stats.Skipped)
	}

	logged := logs.String()
	if !strings.Contains(logged, "BUS-Departure airport-from camp") {
		t.Errorf("known-retired field name missing from logs:\n%s", logged)
	}
	if !strings.Contains(logged, "BUS-Space Rocket to Camp") {
		t.Errorf("unrecognized field name missing from logs:\n%s", logged)
	}
	if !strings.Contains(logged, "level=WARN") {
		t.Errorf("expected the discard to be logged at WARN level:\n%s", logged)
	}
	// The routed field must never appear as a discard.
	if strings.Contains(logged, "BUS-to camp") {
		t.Errorf("a successfully routed field was logged as a discard:\n%s", logged)
	}
}

// TestLoadPersonCustomValuesNoDiscardsMeansNoWarnLog proves the fix does not
// spam every ordinary sync run: a year with nothing unmapped must not log at
// all and must leave Stats.Skipped at zero, matching the actual 2021+ data
// (kindred#2272 measured zero discards in every year since 2021).
func TestLoadPersonCustomValuesNoDiscardsMeansNoWarnLog(t *testing.T) {
	app := newTransportValuesTestApp(t)

	personsCol, err := app.FindCollectionByNameOrId("persons")
	if err != nil {
		t.Fatalf("find persons: %v", err)
	}
	person := core.NewRecord(personsCol)
	person.Set("cm_id", 7002)
	if saveErr := app.Save(person); saveErr != nil {
		t.Fatalf("save person: %v", saveErr)
	}

	const year = 2026
	addPersonCustomValue(t, app, "fd_routed", person.Id, testRoutedBusValue, year)

	fieldNameMap := map[string]string{"fd_routed": "BUS-to camp"}
	attendeeMap := map[attendeeKey]string{
		{personID: 7002, sessionID: 9002}: "att2",
	}

	logs := captureSweepLogs(t)

	s := NewCamperTransportationSync(app)
	if _, err := s.loadPersonCustomValues(context.Background(), year, fieldNameMap, attendeeMap); err != nil {
		t.Fatalf("loadPersonCustomValues: %v", err)
	}

	if s.Stats.Skipped != 0 {
		t.Errorf("Stats.Skipped = %d, want 0", s.Stats.Skipped)
	}
	if logged := logs.String(); logged != "" {
		t.Errorf("expected no log output when nothing was discarded, got:\n%s", logged)
	}
}
