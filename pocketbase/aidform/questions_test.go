package aidform

import (
	"slices"
	"testing"
)

// liveFormQuestions is the 2027 form's question list, as the Forms API returns
// it (titles verbatim, ids fictional). Section headers carry no question.
func liveFormQuestions() []Question {
	text := func(id, title string, required bool) Question {
		return Question{QuestionID: id, Title: title, Kind: KindText, Required: required}
	}
	return []Question{
		{QuestionID: "q00", Title: "Applicant Agreement Date", Kind: KindDate, Required: true},
		text("q01", "Name (First and Last):", true),
		{QuestionID: "q02", Title: "Program", Kind: KindChoice, Required: true, Options: []string{
			"Family Camp 1: Memorial Day Weekend (May 28- 31)",
			"Women's Weekend (October 14 - 17)",
		}},
		{QuestionID: "q03", Title: "Birthdate", Kind: KindDate, Required: true},
		text("q04", "Amount of Assistance Requested", true),
		text("q06", "Total 2026 Gross Pre-Tax Household Income:", true),
		text("q07", "Confirm Total 2026 Gross Pre-Tax Household Income:", true),
		text("q08", "Total 2026 Adjusted Gross Income", true),
		text("q09", "Total 2027 Expected Pre-Tax Household Income:", true),
		text("q10", "If you own a home, fill in how much your total 2027 mortgage expense is. "+
			"If you do not own a home, please leave blank.", false),
		text("q11", "Total 2027 Estimated Funds in savings and investment accounts (include all checking, "+
			"savings, stocks, securities, mutual funds, crypto, etc.) Sept 2026 or most recent end quarter. "+
			"Exclude IRAs and 401k/403b/457 retirement accounts.", true),
		text("q12", "If rent a home, apartment, condo, etc., fill in how much your total 2027 rent expense is. "+
			"If you do not rent a home, apartment, condo, etc., please leave blank.", false),
		text("q13", "Total 2027 Expected Out of Pocket Medical Expenses (note - this also includes any "+
			"expenses associated with outside services for children with special needs)", true),
		text("q14", "Total 2027 Student Loan Repayment Expenses (note - this does NOT include any tuition "+
			"or school fees you may pay)", true),
		{QuestionID: "q16", Title: "Please include anything in the space below that you think would be " +
			"important for us to know about your family’s financial situation.", Kind: KindParagraph},
		text("q17", "County", true),
		{QuestionID: "q18", Title: "Have you experienced unemployment within the last two years and/or are " +
			"you currently unemployed?", Kind: KindChoice, Required: true, Options: []string{"Yes", "No"}},
		{QuestionID: "q19", Title: "OPTIONAL - Is your family receiving any form of government subsidies " +
			"such as SSI, food stamps, housing assistance, etc.?", Kind: KindChoice, Options: []string{"Yes", "No"}},
		{QuestionID: "q20", Title: "Do you identify as a person of color?", Kind: KindChoice, Required: true},
		text("q21", "What race/ethnicity best describes you?", false),
		text("q22", "How many total children and/or dependents live in your household?", true),
		{QuestionID: "q23", Title: "Gender Identity", Kind: KindChoice, Required: true},
		text("q24", "Applicant Agreement Signature", true),
	}
}

func TestMapQuestionsFindsEveryRoleOnTheLiveForm(t *testing.T) {
	t.Parallel()
	qm, problems := MapQuestions(liveFormQuestions())
	if len(problems) != 0 {
		t.Fatalf("problems = %v, want none", problems)
	}
	want := QuestionMap{
		RoleAgreementDate: "q00", RoleName: "q01", RoleProgram: "q02", RoleBirthdate: "q03", RoleAsk: "q04",
		RoleGross: "q06", RoleGrossConfirm: "q07", RoleAGI: "q08", RoleExpected: "q09", RoleMortgage: "q10",
		RoleSavings: "q11", RoleRent: "q12", RoleMedical: "q13", RoleStudentLoan: "q14",
		RoleCircumstances: "q16", RoleCounty: "q17", RoleUnemployment: "q18", RoleGovSubsidies: "q19",
		RolePOC: "q20", RoleRace: "q21", RoleChildren: "q22", RoleGender: "q23", RoleSignature: "q24",
	}
	for role, qid := range want {
		if qm[role] != qid {
			t.Errorf("%s -> %q, want %q", role, qm[role], qid)
		}
	}
	if len(qm) != len(want) {
		t.Errorf("mapped %d roles, want %d: %v", len(qm), len(want), qm)
	}
	if missing := MissingRequired(qm); len(missing) != 0 {
		t.Errorf("MissingRequired = %v, want none", missing)
	}
}

// A reworded form (or next year's copy) that loses a required role must be
// refused, never guessed: the pull writes nothing and says why (§6).
func TestMapQuestionsReportsAMissingRequiredRole(t *testing.T) {
	t.Parallel()
	qs := slices.DeleteFunc(liveFormQuestions(), func(q Question) bool { return q.QuestionID == "q04" })
	qm, _ := MapQuestions(qs)
	if got := MissingRequired(qm); !slices.Equal(got, []string{RoleAsk}) {
		t.Errorf("MissingRequired = %v, want [%s]", got, RoleAsk)
	}
}

// Two questions that both read as one role map that role to neither.
func TestMapQuestionsRefusesAnAmbiguousRole(t *testing.T) {
	t.Parallel()
	qs := append(liveFormQuestions(), Question{QuestionID: "q99", Title: "Birthdate", Kind: KindDate})
	qm, problems := MapQuestions(qs)
	if _, ok := qm[RoleBirthdate]; ok {
		t.Errorf("an ambiguous birthdate mapped to %q", qm[RoleBirthdate])
	}
	if !slices.Contains(problems, "birthdate_typed: 2 questions match") {
		t.Errorf("problems = %v, want the ambiguity named", problems)
	}
	if got := MissingRequired(qm); !slices.Equal(got, []string{RoleBirthdate}) {
		t.Errorf("MissingRequired = %v", got)
	}
}

// The program must be a choice question: a text question titled "Program"
// cannot be mapped to a weekend.
func TestMapQuestionsRequiresTheProgramToBeAChoice(t *testing.T) {
	t.Parallel()
	qs := liveFormQuestions()
	for i := range qs {
		if qs[i].QuestionID == "q02" {
			qs[i].Kind = KindText
		}
	}
	qm, _ := MapQuestions(qs)
	if _, ok := qm[RoleProgram]; ok {
		t.Error("a text question mapped as the program")
	}
}

func TestChoiceStartDate(t *testing.T) {
	t.Parallel()
	cases := []struct {
		label string
		want  string
	}{
		{"Family Camp 1: Memorial Day Weekend (May 28- 31)", "2027-05-28"},
		{"Family Camp 2: Keshet LGBTQ+ Weekend (August 19 - 22)", "2027-08-19"},
		{"Family Camp 3 (August 26 - 29)", "2027-08-26"},
		{"Family Camp 4: Labor Day Weekend (September 3 - 6)", "2027-09-03"},
		{"Prospective Families Weekend (September 24 - 26)", "2027-09-24"},
		{"Women's Weekend (October 14 - 17)", "2027-10-14"},
		{"Some Weekend (Sept 30 - Oct 3)", "2027-09-30"},
		{"Some Weekend (Aug. 5–8)", "2027-08-05"},
		{"Family Camp 9", ""},
		{"Family Camp 9 (Smarch 3 - 6)", ""},
		{"Family Camp 9 (February 30 - 31)", ""},
	}
	for _, tc := range cases {
		if got := ChoiceStartDate(tc.label, 2027); got != tc.want {
			t.Errorf("ChoiceStartDate(%q) = %q, want %q", tc.label, got, tc.want)
		}
	}
}

func TestChoiceBucket(t *testing.T) {
	t.Parallel()
	cases := map[string]string{
		"Family Camp 1: Memorial Day Weekend (May 28- 31)":                   BucketFamilyCamp,
		"Family Camp 5: Jewish Families of Color Weekend (September 9 - 12)": BucketFamilyCamp,
		"Prospective Families Weekend (September 24 - 26)":                   BucketFamilyCamp,
		"Women's Weekend (October 14 - 17)":                                  BucketAdultWeekend,
		"Womens Weekend (October 14 - 17)":                                   BucketAdultWeekend,
		"Men's Weekend (October 21 - 24)":                                    BucketAdultWeekend,
	}
	for label, want := range cases {
		if got := ChoiceBucket(label); got != want {
			t.Errorf("ChoiceBucket(%q) = %q, want %q", label, got, want)
		}
	}
}
