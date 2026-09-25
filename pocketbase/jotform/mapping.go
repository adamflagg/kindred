package jotform

import (
	"fmt"
	"sort"
	"strings"
	"unicode"
)

// Roles is every field-map role, in display order. The API validates saves
// against its own copy (api/services/jotform_queue.py JOTFORM_ROLES).
var Roles = []string{
	RoleFirstName, RoleLastName, RoleNametag, RoleRespondentEmail,
	"bunking_request", "coming_with", "emergency_name", "emergency_phone", "emergency_email",
	"housing_accommodation", "accommodation_details", "cpap",
}

// Where a role's question came from, in trust order (kindred#2828).
const (
	SourceStaff   = "staff"   // staff saved it
	SourceCarried = "carried" // same wording as a role confirmed on an earlier year's form
	SourceGuessed = "guessed" // the wording rules below
)

// What staff should look at.
const (
	FlagWordingChanged = "wording_changed" // a staff role's question was reworded since the save
	FlagMissing        = "missing"         // a staff role's question is gone from the form
	FlagNeedsPick      = "needs_pick"      // nothing resolved the role
)

// RoleMeta records how one role was resolved. For a staff role, Text is the
// question's wording when staff SAVED it, which is what makes a later rewording
// detectable; for the others it is the current wording.
type RoleMeta struct {
	QuestionID string `json:"question_id"`
	Text       string `json:"text"`
	Source     string `json:"source,omitempty"`
	Flag       string `json:"flag,omitempty"`
}

// FieldMapMeta is jotform_forms.field_map_meta: role -> how it was resolved.
type FieldMapMeta map[string]RoleMeta

// ConfirmedWording is the wording of a role confirmed (by staff, or carried
// from a confirmation before that) on an earlier year's form.
type ConfirmedWording struct {
	Year int
	Role string
	Text string
}

// NormalizeWording folds case, accents, punctuation and spacing, so a question
// re-typed with a different comma still reads as the same question.
func NormalizeWording(s string) string {
	return strings.Join(strings.FieldsFunc(Fold(s), func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsNumber(r)
	}), " ")
}

// --- The wording rules --------------------------------------------------------
//
// Ported unchanged from the Python suggester, which it replaces (kindred#2828):
// same rules, same order. For each role the first question in form order that
// a rule accepts wins. Emergency questions are claimed by their own rules and
// excluded from the identity ones: a name role on the emergency-contact name
// would link submissions to the wrong guests.

func ruleText(q *FormQuestion) string {
	return strings.Join(strings.Fields(strings.ToLower(q.Text)), " ")
}

func emergency(q *FormQuestion) bool { return strings.Contains(ruleText(q), "emergency") }

type wordingRule struct {
	role  string
	match func(q *FormQuestion) bool
}

var wordingRules = []wordingRule{
	{"emergency_name", func(q *FormQuestion) bool { return emergency(q) && strings.Contains(ruleText(q), "name") }},
	{"emergency_phone", func(q *FormQuestion) bool { return emergency(q) && strings.Contains(ruleText(q), "phone") }},
	{"emergency_email", func(q *FormQuestion) bool { return emergency(q) && strings.Contains(ruleText(q), "email") }},
	{RoleNametag, func(q *FormQuestion) bool {
		t := ruleText(q)
		return strings.Contains(t, "nametag") || strings.Contains(t, "name tag")
	}},
	{RoleFirstName, func(q *FormQuestion) bool {
		return !emergency(q) && (strings.HasPrefix(ruleText(q), "first name") || q.Type == typeFullname)
	}},
	{RoleLastName, func(q *FormQuestion) bool {
		return !emergency(q) && (strings.HasPrefix(ruleText(q), "last name") || q.Type == typeFullname)
	}},
	{"bunking_request", func(q *FormQuestion) bool { return strings.Contains(ruleText(q), "bunking request") }},
	{"coming_with", func(q *FormQuestion) bool {
		t := ruleText(q)
		return strings.Contains(t, "coming") && strings.Contains(t, "with")
	}},
	{"housing_accommodation", func(q *FormQuestion) bool {
		return strings.Contains(ruleText(q), "housing accommodation")
	}},
	{"accommodation_details", func(q *FormQuestion) bool {
		t := ruleText(q)
		return strings.HasPrefix(t, "if yes, please comment") || strings.Contains(t, "live alone")
	}},
	{"cpap", func(q *FormQuestion) bool { return strings.Contains(ruleText(q), "cpap") }},
	{RoleRespondentEmail, func(q *FormQuestion) bool {
		return !emergency(q) && (q.Type == "control_email" || ruleText(q) == "email")
	}},
}

// SuggestFieldMap guesses role -> question id from the question wording.
func SuggestFieldMap(questions []FormQuestion) FieldMap {
	ordered := append([]FormQuestion(nil), questions...)
	SortQuestions(ordered)
	out := FieldMap{}
	for _, rule := range wordingRules {
		for i := range ordered {
			if rule.match(&ordered[i]) {
				out[rule.role] = ordered[i].QuestionID
				break
			}
		}
	}
	return out
}

// StaffRoles picks the staff-set roles out of a stored form: meta entries
// sourced staff (including a role staff cleared, which has no question), and
// any mapped role with no meta at all -- before kindred#2828 only staff wrote
// field_map, and no meta existed.
func StaffRoles(stored FieldMap, meta FieldMapMeta) FieldMapMeta {
	out := FieldMapMeta{}
	for role, m := range meta {
		if m.Source == SourceStaff {
			out[role] = m
		}
	}
	for role, qid := range stored {
		if _, known := meta[role]; !known && strings.TrimSpace(qid) != "" {
			out[role] = RoleMeta{QuestionID: strings.TrimSpace(qid), Source: SourceStaff}
		}
	}
	return out
}

// ResolveMapping decides every role's question, in trust order:
//
//  1. staff: kept while its question exists (flagged wording_changed if the
//     wording moved since the save); dropped and flagged missing once the
//     question is gone -- never silently repointed. A role staff cleared stays
//     unset.
//  2. carried: the question whose normalized wording equals the wording
//     confirmed for that role on an earlier year's form, most recent year first.
//  3. guessed: the wording rules.
//  4. otherwise unset, flagged needs_pick.
//
// It returns the effective map (what matching and the roster read) and the
// per-role meta. It is pure: carried and guessed roles are re-decided on every
// pull, so a question added or reworded mid-season is picked up.
func ResolveMapping(
	questions []FormQuestion, staff FieldMapMeta, history []ConfirmedWording,
) (FieldMap, FieldMapMeta) {
	ordered := append([]FormQuestion(nil), questions...)
	SortQuestions(ordered)
	byID := make(map[string]*FormQuestion, len(ordered))
	for i := range ordered {
		byID[ordered[i].QuestionID] = &ordered[i]
	}
	guesses := SuggestFieldMap(ordered)

	fm, meta := FieldMap{}, FieldMapMeta{}
	for _, role := range Roles {
		if s, ok := staff[role]; ok {
			m := RoleMeta{QuestionID: s.QuestionID, Text: s.Text, Source: SourceStaff}
			if q := byID[s.QuestionID]; q != nil {
				fm[role] = s.QuestionID
				switch {
				case strings.TrimSpace(s.Text) == "":
					m.Text = q.Text
				case NormalizeWording(s.Text) != NormalizeWording(q.Text):
					m.Flag = FlagWordingChanged
				}
			} else if s.QuestionID != "" {
				m.Flag = FlagMissing
			}
			meta[role] = m
			continue
		}
		if q := carriedQuestion(role, ordered, history); q != nil {
			fm[role] = q.QuestionID
			meta[role] = RoleMeta{QuestionID: q.QuestionID, Text: q.Text, Source: SourceCarried}
			continue
		}
		if q := byID[guesses[role]]; q != nil {
			fm[role] = q.QuestionID
			meta[role] = RoleMeta{QuestionID: q.QuestionID, Text: q.Text, Source: SourceGuessed}
			continue
		}
		meta[role] = RoleMeta{Flag: FlagNeedsPick}
	}
	return fm, meta
}

// carriedQuestion finds the first question (form order) whose wording equals
// one confirmed for role in the most recent earlier year that has a match.
func carriedQuestion(role string, ordered []FormQuestion, history []ConfirmedWording) *FormQuestion {
	byYear := map[int]map[string]bool{}
	for _, h := range history {
		w := NormalizeWording(h.Text)
		if h.Role != role || w == "" {
			continue
		}
		if byYear[h.Year] == nil {
			byYear[h.Year] = map[string]bool{}
		}
		byYear[h.Year][w] = true
	}
	years := make([]int, 0, len(byYear))
	for y := range byYear {
		years = append(years, y)
	}
	sort.Sort(sort.Reverse(sort.IntSlice(years)))
	for _, y := range years {
		for i := range ordered {
			if byYear[y][NormalizeWording(ordered[i].Text)] {
				return &ordered[i]
			}
		}
	}
	return nil
}

// Summary is the mapping part of the pull's status line.
func (m FieldMapMeta) Summary() string {
	var carried, guessed, staff, changed, missing, pick int
	for _, rm := range m {
		switch {
		case rm.Flag == FlagNeedsPick:
			pick++
		case rm.Flag == FlagMissing:
			missing++
		case rm.QuestionID == "":
			// staff chose no question
		case rm.Source == SourceCarried:
			carried++
		case rm.Source == SourceGuessed:
			guessed++
		case rm.Source == SourceStaff:
			staff++
			if rm.Flag == FlagWordingChanged {
				changed++
			}
		}
	}
	var parts []string
	for _, p := range []struct {
		n     int
		label string
	}{
		{carried, "same as last year"}, {guessed, "guessed"}, {staff, "set by staff"},
		{changed, "wording changed"}, {missing, "question removed"}, {pick, "needs a pick"},
	} {
		if p.n > 0 {
			parts = append(parts, fmt.Sprintf("%d %s", p.n, p.label))
		}
	}
	if len(parts) == 0 {
		return ""
	}
	return "mapping: " + strings.Join(parts, ", ")
}
