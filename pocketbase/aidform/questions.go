package aidform

import (
	"fmt"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/camp/kindred/pocketbase/jotform"
)

// Question kinds, as the Forms API's question shapes reduce to them.
const (
	KindText      = "text"
	KindParagraph = "paragraph"
	KindChoice    = "choice"
	KindDate      = "date"
	KindOther     = "other"
)

// Question is one question of the form's definition.
type Question struct {
	QuestionID string   `json:"question_id"`
	Title      string   `json:"title"`
	Kind       string   `json:"kind"`
	Required   bool     `json:"required"`
	Options    []string `json:"options,omitempty"`
}

// Roles. Each is the aid_form_responses column the question's answer fills,
// so the stored question_map reads role (column) -> questionId.
const (
	RoleAgreementDate = "agreement_date"
	RoleName          = "name_typed"
	RoleProgram       = "program_choice"
	RoleBirthdate     = "birthdate_typed"
	RoleAsk           = "ask"
	RoleGross         = "total_gross_income"
	RoleGrossConfirm  = "income_confirmed"
	RoleAGI           = "total_adjusted_income"
	RoleExpected      = "expected_gross_income"
	RoleMortgage      = "total_housing_expenses"
	RoleSavings       = "non_retirement_savings"
	RoleRent          = "total_rent"
	RoleMedical       = "total_medical_expenses"
	RoleStudentLoan   = "student_debt"
	RoleCircumstances = "special_circumstances"
	RoleCounty        = "county"
	RoleUnemployment  = "unemployment"
	RoleGovSubsidies  = "gov_subsidies"
	RolePOC           = "poc"
	RoleRace          = "race_ethnicity"
	RoleChildren      = "num_children"
	RoleGender        = "gender_identity"
	RoleSignature     = "signature_typed"
)

// RequiredRoles are the roles without which a pull writes nothing (design §6):
// identity, the program, the ask, and the one income figure pricing leans on.
var RequiredRoles = []string{RoleName, RoleBirthdate, RoleProgram, RoleAsk, RoleGross}

// QuestionMap is role -> questionId.
type QuestionMap map[string]string

// titleWords is a normalised title: its words, and the words joined.
type titleWords struct {
	text  string
	words map[string]bool
}

func (w titleWords) has(words ...string) bool {
	for _, word := range words {
		if !w.words[word] {
			return false
		}
	}
	return true
}

func (w titleWords) phrase(p string) bool { return strings.Contains(" "+w.text+" ", " "+p+" ") }

func (w titleWords) none(words ...string) bool {
	for _, word := range words {
		if w.words[word] {
			return false
		}
	}
	return true
}

// roleRules decide, from a question's normalised title and kind, which role it
// is. Each is written against the words of the 2027 form, loosely enough that
// a reworded year still maps (the year numbers are never read), and each role
// must match exactly one question.
var roleRules = []struct {
	role  string
	match func(w titleWords, kind string) bool
}{
	{RoleAgreementDate, func(w titleWords, k string) bool { return w.has("agreement", "date") && w.none("signature") }},
	{RoleName, func(w titleWords, k string) bool {
		return w.has("name") && (w.has("first") || w.text == "name") && w.none("signature", "agreement")
	}},
	{RoleProgram, func(w titleWords, k string) bool { return k == KindChoice && w.has("program") }},
	{RoleBirthdate, func(w titleWords, k string) bool { return w.has("birthdate") || w.phrase("date of birth") }},
	{RoleAsk, func(w titleWords, k string) bool { return w.phrase("amount of assistance") }},
	{RoleGross, func(w titleWords, k string) bool {
		return w.has("gross", "income") && w.none("confirm", "adjusted", "expected")
	}},
	{RoleGrossConfirm, func(w titleWords, k string) bool { return w.has("confirm", "gross", "income") }},
	{RoleAGI, func(w titleWords, k string) bool { return w.has("adjusted", "gross", "income") }},
	{RoleExpected, func(w titleWords, k string) bool { return w.has("expected", "income") && w.none("confirm") }},
	{RoleMortgage, func(w titleWords, k string) bool { return w.has("mortgage") }},
	{RoleSavings, func(w titleWords, k string) bool { return w.has("savings") }},
	{RoleRent, func(w titleWords, k string) bool { return w.has("rent") && w.none("mortgage") }},
	{RoleMedical, func(w titleWords, k string) bool { return w.has("medical") }},
	{RoleStudentLoan, func(w titleWords, k string) bool { return w.has("student", "loan") }},
	{RoleCircumstances, func(w titleWords, k string) bool {
		return w.phrase("financial situation") || w.phrase("special circumstances")
	}},
	{RoleCounty, func(w titleWords, k string) bool { return w.text == "county" }},
	{RoleUnemployment, func(w titleWords, k string) bool { return w.has("unemployment") }},
	{RoleGovSubsidies, func(w titleWords, k string) bool { return w.has("subsidies") }},
	{RolePOC, func(w titleWords, k string) bool { return w.phrase("person of color") }},
	{RoleRace, func(w titleWords, k string) bool { return w.has("race") || w.has("ethnicity") }},
	{RoleChildren, func(w titleWords, k string) bool { return w.phrase("how many") && w.has("children") }},
	{RoleGender, func(w titleWords, k string) bool { return w.has("gender") }},
	{RoleSignature, func(w titleWords, k string) bool { return w.has("signature") }},
}

// MapQuestions finds each role's question by its normalised title. A role no
// question matches is left out; a role several questions match is left out
// and named in problems -- it is never a first match.
func MapQuestions(questions []Question) (QuestionMap, []string) {
	qm := QuestionMap{}
	var problems []string
	normalised := make([]titleWords, len(questions))
	for i, q := range questions {
		text := jotform.NormalizeWording(strings.ReplaceAll(q.Title, "’", "'"))
		words := map[string]bool{}
		for _, w := range strings.Fields(text) {
			words[w] = true
		}
		normalised[i] = titleWords{text: text, words: words}
	}
	for _, rule := range roleRules {
		var hits []string
		for i, q := range questions {
			if rule.match(normalised[i], q.Kind) {
				hits = append(hits, q.QuestionID)
			}
		}
		switch len(hits) {
		case 0:
		case 1:
			qm[rule.role] = hits[0]
		default:
			problems = append(problems, fmt.Sprintf("%s: %d questions match", rule.role, len(hits)))
		}
	}
	return qm, problems
}

// MissingRequired lists the required roles the map lacks, in RequiredRoles order.
func MissingRequired(qm QuestionMap) []string {
	var missing []string
	for _, role := range RequiredRoles {
		if qm[role] == "" {
			missing = append(missing, role)
		}
	}
	return missing
}

// Buckets, as aid requests name them.
const (
	BucketFamilyCamp   = "family_camp"
	BucketAdultWeekend = "adult_weekend"
)

// ChoiceBucket is the bucket a program choice asks in. A Family Camp weekend
// ("Family Camp N", "Prospective Families Weekend") is family_camp; every
// other weekend (Women's Weekend) is an adult weekend.
func ChoiceBucket(label string) string {
	folded := jotform.Fold(label)
	if strings.Contains(folded, "family camp") || strings.Contains(folded, "famil") {
		return BucketFamilyCamp
	}
	return BucketAdultWeekend
}

var choiceDates = regexp.MustCompile(`\(\s*([A-Za-z]+)\.?\s+(\d{1,2})\s*(?:-|–|—)`)

var months = map[string]time.Month{
	"jan": time.January, "feb": time.February, "mar": time.March, "apr": time.April, "may": time.May,
	"jun": time.June, "jul": time.July, "aug": time.August, "sep": time.September, "sept": time.September,
	"oct": time.October, "nov": time.November, "dec": time.December,
}

// ChoiceStartDate reads the weekend's first day out of a choice label
// ("Family Camp 1: Memorial Day Weekend (May 28- 31)" -> "2027-05-28"), or ""
// when the label carries no readable date. The year is the form's.
func ChoiceStartDate(label string, year int) string {
	m := choiceDates.FindStringSubmatch(label)
	if m == nil {
		return ""
	}
	name := strings.ToLower(m[1])
	month, ok := months[name]
	if !ok && len(name) > 3 {
		month, ok = months[name[:3]]
		// A full month name must be that month, not a word that starts like one.
		if ok && !strings.HasPrefix(strings.ToLower(month.String()), name) {
			ok = false
		}
	}
	if !ok {
		return ""
	}
	day, err := strconv.Atoi(m[2])
	if err != nil {
		return ""
	}
	date := time.Date(year, month, day, 0, 0, 0, 0, time.UTC)
	if date.Month() != month || date.Day() != day {
		return "" // February 30
	}
	return date.Format(time.DateOnly)
}

// SortedRoles returns the map's roles in a stable order, for messages.
func (qm QuestionMap) SortedRoles() []string {
	roles := make([]string, 0, len(qm))
	for role := range qm {
		roles = append(roles, role)
	}
	slices.Sort(roles)
	return roles
}
