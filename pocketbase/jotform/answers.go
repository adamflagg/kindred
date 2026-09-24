package jotform

import (
	"bytes"
	"encoding/json"
	"sort"
	"strconv"
	"strings"
)

// Field-map roles the ingest reads. The full role list (bunking_request,
// coming_with, emergency_*, housing_accommodation, accommodation_details,
// cpap) is the API's concern; matching needs only these four.
const (
	RoleFirstName       = "first_name"
	RoleLastName        = "last_name"
	RoleNametag         = "nametag_name"
	RoleRespondentEmail = "respondent_email"
)

// AnswerRow is one answered question, stored generically in jotform_answers.
type AnswerRow struct {
	QuestionID   string
	QuestionText string
	QuestionType string
	AnswerText   string
	// AnswerJSON is the raw answer when it was not a plain string (full name,
	// address, checkbox); nil otherwise.
	AnswerJSON json.RawMessage
	Order      int
}

// FlattenAnswers keeps every ANSWERED question -- no allowlist (owner ruling
// 2026-09-24) -- and drops headers, dividers and blank answers.
func FlattenAnswers(answers map[string]Answer) []AnswerRow {
	rows := make([]AnswerRow, 0, len(answers))
	for qid, a := range answers {
		text, raw, ok := answerValue(&a)
		if !ok {
			continue
		}
		order, _ := strconv.Atoi(strings.TrimSpace(a.Order))
		rows = append(rows, AnswerRow{
			QuestionID: qid, QuestionText: a.Text, QuestionType: a.Type,
			AnswerText: text, AnswerJSON: raw, Order: order,
		})
	}
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].Order != rows[j].Order {
			return rows[i].Order < rows[j].Order
		}
		return rows[i].QuestionID < rows[j].QuestionID
	})
	return rows
}

func answerValue(a *Answer) (text string, raw json.RawMessage, ok bool) {
	trimmed := bytes.TrimSpace(a.Answer)
	if len(trimmed) == 0 || string(trimmed) == "null" {
		return "", nil, false
	}
	var s string
	if json.Unmarshal(trimmed, &s) == nil {
		s = strings.TrimSpace(s)
		return s, nil, s != ""
	}
	text = strings.TrimSpace(a.PrettyFormat)
	if text == "" {
		text = flattenJSONText(trimmed)
	}
	if text == "" {
		return "", nil, false
	}
	return text, json.RawMessage(append([]byte(nil), trimmed...)), true
}

// flattenJSONText renders a non-string answer as text when Jotform sent no
// prettyFormat: an array's strings joined with "; ", an object's string values
// in key order joined with " ".
func flattenJSONText(raw json.RawMessage) string {
	var list []any
	if json.Unmarshal(raw, &list) == nil {
		return joinStrings(list, "; ")
	}
	var obj map[string]any
	if json.Unmarshal(raw, &obj) == nil {
		keys := make([]string, 0, len(obj))
		for k := range obj {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		values := make([]any, 0, len(keys))
		for _, k := range keys {
			values = append(values, obj[k])
		}
		return joinStrings(values, " ")
	}
	return ""
}

func joinStrings(values []any, sep string) string {
	parts := make([]string, 0, len(values))
	for _, v := range values {
		if s, ok := v.(string); ok && strings.TrimSpace(s) != "" {
			parts = append(parts, strings.TrimSpace(s))
		}
	}
	return strings.Join(parts, sep)
}

// FieldMap maps a role to this form's question id (question ids change every
// year, so it is set per form in admin).
type FieldMap map[string]string

// HasIdentity reports whether the map can drive matching at all.
func (fm FieldMap) HasIdentity() bool {
	return strings.TrimSpace(fm[RoleFirstName]) != "" && strings.TrimSpace(fm[RoleLastName]) != ""
}

// Identity is who a submission says it is. Emergency-contact fields are
// deliberately absent: they must never drive a match (kindred#2759 -- 6 of 8
// emergency-contact hits named a DIFFERENT guest).
type Identity struct {
	First, Last, Nametag, Email string
}

// ExtractIdentity reads the identity roles. A first/last role pointing at a
// control_fullname question reads that answer's first/last part; otherwise it
// reads the answer text.
func ExtractIdentity(rows []AnswerRow, fm FieldMap) Identity {
	byQuestion := make(map[string]AnswerRow, len(rows))
	for _, r := range rows {
		byQuestion[r.QuestionID] = r
	}
	return Identity{
		First:   namePart(byQuestion, fm[RoleFirstName], "first"),
		Last:    namePart(byQuestion, fm[RoleLastName], "last"),
		Nametag: answerText(byQuestion, fm[RoleNametag]),
		Email:   answerText(byQuestion, fm[RoleRespondentEmail]),
	}
}

func answerText(byQuestion map[string]AnswerRow, qid string) string {
	if qid == "" {
		return ""
	}
	return strings.TrimSpace(byQuestion[qid].AnswerText)
}

func namePart(byQuestion map[string]AnswerRow, qid, part string) string {
	row, ok := byQuestion[qid]
	if qid == "" || !ok {
		return ""
	}
	if row.QuestionType == "control_fullname" && len(row.AnswerJSON) > 0 {
		var parts map[string]any
		if json.Unmarshal(row.AnswerJSON, &parts) == nil {
			if s, ok := parts[part].(string); ok {
				return strings.TrimSpace(s)
			}
			return ""
		}
	}
	return strings.TrimSpace(row.AnswerText)
}
