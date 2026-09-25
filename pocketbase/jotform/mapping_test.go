package jotform

import (
	"reflect"
	"testing"
)

// The 2026 adult forms' shape (wording paraphrased, ids fictional).
var questions2026Shape = []FormQuestion{
	{"3", "First Name", "control_textbox", 3},
	{"4", "Last Name", "control_textbox", 4},
	{"5", "Preferred name for your nametag (if different than above): ", "control_textbox", 5},
	{"10", "Emergency Contact: First and Last Name", "control_fullname", 10},
	{"12", "Emergency Contact: Phone Number ", "control_phone", 12},
	{"13", "Emergency Contact: Email", "control_email", 13},
	{"16", "Who are you coming to this program with? ", "control_checkbox", 16},
	{"21", "We can accommodate up to eight people per cabin. If you have a bunking request, please list " +
		"their first and last name(s) here (up to five people). ", "control_textarea", 21},
	{"22", "Our typical cabins are shared. Do you need special housing accommodation(s) for medical, " +
		"accessibility-related or personal reasons?", "control_radio", 22},
	{"23", "If yes, please comment below (ie: request to live alone, live close to the primary program area).",
		"control_textarea", 23},
	{"27", "If yes, please list the allergy and reaction: ", "control_textarea", 27},
	{"29", "Are you bringing a CPAP machine to Camp? ", "control_radio", 29},
	{"50", "Email", "control_email", 50},
}

// --- The wording rules, ported from the Python suggester (kindred#2828) ------

func TestSuggestFieldMapSuggestsEveryRoleFromThe2026Labels(t *testing.T) {
	want := FieldMap{
		"first_name": "3", "last_name": "4", "nametag_name": "5", "respondent_email": "50",
		"bunking_request": "21", "coming_with": "16", "emergency_name": "10", "emergency_phone": "12",
		"emergency_email": "13", "housing_accommodation": "22", "accommodation_details": "23", "cpap": "29",
	}
	if got := SuggestFieldMap(questions2026Shape); !reflect.DeepEqual(got, want) {
		t.Errorf("got  %v\nwant %v", got, want)
	}
}

func TestSuggestFieldMapLetsOneFullnameQuestionServeFirstAndLast(t *testing.T) {
	got := SuggestFieldMap([]FormQuestion{{"4", "Name", "control_fullname", 4}})
	if got["first_name"] != "4" || got["last_name"] != "4" {
		t.Errorf("got %v", got)
	}
}

func TestSuggestFieldMapSuggestsNothingUnrecognisable(t *testing.T) {
	if got := SuggestFieldMap([]FormQuestion{{"7", "Shirt size", "control_textbox", 7}}); len(got) != 0 {
		t.Errorf("got %v", got)
	}
}

func TestSuggestFieldMapFirstMatchByQuestionOrderWins(t *testing.T) {
	got := SuggestFieldMap([]FormQuestion{
		{"9", "First name (as it should appear on your badge)", "control_textbox", 9},
		{"2", "First name", "control_textbox", 2},
	})
	if got["first_name"] != "2" {
		t.Errorf("first_name = %q, want the earlier question 2", got["first_name"])
	}
}

func TestSuggestFieldMapNeverPutsAnIdentityRoleOnAnEmergencyQuestion(t *testing.T) {
	got := SuggestFieldMap([]FormQuestion{
		{"1", "Emergency contact name", "control_fullname", 1},
		{"2", "Emergency email", "control_email", 2},
	})
	if got["first_name"] != "" || got["last_name"] != "" || got["respondent_email"] != "" {
		t.Errorf("an emergency question claimed an identity role: %v", got)
	}
	if got["emergency_name"] != "1" || got["emergency_email"] != "2" {
		t.Errorf("emergency roles = %v", got)
	}
}

func TestNormalizeWordingFoldsCasePunctuationAndSpace(t *testing.T) {
	a := NormalizeWording("  Who are you coming to this program with? ")
	b := NormalizeWording("who are you coming to this program with")
	c := NormalizeWording("Who  are you coming — to this program, with?!")
	if a != b || b != c || a != "who are you coming to this program with" {
		t.Errorf("%q / %q / %q", a, b, c)
	}
	if NormalizeWording("First name") == NormalizeWording("Last name") {
		t.Error("different words must stay different")
	}
}

// --- Resolution tiers --------------------------------------------------------

func TestResolveKeepsAStaffRoleWhoseQuestionStillExists(t *testing.T) {
	staff := FieldMapMeta{"first_name": {QuestionID: "50", Text: "Email", Source: SourceStaff}}
	fm, meta := ResolveMapping(questions2026Shape, staff, nil)
	if fm["first_name"] != "50" {
		t.Errorf("a staff role must be kept even where a guess disagrees: %v", fm)
	}
	if meta["first_name"] != (RoleMeta{QuestionID: "50", Text: "Email", Source: SourceStaff}) {
		t.Errorf("meta = %+v", meta["first_name"])
	}
}

func TestResolveFlagsAStaffRoleWhoseWordingChangedButKeepsIt(t *testing.T) {
	staff := FieldMapMeta{"cpap": {QuestionID: "29", Text: "Do you use a CPAP?", Source: SourceStaff}}
	fm, meta := ResolveMapping(questions2026Shape, staff, nil)
	if fm["cpap"] != "29" {
		t.Errorf("the staff role must still be used: %v", fm)
	}
	got := meta["cpap"]
	if got.Source != SourceStaff || got.Flag != FlagWordingChanged || got.Text != "Do you use a CPAP?" {
		t.Errorf("meta = %+v; want staff, wording_changed, the save-time text kept", got)
	}
}

func TestResolveIgnoresPunctuationOnlyWordingEdits(t *testing.T) {
	staff := FieldMapMeta{"cpap": {QuestionID: "29", Text: "are you bringing a cpap machine to camp", Source: SourceStaff}}
	_, meta := ResolveMapping(questions2026Shape, staff, nil)
	if meta["cpap"].Flag != "" {
		t.Errorf("flag = %q, want none", meta["cpap"].Flag)
	}
}

func TestResolveDropsAStaffRoleWhoseQuestionWasRemovedAndNeverRepointsIt(t *testing.T) {
	staff := FieldMapMeta{"first_name": {QuestionID: "99", Text: "First Name", Source: SourceStaff}}
	fm, meta := ResolveMapping(questions2026Shape, staff, []ConfirmedWording{{2025, "first_name", "First Name"}})
	if _, ok := fm["first_name"]; ok {
		t.Errorf("a removed question must leave the role unset, not guessed or carried: %v", fm)
	}
	got := meta["first_name"]
	if got.Source != SourceStaff || got.Flag != FlagMissing || got.QuestionID != "99" {
		t.Errorf("meta = %+v", got)
	}
}

func TestResolveCarriesARoleByExactWordingFromAnEarlierYear(t *testing.T) {
	qs := []FormQuestion{
		{"31", "What name goes on your NAME-TAG?", "control_textbox", 3},
		{"32", "Anything else?", "control_textarea", 4},
	}
	history := []ConfirmedWording{{2025, "nametag_name", "what name goes on your name tag"}}
	fm, meta := ResolveMapping(qs, nil, history)
	if fm["nametag_name"] != "31" {
		t.Errorf("fm = %v", fm)
	}
	want := RoleMeta{QuestionID: "31", Text: "What name goes on your NAME-TAG?", Source: SourceCarried}
	if meta["nametag_name"] != want {
		t.Errorf("meta = %+v", meta["nametag_name"])
	}
}

func TestResolveCarryPrefersTheMostRecentYear(t *testing.T) {
	qs := []FormQuestion{
		{"1", "Who is your bunk buddy?", "control_textarea", 1},
		{"2", "Who would you like to room with?", "control_textarea", 2},
	}
	history := []ConfirmedWording{
		{2024, "bunking_request", "Who is your bunk buddy?"},
		{2025, "bunking_request", "Who would you like to room with?"},
	}
	fm, _ := ResolveMapping(qs, nil, history)
	if fm["bunking_request"] != "2" {
		t.Errorf("bunking_request = %q, want 2025's wording (question 2)", fm["bunking_request"])
	}
}

func TestResolveCarryOutranksAGuess(t *testing.T) {
	qs := []FormQuestion{
		{"1", "First name", "control_textbox", 1},
		{"2", "Given name", "control_textbox", 2},
	}
	fm, meta := ResolveMapping(qs, nil, []ConfirmedWording{{2025, "first_name", "Given name"}})
	if fm["first_name"] != "2" || meta["first_name"].Source != SourceCarried {
		t.Errorf("fm = %v meta = %+v", fm, meta["first_name"])
	}
}

func TestResolveGuessesFromTheWordingRulesAndFlagsTheRest(t *testing.T) {
	qs := []FormQuestion{{"4", "Name", "control_fullname", 4}, {"8", "Shirt size", "control_textbox", 8}}
	fm, meta := ResolveMapping(qs, nil, nil)
	if fm["first_name"] != "4" || fm["last_name"] != "4" {
		t.Errorf("fm = %v", fm)
	}
	if meta["first_name"] != (RoleMeta{QuestionID: "4", Text: "Name", Source: SourceGuessed}) {
		t.Errorf("meta = %+v", meta["first_name"])
	}
	if meta["cpap"] != (RoleMeta{Flag: FlagNeedsPick}) {
		t.Errorf("an unresolved role must be flagged needs_pick: %+v", meta["cpap"])
	}
	if len(meta) != len(Roles) {
		t.Errorf("meta has %d roles, want every role (%d)", len(meta), len(Roles))
	}
}

func TestResolveLeavesARoleStaffClearedUnsetAndUnflagged(t *testing.T) {
	staff := FieldMapMeta{"cpap": {Source: SourceStaff}}
	fm, meta := ResolveMapping(questions2026Shape, staff, nil)
	if _, ok := fm["cpap"]; ok {
		t.Errorf("staff chose no question; the guess must not refill it: %v", fm)
	}
	if meta["cpap"] != (RoleMeta{Source: SourceStaff}) {
		t.Errorf("meta = %+v", meta["cpap"])
	}
}

func TestResolveAdoptsTheCurrentWordingForAStaffRoleSavedWithoutOne(t *testing.T) {
	// A role saved before any question snapshot existed (the first save of a
	// new form, or a row mapped before kindred#2828) has no wording to compare.
	staff := FieldMapMeta{"cpap": {QuestionID: "29", Source: SourceStaff}}
	_, meta := ResolveMapping(questions2026Shape, staff, nil)
	want := RoleMeta{QuestionID: "29", Text: "Are you bringing a CPAP machine to Camp? ", Source: SourceStaff}
	if meta["cpap"] != want {
		t.Errorf("meta = %+v", meta["cpap"])
	}
}

func TestStaffRolesTreatsAMappedRoleWithNoMetaAsStaff(t *testing.T) {
	// Before kindred#2828 only staff wrote field_map, and no meta existed.
	stored := FieldMap{"first_name": "3", "cpap": "29", "bunking_request": "21"}
	meta := FieldMapMeta{
		"cpap":            {QuestionID: "29", Text: "CPAP?", Source: SourceGuessed},
		"bunking_request": {QuestionID: "21", Text: "Bunking", Source: SourceStaff},
		"coming_with":     {Source: SourceStaff},
		"nametag_name":    {Flag: FlagNeedsPick},
	}
	want := FieldMapMeta{
		"first_name":      {QuestionID: "3", Source: SourceStaff},
		"bunking_request": {QuestionID: "21", Text: "Bunking", Source: SourceStaff},
		"coming_with":     {Source: SourceStaff},
	}
	if got := StaffRoles(stored, meta); !reflect.DeepEqual(got, want) {
		t.Errorf("got  %+v\nwant %+v", got, want)
	}
}

// "set by staff" counts staff roles in effect: a removed question is counted
// as removed, and a role staff cleared is not mapped at all.
func TestMappingSummaryCountsSourcesAndFlags(t *testing.T) {
	meta := FieldMapMeta{
		"first_name":      {QuestionID: "3", Source: SourceCarried},
		"last_name":       {QuestionID: "4", Source: SourceCarried},
		"nametag_name":    {QuestionID: "5", Source: SourceGuessed},
		"bunking_request": {QuestionID: "21", Source: SourceStaff, Flag: FlagWordingChanged},
		"coming_with":     {QuestionID: "16", Source: SourceStaff, Flag: FlagMissing},
		"cpap":            {Flag: FlagNeedsPick},
		"emergency_name":  {Source: SourceStaff},
	}
	want := "mapping: 2 same as last year, 1 guessed, 1 set by staff, " +
		"1 wording changed, 1 question removed, 1 needs a pick"
	if got := meta.Summary(); got != want {
		t.Errorf("got  %q\nwant %q", got, want)
	}
	if (FieldMapMeta{}).Summary() != "" {
		t.Error("no roles, no summary")
	}
}
