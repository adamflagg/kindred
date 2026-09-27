package main

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

// Campership intake collections (sub-project 5). Like the other migration
// tests in this package, this asserts on the migration FILES, because
// tests.NewTestApp() does not run JS migrations. What a booted database carries
// is asserted by sub-project 2's aid_* null-rule test
// (pocketbase/rbac/financial_aid_rules_booted_test.go, which finds every aid_
// collection by prefix) in CI's Migrations & Schema Agreement job.
var aidIntakeMigrations = []struct {
	path        string
	collections []string
}{
	{"pb_migrations/1500000200_aid_applications.js", []string{"aid_applications"}},
	{"pb_migrations/1500000201_aid_requests.js", []string{"aid_requests"}},
	{"pb_migrations/1500000202_aid_application_corrections.js", []string{"aid_application_corrections"}},
	{"pb_migrations/1500000203_aid_session_reference.js", []string{"aid_session_capacity"}},
	{"pb_migrations/1500000204_aid_payer_shares.js", []string{"aid_payer_shares"}},
}

var aidRuleLine = regexp.MustCompile(`(listRule|viewRule|createRule|updateRule|deleteRule):\s*([^,\n]+)`)

func readAidMigrationUp(t *testing.T, path string) string {
	t.Helper()
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	up, _, found := strings.Cut(string(content), "}, (app) => {")
	if !found {
		t.Fatalf("%s: could not find the up/down boundary", path)
	}
	return up
}

func TestAidIntakeMigrationsLockEveryRule(t *testing.T) {
	for _, m := range aidIntakeMigrations {
		up := readAidMigrationUp(t, m.path)
		for _, name := range m.collections {
			if !strings.Contains(up, `name: "`+name+`"`) {
				t.Errorf("%s must create %s", m.path, name)
			}
		}
		rules := aidRuleLine.FindAllStringSubmatch(up, -1)
		if want := 5 * len(m.collections); len(rules) != want {
			t.Errorf("%s declares %d rules, want %d", m.path, len(rules), want)
		}
		for _, rule := range rules {
			if strings.TrimSpace(rule[2]) != "null" {
				t.Errorf("%s: %s = %s, want null (spec 14.3)", m.path, rule[1], rule[2])
			}
		}
		if strings.Contains(up, "options:") {
			t.Errorf("%s uses an options wrapper, which PocketBase v0.23 ignores silently", m.path)
		}
	}
}

func TestAidIntakeMigrationsDeclareTheirUniqueKeys(t *testing.T) {
	want := map[string][]string{
		"pb_migrations/1500000200_aid_applications.js": {
			"CREATE UNIQUE INDEX `idx_aid_applications_year_household` ON `aid_applications` (`year`, `household_cm_id`)",
		},
		"pb_migrations/1500000201_aid_requests.js": {
			"CREATE UNIQUE INDEX `idx_aid_requests_intake_key` ON `aid_requests` " +
				"(`year`, `household_cm_id`, `person_cm_id`, `program_key`, `program_option_key`)",
			"CREATE UNIQUE INDEX `idx_aid_requests_person_session` ON `aid_requests` " +
				"(`year`, `person_cm_id`, `session_cm_id`) " +
				"WHERE `person_cm_id` > 0 AND `session_cm_id` > 0 AND `status` = 'active'",
			"CREATE UNIQUE INDEX `idx_aid_requests_household_session` ON `aid_requests` " +
				"(`year`, `household_cm_id`, `session_cm_id`) " +
				"WHERE `person_cm_id` = 0 AND `session_cm_id` > 0 AND `status` = 'active'",
		},
		"pb_migrations/1500000203_aid_session_reference.js": {
			"CREATE UNIQUE INDEX `idx_aid_session_capacity_year_session` ON `aid_session_capacity` (`year`, `session_cm_id`)",
		},
		"pb_migrations/1500000204_aid_payer_shares.js": {
			"CREATE UNIQUE INDEX `idx_aid_payer_shares_request_household` ON `aid_payer_shares` " +
				"(`request`, `household_cm_id`)",
		},
	}
	for path, indexes := range want {
		up := readAidMigrationUp(t, path)
		for _, index := range indexes {
			if !strings.Contains(up, index) {
				t.Errorf("%s must declare:\n  %s", path, index)
			}
		}
	}
}

// Owner ruling 2026-09-25: a payer share is a percentage only. Dollars are computed from
// the current award when shown, never stored, so an appeal cannot leave a stale amount.
func TestAidPayerSharesStorePercentagesOnly(t *testing.T) {
	up := readAidMigrationUp(t, "pb_migrations/1500000204_aid_payer_shares.js")
	want := `{ type: "number", name: "share_pct", required: true, presentable: false, min: 0, max: 100, onlyInt: false }`
	if !strings.Contains(up, want) {
		t.Errorf("aid_payer_shares.share_pct must be a required number between 0 and 100:\n  %s", want)
	}
	for _, forbidden := range []string{`name: "share_amount"`, `name: "amount"`, `name: "dollars"`} {
		if strings.Contains(up, forbidden) {
			t.Errorf("aid_payer_shares must not store dollars (%s)", forbidden)
		}
	}
}

// A request's `created` is the only "requested on" date Kindred will ever have
// (spec 5, 9.1): FA answers keep no history. It must be set once and never
// rewritten by a rebuild or a staff edit.
func TestAidRequestsCreatedIsSetOnceAndNeverUpdated(t *testing.T) {
	up := readAidMigrationUp(t, "pb_migrations/1500000201_aid_requests.js")
	want := `{ type: "autodate", name: "created", required: false, presentable: false, onCreate: true, onUpdate: false }`
	if !strings.Contains(up, want) {
		t.Errorf("aid_requests.created must be an autodate with onCreate: true, onUpdate: false:\n  %s", want)
	}
}

// Spec 2 item 9 (owner ruling 2026-09-25): two requests for one session are
// always a duplicate. No payer or split-payer column may carve an exception out
// of the partial unique indexes.
func TestAidRequestsHaveNoSplitPayerExemption(t *testing.T) {
	up := readAidMigrationUp(t, "pb_migrations/1500000201_aid_requests.js")
	for _, forbidden := range []string{"split_payer", `name: "payer`, `name: "share`} {
		if strings.Contains(up, forbidden) {
			t.Errorf("aid_requests must not carry %q; payer shares live in aid_payer_shares", forbidden)
		}
	}
}

func TestReportedIncomeColumnIsAddedToTheMirror(t *testing.T) {
	up := readAidMigrationUp(t, "pb_migrations/1500000205_financial_aid_applications_reported_income.js")
	for _, want := range []string{
		`app.findCollectionByNameOrId("financial_aid_applications")`,
		`type: "json"`,
		`name: "reported_income_fields"`,
		"new Field(",
	} {
		if !strings.Contains(up, want) {
			t.Errorf("migration must contain %q", want)
		}
	}
	for _, forbidden := range []string{"Rule =", "Rule:", "options:"} {
		if strings.Contains(up, forbidden) {
			t.Errorf("migration must not contain %q: it adds one column and leaves SP2's rules alone", forbidden)
		}
	}
}

// Owner ruling 2026-09-27: a request's session comes from the camper's registration, never
// from a staff-entered option-text alias, so there is no alias table and the resolver's
// methods are the only non-staff values.
func TestAidSessionComesFromRegistrationNotAliases(t *testing.T) {
	content, err := os.ReadFile("pb_migrations/1500000203_aid_session_reference.js")
	if err != nil {
		t.Fatalf("read 1500000203: %v", err)
	}
	if strings.Contains(string(content), "aid_session_aliases") {
		t.Error("1500000203 must not create (or delete) aid_session_aliases")
	}
	up := readAidMigrationUp(t, "pb_migrations/1500000201_aid_requests.js")
	want := `{ type: "select", name: "session_resolution", required: true, presentable: false, ` +
		`values: ["enrollment", "enrollment_text", "staff", "unmatched"], maxSelect: 1 }`
	if !strings.Contains(up, want) {
		t.Errorf("aid_requests.session_resolution must be exactly:\n  %s", want)
	}
}
