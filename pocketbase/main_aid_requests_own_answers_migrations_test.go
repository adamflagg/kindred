package main

import (
	"os"
	"strings"
	"testing"
)

// The adult aid Google Form's requests (adult-aid form design, PR 2): aid_requests' own answer
// set and Mark Reviewed fields, and aid_form_responses' ignored by / at. Asserted on the FILE, as
// the other aid migration tests are (tests.NewTestApp() runs no JS migrations).
const aidRequestsOwnAnswersMigration = "pb_migrations/1500000256_aid_requests_own_answers.js"

func TestAidRequestsOwnAnswersMigrationDeclaresItsFields(t *testing.T) {
	up := readAidMigrationUp(t, aidRequestsOwnAnswersMigration)
	if strings.Contains(up, "options:") {
		t.Error("uses an options wrapper, which PocketBase v0.23 ignores silently")
	}
	if strings.Contains(up, "Rule") {
		t.Error("must not touch a rule: both collections stay locked (all five null)")
	}
	line := func(name string) string {
		for _, l := range strings.Split(up, "\n") {
			if strings.Contains(l, `name: "`+name+`"`) {
				return l
			}
		}
		t.Fatalf("no %s field", name)
		return ""
	}
	want := map[string][]string{
		"answers":                 {`type: "json"`, "maxSize: 20000"},
		"answers_source":          {`type: "select"`, `values: ["google_form"]`, "maxSelect: 1", "required: false"},
		"form_response_id":        {`type: "text"`, "max: 200"},
		"form_submitted_at":       {`type: "text"`, "max: 40"},
		"form_change_reviewed":    {`type: "text"`, "max: 300"},
		"form_change_reviewed_by": {`type: "text"`, "max: 200"},
		"form_change_reviewed_at": {`type: "date"`},
		"ignored_by":              {`type: "text"`, "max: 200"},
		"ignored_at":              {`type: "date"`},
	}
	for name, parts := range want {
		got := line(name)
		for _, part := range parts {
			if !strings.Contains(got, part) {
				t.Errorf("%s must declare %q: %s", name, part, got)
			}
		}
		if strings.Contains(got, "required: true") {
			t.Errorf("%s must be optional: every existing row has none", name)
		}
	}
	raw, err := os.ReadFile(aidRequestsOwnAnswersMigration)
	if err != nil {
		t.Fatal(err)
	}
	_, down, _ := strings.Cut(string(raw), "}, (app) => {")
	for name := range want {
		if !strings.Contains(down, `"`+name+`"`) {
			t.Errorf("down must remove %s", name)
		}
	}
}
