package sync

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	pbtests "github.com/pocketbase/pocketbase/tests"
)

// TestQuestRegistrationsLoadFieldDefinitionsTrimsNames is a regression test
// for kindred#1873. isQuestRegistrationField admits by prefix, which a
// trailing space would not defeat, but MapQuestFieldToColumn exact-matches
// the trimmed literal downstream -- so an untrimmed name would be admitted
// into the map and then silently fail to route. No untrimmed name exists in
// this table today; this pins the fix against a future one.
func TestQuestRegistrationsLoadFieldDefinitionsTrimsNames(t *testing.T) {
	t.Parallel()
	app := newFieldDefsTestApp(t, map[int]string{
		1: "Q-Why come? ",           // trailing space
		2: "Quest-Parent Signature", // already clean, must be unaffected
	})

	s := NewQuestRegistrationsSync(app)
	got, err := s.loadFieldDefinitions(context.Background())
	if err != nil {
		t.Fatalf("loadFieldDefinitions: %v", err)
	}

	want := map[string]bool{
		"Q-Why come?":            true,
		"Quest-Parent Signature": true,
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

	if col := MapQuestFieldToColumn("Q-Why come?"); col != colWhyCome {
		t.Errorf("MapQuestFieldToColumn(%q) = %q, want %q", "Q-Why come?", col, colWhyCome)
	}
}

// TestQuestRegistrationsYearValidation tests year parameter validation
func TestQuestRegistrationsYearValidation(t *testing.T) {
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
			valid := isValidQuestYear(tt.year)
			if valid != tt.wantValid {
				t.Errorf("isValidQuestYear(%d) = %v, want %v", tt.year, valid, tt.wantValid)
			}
		})
	}
}

// TestQuestFieldMapping tests CampMinder field to column mapping
func TestQuestFieldMapping(t *testing.T) {
	t.Parallel()
	tests := []struct {
		fieldName  string
		wantColumn string
	}{
		// Quest- prefixed fields
		{"Quest-Parent Signature", "parent_signature"},
		{"Quest-Signature of Quester", "quester_signature"},
		{"Quest-prefer to be called", "preferred_name"},
		{"Quest-biggest hope", "biggest_hope"},
		{"Quest-biggest concern", "biggest_concern"},
		{"Quest-How easily make friends", "make_friends_ease"},
		{"Quest-Make friends - explain", "make_friends_explain"},
		{"Quest-React to Separation", "separation_reaction"},
		{"Quest-React to Separat explain", "separation_explain"},
		{"Quest-away from home before?", "away_before"},
		{"Quest-away from home explain", "away_explain"},
		{"Quest-Expressfrustration/anger", "express_frustration"},
		{"Quest-What makes child angry", "what_makes_angry"},
		{"Quest-cooperate with limits", "cooperates_with_limits"},
		{"Quest-techniques to set limits", "techniques_limits"},
		{"Quest-any medications", "any_medications"},
		{"Quest-Physical Limitations", "physical_limitations"},
		{"Quest-Physical limit explain", "physical_limit_explain"},
		{"Quest-fears or anxieties", "fears_anxieties"},
		{"Quest-situations/transitions", "situations_transitions"},
		{"Quest-Bad camp experiences", "bad_camp_experiences"},
		{"Quest-child matured", "child_matured"},
		{"Quest-Change since last year", "change_since_last_year"},
		{"Quest-Extracurricular activiti", "extracurricular"},
		{"Quest-Cook/chores around house", "cook_chores"},
		{"Quest-Cook/Chores Explain", "cook_chores_explain"},
		{"Quest-decision attend Tawonga", "decision_attend"},
		{"Quest-How can we help?", "how_can_help"},
		{"Quest-How much does child", "how_much_child"},
		{"Quest-Has your quester", "has_quester_before"},
		{"Quest-Special Needs", "special_needs"},
		{"Quest-Concerns for child", "concerns_for_child"},
		{"Quest-Anything else", "anything_else"},
		{"Quest-Bar/BatMitzvah this year", "bar_mitzvah_year"},
		{"Quest-Bar/BatMitzvah where", "bar_mitzvah_where"},
		{"Quest-Bar mitzvah month", "bar_mitzvah_month"},
		{"Quest-Backpack", "backpack_info"},
		// Q- prefixed fields
		{"Q-Why come?", "why_come"},
		{"Q-Most looking forward to", "most_looking_forward"},
		{"Q-least looking forward to", "least_looking_forward"},
		{"Q-biggest accomplishment", "biggest_accomplishment"},
		{"Q-biggest disappointment", "biggest_disappointment"},
		{"Q-Whose decision", "whose_decision"},
		{"Q-If returning", "if_returning"},
		// Quest BUS- fields
		{"Quest BUS-person picking up", "bus_pickup_name"},
		{"Quest BUS-phone person picking up", "bus_pickup_phone"},
		{"Quest BUS-relationship to camper pick up", "bus_pickup_relationship"},
		{"Quest BUS-alternate pick up", "bus_alt_pickup"},
		{"Quest BUS-alternate phone", "bus_alt_phone"},
		// Unknown field
		{"Unknown-Field", ""},
	}

	for _, tt := range tests {
		t.Run(tt.fieldName, func(t *testing.T) {
			result := MapQuestFieldToColumn(tt.fieldName)
			if result != tt.wantColumn {
				t.Errorf("MapQuestFieldToColumn(%q) = %q, want %q", tt.fieldName, result, tt.wantColumn)
			}
		})
	}
}

// TestQuestCompositeKeyFormat tests composite key generation
func TestQuestCompositeKeyFormat(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name     string
		personID int
		year     int
		expected string
	}{
		{"standard key", 12345, 2025, "12345|2025"},
		{"different year", 12345, 2024, "12345|2024"},
		{"large ID", 9999999, 2025, "9999999|2025"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			key := formatQuestCompositeKey(tt.personID, tt.year)
			if key != tt.expected {
				t.Errorf("formatQuestCompositeKey = %q, want %q", key, tt.expected)
			}
		})
	}
}

// TestIsQuestField tests identification of Quest fields
func TestIsQuestField(t *testing.T) {
	t.Parallel()
	tests := []struct {
		fieldName   string
		wantIsQuest bool
	}{
		{"Quest-Parent Signature", true},
		{"Quest-biggest hope", true},
		{"Q-Why come?", true},
		{"Q-Most looking forward to", true},
		{"Quest BUS-person picking up", true},
		{"Family Camp Adult 1", false},
		{"Bunk Preference", false},
		{"quest-parent signature", false}, // case sensitive
		{"Q -Why come", false},            // extra space
	}

	for _, tt := range tests {
		t.Run(tt.fieldName, func(t *testing.T) {
			result := isQuestField(tt.fieldName)
			if result != tt.wantIsQuest {
				t.Errorf("isQuestField(%q) = %v, want %v", tt.fieldName, result, tt.wantIsQuest)
			}
		})
	}
}

// TestQuestBooleanParsing tests parsing Bar/Bat Mitzvah year field
func TestQuestBooleanParsing(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name     string
		rawValue string
		wantBool bool
	}{
		{"Yes", "Yes", true},
		{"yes lowercase", "yes", true},
		{"No", "No", false},
		{"empty", "", false},
		{"This year", "This year", true},
		{"Not this year", "Not this year", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := parseQuestBool(tt.rawValue)
			if result != tt.wantBool {
				t.Errorf("parseQuestBool(%q) = %v, want %v", tt.rawValue, result, tt.wantBool)
			}
		})
	}
}

// TestQuestRecordBuilding tests building quest records from source data
func TestQuestRecordBuilding(t *testing.T) {
	t.Parallel()
	fieldValues := []testQuestFieldValue{
		{PersonID: 12345, FieldName: "Quest-Parent Signature", Value: "John Smith", Year: 2025},
		{PersonID: 12345, FieldName: "Quest-biggest hope", Value: "Make new friends", Year: 2025},
		{PersonID: 12345, FieldName: "Q-Why come?", Value: "Loves the outdoors", Year: 2025},
		{PersonID: 12345, FieldName: "Quest-Bar/BatMitzvah this year", Value: "Yes", Year: 2025},
		{PersonID: 12346, FieldName: "Quest-Parent Signature", Value: "Jane Doe", Year: 2025},
	}

	records := buildQuestRecords(fieldValues)

	// Should have 2 records (one per person-year combination)
	if len(records) != 2 {
		t.Errorf("expected 2 records, got %d", len(records))
	}

	// Verify first record
	r1 := findQuestRecord(records, 12345, 2025)
	if r1 == nil {
		t.Fatal("record for person 12345, year 2025 not found")
		return
	}
	if r1.ParentSignature != "John Smith" {
		t.Errorf("expected parent_signature 'John Smith', got %q", r1.ParentSignature)
	}
	if r1.BiggestHope != "Make new friends" {
		t.Errorf("expected biggest_hope 'Make new friends', got %q", r1.BiggestHope)
	}
	if r1.WhyCome != "Loves the outdoors" {
		t.Errorf("expected why_come 'Loves the outdoors', got %q", r1.WhyCome)
	}
	if !r1.BarMitzvahYear {
		t.Error("expected bar_mitzvah_year = true")
	}
}

// TestQuestEmptyDataHandling tests graceful handling of empty input
func TestQuestEmptyDataHandling(t *testing.T) {
	t.Parallel()
	fieldValues := []testQuestFieldValue{}

	records := buildQuestRecords(fieldValues)

	if len(records) != 0 {
		t.Errorf("expected 0 records for empty data, got %d", len(records))
	}
}

// TestQuestFieldCount tests that we map all expected fields
func TestQuestFieldCount(t *testing.T) {
	t.Parallel()
	// From the plan: 45 Quest-/Q- fields total
	// We should map at least the key ones
	knownFields := []string{
		"Quest-Parent Signature",
		"Quest-Signature of Quester",
		"Quest-prefer to be called",
		"Q-Why come?",
		"Q-Most looking forward to",
		"Q-least looking forward to",
		"Q-biggest accomplishment",
		"Q-biggest disappointment",
		"Q-Whose decision",
		"Q-If returning",
		"Quest-biggest hope",
		"Quest-biggest concern",
		"Quest-How easily make friends",
		"Quest-Make friends - explain",
		"Quest-React to Separation",
		"Quest-React to Separat explain",
		"Quest-away from home before?",
		"Quest-away from home explain",
		"Quest-Expressfrustration/anger",
		"Quest-What makes child angry",
		"Quest-cooperate with limits",
		"Quest-techniques to set limits",
		"Quest-any medications",
		"Quest-Physical Limitations",
		"Quest-Physical limit explain",
		"Quest-fears or anxieties",
		"Quest-situations/transitions",
		"Quest-Bad camp experiences",
		"Quest-child matured",
		"Quest-Change since last year",
		"Quest-Extracurricular activiti",
		"Quest-Cook/chores around house",
		"Quest-Cook/Chores Explain",
		"Quest-decision attend Tawonga",
		"Quest-How can we help?",
		"Quest-How much does child",
		"Quest-Has your quester",
		"Quest-Special Needs",
		"Quest-Concerns for child",
		"Quest-Anything else",
		"Quest-Bar/BatMitzvah this year",
		"Quest-Bar/BatMitzvah where",
		"Quest-Bar mitzvah month",
		"Quest-Backpack",
		"Quest BUS-person picking up",
		"Quest BUS-phone person picking up",
		"Quest BUS-relationship to camper pick up",
		"Quest BUS-alternate pick up",
		"Quest BUS-alternate phone",
	}

	mappedCount := 0
	for _, field := range knownFields {
		if MapQuestFieldToColumn(field) != "" {
			mappedCount++
		}
	}

	// All known fields should be mapped
	if mappedCount != len(knownFields) {
		t.Errorf("expected %d fields mapped, got %d", len(knownFields), mappedCount)
	}
}

// ============================================================================
// Test helper types and functions
// ============================================================================

type testQuestFieldValue struct {
	PersonID  int
	FieldName string
	Value     string
	Year      int
}

type testQuestRecord struct {
	PersonID         int
	Year             int
	ParentSignature  string
	QuesterSignature string
	PreferredName    string
	WhyCome          string
	MostLookingFwd   string
	LeastLookingFwd  string
	BiggestHope      string
	BiggestConcern   string
	BarMitzvahYear   bool
	BarMitzvahWhere  string
	BarMitzvahMonth  string
	// ... many more fields
}

// isValidQuestYear validates year parameter
func isValidQuestYear(year int) bool {
	return year >= 2017 && year <= 2050
}

// Note: parseQuestBool and MapQuestFieldToColumn are defined in the implementation file

// isQuestField checks if a field is a Quest field
func isQuestField(fieldName string) bool {
	if strings.HasPrefix(fieldName, "Quest-") {
		return true
	}
	if strings.HasPrefix(fieldName, "Q-") {
		return true
	}
	if strings.HasPrefix(fieldName, "Quest BUS-") {
		return true
	}
	return false
}

// formatQuestCompositeKey creates composite key
func formatQuestCompositeKey(personID, year int) string {
	return fmt.Sprintf("%d|%d", personID, year)
}

// buildQuestRecords builds records from field values
func buildQuestRecords(fieldValues []testQuestFieldValue) []*testQuestRecord {
	recordsByKey := make(map[string]*testQuestRecord)

	for _, fv := range fieldValues {
		key := formatQuestCompositeKey(fv.PersonID, fv.Year)

		if _, exists := recordsByKey[key]; !exists {
			recordsByKey[key] = &testQuestRecord{
				PersonID: fv.PersonID,
				Year:     fv.Year,
			}
		}

		rec := recordsByKey[key]
		column := MapQuestFieldToColumn(fv.FieldName)
		switch column {
		case "parent_signature":
			rec.ParentSignature = fv.Value
		case "quester_signature":
			rec.QuesterSignature = fv.Value
		case "preferred_name":
			rec.PreferredName = fv.Value
		case "why_come":
			rec.WhyCome = fv.Value
		case "most_looking_forward":
			rec.MostLookingFwd = fv.Value
		case "least_looking_forward":
			rec.LeastLookingFwd = fv.Value
		case "biggest_hope":
			rec.BiggestHope = fv.Value
		case "biggest_concern":
			rec.BiggestConcern = fv.Value
		case "bar_mitzvah_year":
			rec.BarMitzvahYear = parseQuestBool(fv.Value)
		case "bar_mitzvah_where":
			rec.BarMitzvahWhere = fv.Value
		case "bar_mitzvah_month":
			rec.BarMitzvahMonth = fv.Value
		}
	}

	records := make([]*testQuestRecord, 0, len(recordsByKey))
	for _, r := range recordsByKey {
		records = append(records, r)
	}
	return records
}

// findQuestRecord finds a record by person ID and year
func findQuestRecord(records []*testQuestRecord, personID, year int) *testQuestRecord {
	for _, r := range records {
		if r.PersonID == personID && r.Year == year {
			return r
		}
	}
	return nil
}

// TestQuestRegistrationsDeleteOrphansRefusesCollapsedComputedSet pins the
// guard kindred#2283 adds. Before this fix deleteOrphans returned a bare int
// and had no channel to refuse a sweep at all -- an empty computed set against
// a populated year deleted the whole year and reported success.
//
// NOTE since kindred#2283 rows 3+4: this pins the guard's CONTRACT, not a state
// Sync() can now produce. Sync() sets SyncSuccessful from len(records), so an
// empty computed set skips the sweep before the guard is consulted. The arm
// that stays live on this path is the ratio one -- a source that came back
// short rather than empty.
func TestQuestRegistrationsDeleteOrphansRefusesCollapsedComputedSet(t *testing.T) {
	t.Parallel()
	app := newOrphanSweepTestApp(t, "quest_registrations", "person_id")
	col, err := app.FindCollectionByNameOrId("quest_registrations")
	if err != nil {
		t.Fatalf("find quest_registrations: %v", err)
	}
	rec := core.NewRecord(col)
	rec.Set("person_id", 9001)
	rec.Set("year", 2026)
	if saveErr := app.Save(rec); saveErr != nil {
		t.Fatalf("save existing row: %v", saveErr)
	}

	s := NewQuestRegistrationsSync(app)
	// Set explicitly because this drives deleteOrphans directly rather than
	// through Sync(), which is what normally sets it from the size of the
	// extraction (kindred#2283 rows 3+4). The three ProcessedKeys-based syncs
	// have always required this of their tests; these four now match.
	s.SyncSuccessful = true
	existing := map[string]string{makeQuestRegistrationKey(9001, 2026): rec.Id}

	deleted, err := s.deleteOrphans(context.Background(),
		map[string]*questRegistrationRecord{}, existing, 2026)

	if err == nil {
		t.Fatal("expected an error when the computed set is empty and rows exist, got nil")
	}
	if deleted != 0 {
		t.Errorf("deleted = %d, want 0 -- nothing may be removed on the refusal path", deleted)
	}

	remaining, err := app.FindRecordsByFilter("quest_registrations", "year = 2026", "", 0, 0)
	if err != nil {
		t.Fatalf("re-query: %v", err)
	}
	if len(remaining) != 1 {
		t.Errorf("%d rows survived, want 1 -- the guard must not delete", len(remaining))
	}
}

// TestQuestRegistrationsDeleteOrphansStillSweepsGenuineOrphans proves the
// guard did not disable orphan deletion for the normal case.
func TestQuestRegistrationsDeleteOrphansStillSweepsGenuineOrphans(t *testing.T) {
	t.Parallel()
	app := newOrphanSweepTestApp(t, "quest_registrations", "person_id")
	col, err := app.FindCollectionByNameOrId("quest_registrations")
	if err != nil {
		t.Fatalf("find quest_registrations: %v", err)
	}
	orphan := core.NewRecord(col)
	orphan.Set("person_id", 9002)
	orphan.Set("year", 2026)
	if saveErr := app.Save(orphan); saveErr != nil {
		t.Fatalf("save orphan: %v", saveErr)
	}

	s := NewQuestRegistrationsSync(app)
	// Set explicitly because this drives deleteOrphans directly rather than
	// through Sync(), which is what normally sets it from the size of the
	// extraction (kindred#2283 rows 3+4). The three ProcessedKeys-based syncs
	// have always required this of their tests; these four now match.
	s.SyncSuccessful = true
	records := map[string]*questRegistrationRecord{
		makeQuestRegistrationKey(9001, 2026): {personID: 9001, year: 2026},
	}
	existing := map[string]string{makeQuestRegistrationKey(9002, 2026): orphan.Id}

	deleted, err := s.deleteOrphans(context.Background(), records, existing, 2026)
	if err != nil {
		t.Fatalf("deleteOrphans: %v", err)
	}
	if deleted != 1 {
		t.Errorf("deleted = %d, want 1", deleted)
	}
}

// --- kindred#2261: the stored attendee link is dropped ---------------------
//
// These exercise the PRODUCTION aggregation, unlike TestQuestRecordBuilding
// above, which drives a reimplementation local to this file (buildQuestRecords)
// and therefore cannot fail when the real code changes.

// TestAggregateQuestEntriesKeepsAdmissionFilter pins the behavior that must
// NOT change when the attendee relation is removed: a person holding Quest
// values but carrying no attendees row for the year is still excluded.
// Measured on the production snapshot this is a no-op today (0 such people in
// 2024-2026) -- which is exactly why it needs a test rather than an assumption.
func TestAggregateQuestEntriesKeepsAdmissionFilter(t *testing.T) {
	t.Parallel()
	entries := []questValueEntry{
		{personID: 100, fieldName: "Q-Why come?", value: "adventure"},
		{personID: 200, fieldName: "Q-Why come?", value: "friends"},
	}
	// 100 is enrolled somewhere this year; 200 is not.
	hasAttendee := map[int]bool{100: true}

	got, _ := aggregateQuestEntries(entries, 2026, hasAttendee)

	if len(got) != 1 {
		t.Fatalf("expected 1 admitted record, got %d", len(got))
	}
	if _, ok := got[makeQuestRegistrationKey(100, 2026)]; !ok {
		t.Error("person 100 has an attendee row and must be admitted")
	}
	if _, ok := got[makeQuestRegistrationKey(200, 2026)]; ok {
		t.Error("person 200 has no attendee row and must NOT be admitted")
	}
}

// TestAggregateQuestEntriesIsOrderIndependent is the probe kindred#2257 calls
// for. The old code kept whichever attendees row the query plan yielded first
// (sort was ""), so output depended on input order. Permuting the input must
// now produce identical output.
func TestAggregateQuestEntriesIsOrderIndependent(t *testing.T) {
	t.Parallel()
	forward := []questValueEntry{
		{personID: 100, fieldName: "Q-Why come?", value: "adventure"},
		{personID: 100, fieldName: "Q-biggest hope", value: "new friends"},
		{personID: 200, fieldName: "Q-Why come?", value: "friends"},
	}
	reversed := make([]questValueEntry, len(forward))
	for i, e := range forward {
		reversed[len(forward)-1-i] = e
	}
	hasAttendee := map[int]bool{100: true, 200: true}

	a, _ := aggregateQuestEntries(forward, 2026, hasAttendee)
	b, _ := aggregateQuestEntries(reversed, 2026, hasAttendee)

	if len(a) != len(b) {
		t.Fatalf("record count differs by input order: %d vs %d", len(a), len(b))
	}
	for key, ra := range a {
		rb, ok := b[key]
		if !ok {
			t.Fatalf("key %q present in one ordering only", key)
			return
		}
		if ra.whyCome != rb.whyCome || ra.biggestHope != rb.biggestHope {
			t.Errorf("key %q resolved differently by input order: %+v vs %+v", key, ra, rb)
		}
	}
}

// TestCountMultiQuestEnrollments guards the assumption this change rests on.
// Nobody has ever held two Quest enrollments in one year (max 1 in every year
// 2021-2026), and the questionnaire is person x year at the source -- one value
// per (year, person, field), enforced by UNIQUE(year, person, field_definition).
// So a session dimension would duplicate rather than recover. If the form ever
// starts allowing two, we must hear about it instead of silently picking.
func TestCountMultiQuestEnrollments(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name           string
		sessionsByCMID map[int][]string
		want           int
	}{
		{"nobody doubles", map[int][]string{100: {"s1"}, 200: {"s2"}}, 0},
		{"one person doubles", map[int][]string{100: {"s1", "s2"}, 200: {"s2"}}, 1},
		{"two people double", map[int][]string{100: {"s1", "s2"}, 200: {"s2", "s3"}}, 2},
		{"empty", map[int][]string{}, 0},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := countMultiQuestEnrollments(tc.sessionsByCMID); got != tc.want {
				t.Errorf("countMultiQuestEnrollments = %d, want %d", got, tc.want)
			}
		})
	}
}

// TestIsCountableQuestEnrollment pins the session-type filter on the multi-Quest
// tripwire. Without it the counter walked every attendees row for the year and
// counted ANY session, so a camper doing two summer sessions tripped a warning
// about Quest capacity: 201 (2026), 248 (2025) and 338 (2024) people would have
// warned, against a true count of 0 in every year. A tripwire that fires on
// every run is worse than none, because it teaches people to ignore it.
func TestIsCountableQuestEnrollment(t *testing.T) {
	t.Parallel()
	quest := map[string]bool{"qs1": true, "qs2": true}

	tests := []struct {
		name      string
		statusID  int
		sessionID string
		want      bool
	}{
		{"active quest session counts", statusIDActiveEnrolled, "qs1", true},
		{"a second quest session counts", statusIDActiveEnrolled, "qs2", true},
		{"a SUMMER session does not", statusIDActiveEnrolled, "summer1", false},
		{"cancelled quest does not", 8, "qs1", false},
		{"waitlisted quest does not", 32, "qs1", false},
		{"empty session id does not", statusIDActiveEnrolled, "", false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := isCountableQuestEnrollment(tc.statusID, tc.sessionID, quest); got != tc.want {
				t.Errorf("isCountableQuestEnrollment(%d, %q) = %v, want %v",
					tc.statusID, tc.sessionID, got, tc.want)
			}
		})
	}
}

// TestLoadQuestSessionIDsPinsTheSchemaIdentifiers is the coverage the scan of
// PR #2308 found missing. loadQuestSessionIDs filters in Go rather than in the
// query, which is deliberate -- but it makes a broken read indistinguishable
// from an empty one: rename the `session_type` field or change the enum value
// and GetString returns "" for every row, the Quest set is empty,
// isCountableQuestEnrollment refuses everything, and the tripwire goes
// permanently dark with a green suite. That is precisely the "silently never
// fires" mode the tripwire exists to avoid.
//
// This pins all four identifiers at once: the collection name `camp_sessions`,
// the field `session_type`, the literal value `quest`, and that a non-Quest
// session is excluded.
func TestLoadQuestSessionIDsPinsTheSchemaIdentifiers(t *testing.T) {
	t.Parallel()
	app, err := pbtests.NewTestApp()
	if err != nil {
		t.Fatal(err)
		return
	}
	defer app.Cleanup()

	col := core.NewBaseCollection("camp_sessions")
	col.Fields.Add(&core.TextField{Name: "session_type"})
	if saveErr := app.Save(col); saveErr != nil {
		t.Fatal(saveErr)
		return
	}

	save := func(sessionType string) string {
		r := core.NewRecord(col)
		r.Set("session_type", sessionType)
		if saveErr := app.Save(r); saveErr != nil {
			t.Fatal(saveErr)
		}
		return r.Id
	}
	questID := save(sessionTypeQuest)
	summerID := save(sessionTypeMain)

	s := &QuestRegistrationsSync{App: app}
	ids, err := s.loadQuestSessionIDs()
	if err != nil {
		t.Fatalf("loadQuestSessionIDs returned %v, want nil", err)
		return
	}

	if !ids[questID] {
		t.Error("quest session missing — check the collection name, the `session_type` field, and the `quest` value")
	}
	if ids[summerID] {
		t.Error("a non-Quest session was returned; the tripwire would fire on summer enrollments")
	}
	if len(ids) != 1 {
		t.Errorf("got %d session ids, want exactly 1", len(ids))
	}
}

// --- kindred#2257: adopt SkippedValues for mechanism-C -----------------------

// TestQuestLoadPersonCustomValuesCountsUnmappedFields pins the mechanism-C fix
// for kindred#2257: a Quest-*/Q-* field admitted by isQuestRegistrationField
// (the prefix test) but missing a case in MapQuestFieldToColumn used to be
// discarded by mapQuestFieldToRecord's `if column == "" { return }` with no
// counter and no log line, exactly like the sites already fixed at
// camper_transportation.go and staff_vehicle_info.go (kindred#2356/#2277).
// The record itself is still created -- this is a VALUE discard, not a record
// one, so it must land on Stats.SkippedValues, not Stats.Skipped.
func TestQuestLoadPersonCustomValuesCountsUnmappedFields(t *testing.T) {
	t.Parallel()
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

	const year = 2026
	// One routed field (must still work) and one field admitted by the
	// "Quest-" prefix that has no case in MapQuestFieldToColumn (simulates a
	// hypothetical new CampMinder Quest-* definition).
	addPersonCustomValue(t, app, "fd_routed", person.Id, "adventure", year)
	addPersonCustomValue(t, app, "fd_unmapped", person.Id, "unexpected value", year)

	fieldNameMap := map[string]string{
		"fd_routed":   "Q-Why come?",
		"fd_unmapped": "Quest-Space Camp Interest",
	}
	personHasAttendee := map[int]bool{8001: true}

	s := NewQuestRegistrationsSync(app)
	records, err := s.loadPersonCustomValues(context.Background(), year, fieldNameMap, personHasAttendee)
	if err != nil {
		t.Fatalf("loadPersonCustomValues: %v", err)
	}

	key := makeQuestRegistrationKey(8001, year)
	rec, ok := records[key]
	if !ok {
		t.Fatalf("no record for key %q; got %d records", key, len(records))
	}
	if rec.whyCome != "adventure" {
		t.Errorf("routed field was not written: whyCome = %q, want %q", rec.whyCome, "adventure")
	}

	if s.Stats.SkippedValues != 1 {
		t.Errorf("Stats.SkippedValues = %d, want 1 -- the unmapped Quest field is a discarded value, not a record",
			s.Stats.SkippedValues)
	}
	if s.Stats.Skipped != 0 {
		t.Errorf("Stats.Skipped = %d, want 0 -- a discarded field value is not a skipped record", s.Stats.Skipped)
	}
}

// TestAggregateQuestEntriesReturnsUnmappedCounts pins aggregateQuestEntries'
// second return value directly, at the pure-function level the rest of this
// file's kindred#2261 tests already use -- see the package comment on why the
// production aggregation, not a test-local reimplementation, must be driven.
func TestAggregateQuestEntriesReturnsUnmappedCounts(t *testing.T) {
	t.Parallel()
	entries := []questValueEntry{
		{personID: 100, fieldName: "Q-Why come?", value: "adventure"},
		{personID: 100, fieldName: "Quest-Space Camp Interest", value: "yes please"},
	}
	hasAttendee := map[int]bool{100: true}

	records, unmapped := aggregateQuestEntries(entries, 2026, hasAttendee)

	if len(records) != 1 {
		t.Fatalf("expected 1 record, got %d", len(records))
	}
	if got := records[makeQuestRegistrationKey(100, 2026)].whyCome; got != "adventure" {
		t.Errorf("whyCome = %q, want %q", got, "adventure")
	}
	if unmapped["Quest-Space Camp Interest"] != 1 {
		t.Errorf("unmapped[%q] = %d, want 1", "Quest-Space Camp Interest", unmapped["Quest-Space Camp Interest"])
	}
	if len(unmapped) != 1 {
		t.Errorf("unmapped has %d entries, want 1: %v", len(unmapped), unmapped)
	}
}
