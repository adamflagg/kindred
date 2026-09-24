package jotform

import (
	"encoding/json"
	"testing"
)

func TestFlattenAnswersKeepsAnsweredQuestionsOnly(t *testing.T) {
	rows := FlattenAnswers(map[string]Answer{
		"2": {Order: "2", Text: "Housing", Type: "control_head"}, // header: no answer
		"4": {
			Order: "4", Text: "Name", Type: "control_fullname",
			Answer: json.RawMessage(`{"first":"Olivia","last":"Chen"}`), PrettyFormat: "Olivia Chen",
		},
		"9": {Order: "9", Text: "Nametag", Type: "control_textbox", Answer: json.RawMessage(`"  "`)}, // blank: dropped
		"16": {
			Order: "16", Text: "Who are you coming with?", Type: "control_checkbox",
			Answer: json.RawMessage(`["With Family","With Friends"]`),
		},
		"21": {
			Order: "21", Text: "Bunking request", Type: "control_textarea",
			Answer: json.RawMessage(`"Emma Johnson, Riley Sam"`),
		},
	})
	if len(rows) != 3 {
		t.Fatalf("got %d rows, want 3 (header and blank dropped): %+v", len(rows), rows)
	}
	if rows[0].QuestionID != "4" || rows[0].AnswerText != "Olivia Chen" ||
		string(rows[0].AnswerJSON) != `{"first":"Olivia","last":"Chen"}` {
		t.Errorf("fullname row = %+v", rows[0])
	}
	if rows[1].AnswerText != "With Family; With Friends" || rows[1].Order != 16 {
		t.Errorf("checkbox row with no prettyFormat must join its values: %+v", rows[1])
	}
	if rows[2].AnswerText != "Emma Johnson, Riley Sam" || rows[2].AnswerJSON != nil {
		t.Errorf("a plain string answer keeps no JSON: %+v", rows[2])
	}
}

func TestExtractIdentityReadsFullnamePartsOrSeparateQuestions(t *testing.T) {
	rows := FlattenAnswers(map[string]Answer{
		"4":  {Order: "4", Type: "control_fullname", Answer: json.RawMessage(`{"first":" Olivia ","last":"Chen"}`)},
		"5":  {Order: "5", Type: "control_textbox", Answer: json.RawMessage(`"Liv"`)},
		"40": {Order: "40", Type: "control_email", Answer: json.RawMessage(`"test@example.com"`)},
	})
	got := ExtractIdentity(rows, FieldMap{
		RoleFirstName: "4", RoleLastName: "4", RoleNametag: "5", RoleRespondentEmail: "40",
	})
	if got != (Identity{First: "Olivia", Last: "Chen", Nametag: "Liv", Email: "test@example.com"}) {
		t.Errorf("fullname identity = %+v", got)
	}

	split := FlattenAnswers(map[string]Answer{
		"3": {Order: "3", Type: "control_textbox", Answer: json.RawMessage(`"Emma"`)},
		"4": {Order: "4", Type: "control_textbox", Answer: json.RawMessage(`"Johnson"`)},
	})
	got = ExtractIdentity(split, FieldMap{RoleFirstName: "3", RoleLastName: "4"})
	if got.First != "Emma" || got.Last != "Johnson" {
		t.Errorf("separate-question identity = %+v", got)
	}
}

func TestFieldMapHasIdentityNeedsBothNames(t *testing.T) {
	if (FieldMap{RoleFirstName: "3"}).HasIdentity() {
		t.Error("a map without last_name cannot match")
	}
	if !(FieldMap{RoleFirstName: "3", RoleLastName: "3"}).HasIdentity() {
		t.Error("first and last on one fullname question is a complete identity")
	}
}
