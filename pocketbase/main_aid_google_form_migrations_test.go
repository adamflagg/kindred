package main

import (
	"os"
	"strings"
	"testing"
)

// The adult aid Google Form mirror (adult-aid form design, PR 1). Like the other aid migration
// tests this asserts on the migration FILE, because tests.NewTestApp() does not run JS
// migrations; pocketbase/rbac/financial_aid_rules_booted_test.go checks the booted rules in CI
// (every aid_ collection, by prefix), and sync/aid_google_form_responses_test.go holds the
// column list to the job's own fixture.
const aidGoogleFormMigration = "pb_migrations/1500000255_aid_google_form.js"

func TestAidGoogleFormMigrationLocksEveryRule(t *testing.T) {
	up := readAidMigrationUp(t, aidGoogleFormMigration)
	for _, name := range []string{"aid_google_forms", "aid_form_responses"} {
		if !strings.Contains(up, `name: "`+name+`"`) {
			t.Errorf("must create %s with a literal name", name)
		}
	}
	rules := aidRuleLine.FindAllStringSubmatch(up, -1)
	if len(rules) != 10 {
		t.Errorf("declares %d rules, want 10 (five per collection)", len(rules))
	}
	for _, rule := range rules {
		if strings.TrimSpace(rule[2]) != "null" {
			t.Errorf("%s = %s, want null (locked, superuser-only)", rule[1], rule[2])
		}
	}
	if strings.Contains(up, "options:") {
		t.Error("uses an options wrapper, which PocketBase v0.23 ignores silently")
	}
	if strings.Contains(up, `type: "relation"`) {
		t.Error("cross-table links are CampMinder ids, never PocketBase relations")
	}
}

func TestAidGoogleFormMigrationDeclaresItsShape(t *testing.T) {
	up := readAidMigrationUp(t, aidGoogleFormMigration)
	_, responses, ok := strings.Cut(up, `name: "aid_form_responses"`)
	if !ok {
		t.Fatal("no aid_form_responses")
	}
	forms, _, _ := strings.Cut(up, `name: "aid_form_responses"`)
	fieldIn := func(part, name string) string {
		for _, line := range strings.Split(part, "\n") {
			if strings.Contains(line, `name: "`+name+`"`) {
				return line
			}
		}
		t.Fatalf("no %s field", name)
		return ""
	}
	for _, part := range []string{forms, responses} {
		line := fieldIn(part, "year")
		for _, want := range []string{"required: true", "min: 2010", "max: 2100", "onlyInt: true"} {
			if !strings.Contains(line, want) {
				t.Errorf("year must declare %q: %s", want, line)
			}
		}
	}
	for _, name := range []string{"weekend_session_cm_id", "registered_session_cm_id", "person_cm_id", "household_cm_id"} {
		if line := fieldIn(responses, name); !strings.Contains(line, `type: "number"`) ||
			!strings.Contains(line, "max: null") || strings.Contains(line, "required: true") {
			t.Errorf("%s must be an optional unbounded CampMinder id (0 = unset): %s", name, line)
		}
	}
	// The answer columns are financial_aid_applications' own names and types.
	for _, name := range []string{
		"total_gross_income", "income_confirmed", "total_adjusted_income", "expected_gross_income",
		"total_housing_expenses", "non_retirement_savings", "total_rent", "total_medical_expenses", "student_debt",
		"ask",
	} {
		if line := fieldIn(responses, name); !strings.Contains(line, `type: "number"`) ||
			!strings.Contains(line, "min: null, max: null") {
			t.Errorf("%s must be an unbounded number (max 0 would reject every figure): %s", name, line)
		}
	}
	if line := fieldIn(responses, "num_children"); !strings.Contains(line, "min: 0, max: 50, onlyInt: true") {
		t.Errorf("num_children must match the FA mirror's 0..50 integer: %s", line)
	}
	for _, name := range []string{"unemployment", "gov_subsidies"} {
		if line := fieldIn(responses, name); !strings.Contains(line, `type: "bool"`) {
			t.Errorf("%s must be a bool, as on the FA mirror: %s", name, line)
		}
	}
	for _, name := range []string{"reported_income_fields", "parse_notes", "match_candidates"} {
		if line := fieldIn(responses, name); !strings.Contains(line, `type: "json"`) || !strings.Contains(line, "maxSize:") {
			t.Errorf("%s must be json with an explicit maxSize: %s", name, line)
		}
	}
	for _, idx := range []string{
		"CREATE UNIQUE INDEX `idx_aid_google_forms_year` ON `aid_google_forms` (`year`)",
		"CREATE UNIQUE INDEX `idx_aid_form_responses_response_id` ON `aid_form_responses` (`response_id`)",
		"CREATE INDEX `idx_aid_form_responses_year_match_status` ON `aid_form_responses` (`year`, `match_status`)",
		"CREATE INDEX `idx_aid_form_responses_year_person` ON `aid_form_responses` (`year`, `person_cm_id`)",
		"CREATE INDEX `idx_aid_form_responses_year_household` ON `aid_form_responses` (`year`, `household_cm_id`)",
	} {
		if !strings.Contains(up, idx) {
			t.Errorf("missing index: %s", idx)
		}
	}
	raw, err := os.ReadFile(aidGoogleFormMigration)
	if err != nil {
		t.Fatal(err)
	}
	_, down, _ := strings.Cut(string(raw), "}, (app) => {")
	for _, name := range []string{"aid_form_responses", "aid_google_forms"} {
		if !strings.Contains(down, `app.delete(app.findCollectionByNameOrId("`+name+`"))`) {
			t.Errorf("down must delete %s", name)
		}
	}
}

// The form id and the responder URL are the camp's live aid form: env-only, never in a public file.
func TestAidGoogleFormMigrationNamesNoForm(t *testing.T) {
	raw, err := os.ReadFile(aidGoogleFormMigration)
	if err != nil {
		t.Fatal(err)
	}
	for _, leak := range []string{"docs.google.com", "forms/d/", "viewform", "1FAIpQL"} {
		if strings.Contains(string(raw), leak) {
			t.Errorf("the migration carries %q: a form id or URL belongs in AID_GOOGLE_FORM_IDS only", leak)
		}
	}
}
