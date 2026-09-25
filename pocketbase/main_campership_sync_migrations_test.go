package main

import (
	"regexp"
	"strings"
	"testing"
)

// Campership SP1 (design §6.1, §6.4). File-level assertions on the two schema migrations;
// Task 16 of the plan boots them for real. readMigration, migrationHalves and constValue
// live in main_lodging_write_in_occupant_index_test.go.
const (
	ftSeasonKeyMigration = "pb_migrations/1500000182_financial_transactions_raw_ids_season_key.js"
	faFixesMigration     = "pb_migrations/1500000183_financial_aid_applications_fixes.js"
)

var ruleAssignment = regexp.MustCompile(`\b(list|view|create|update|delete)Rule\b`)

func assertV023AndNoRules(t *testing.T, path, body string) {
	t.Helper()
	if strings.Contains(body, "options: {") {
		t.Errorf("%s: v0.23 silently ignores an options: {} wrapper", path)
	}
	if strings.Contains(body, "fields.push(") {
		t.Errorf("%s: fields.push does nothing; use fields.add(new Field(...))", path)
	}
	if m := ruleAssignment.FindString(body); m != "" {
		t.Errorf("%s touches %s -- collection rules belong to campership sub-project 2", path, m)
	}
}

func TestFinancialTransactionsMigrationKeysOnSeasonAndKeepsRawIDs(t *testing.T) {
	body := readMigration(t, ftSeasonKeyMigration)
	assertV023AndNoRules(t, ftSeasonKeyMigration, body)
	up, down := migrationHalves(t, body)

	const newUnique = "CREATE UNIQUE INDEX `idx_financial_transactions_cm_id_amount_year` " +
		"ON `financial_transactions` (`cm_id`, `amount`, `year`)"
	const oldUnique = "CREATE UNIQUE INDEX `idx_financial_transactions_cm_id_amount` " +
		"ON `financial_transactions` (`cm_id`, `amount`)"
	const categoryIndex = "CREATE INDEX `idx_financial_transactions_year_category_cm` " +
		"ON `financial_transactions` (`year`, `financial_category_cm_id`)"

	if !strings.Contains(constValue(t, body, "NEW_UNIQUE_SQL"), newUnique) {
		t.Errorf("NEW_UNIQUE_SQL must be %s", newUnique)
	}
	if !strings.Contains(constValue(t, body, "OLD_UNIQUE_SQL"), oldUnique) {
		t.Errorf("OLD_UNIQUE_SQL must be %s", oldUnique)
	}
	if !strings.Contains(constValue(t, body, "CATEGORY_SQL"), categoryIndex) {
		t.Errorf("CATEGORY_SQL must be %s", categoryIndex)
	}
	for _, want := range []string{
		"withoutIndex(collection, OLD_UNIQUE_NAME)", "indexes.push(NEW_UNIQUE_SQL)", "indexes.push(CATEGORY_SQL)",
	} {
		if !strings.Contains(up, want) {
			t.Errorf("up path must contain %s", want)
		}
	}
	if !strings.Contains(down, "indexes.push(OLD_UNIQUE_SQL)") || strings.Contains(down, "indexes.push(NEW_UNIQUE_SQL)") {
		t.Error("down path must restore OLD_UNIQUE_SQL and must not install the new index")
	}

	fields := constValue(t, body, "CM_ID_FIELDS")
	for _, f := range []string{"person_cm_id", "household_cm_id", "session_cm_id", "financial_category_cm_id"} {
		if !strings.Contains(fields, `"`+f+`"`) {
			t.Errorf("CM_ID_FIELDS must list %q (a fixed contract other sub-projects read)", f)
		}
	}
	numberField := regexp.MustCompile(`type: "number",\s*name: CM_ID_FIELDS\[i\],` +
		`[^}]*min: null,\s*max: null,\s*onlyInt: true`)
	if !numberField.MatchString(up) {
		t.Error("up path must add each CM_ID_FIELDS entry as an unbounded integer number field")
	}
	if !strings.Contains(down, "removeByName(CM_ID_FIELDS[i])") {
		t.Error("down path must remove the four fields")
	}
}

func TestFinancialAidApplicationsMigrationFixesTheColumns(t *testing.T) {
	body := readMigration(t, faFixesMigration)
	assertV023AndNoRules(t, faFixesMigration, body)
	up, down := migrationHalves(t, body)

	// 1. The rename, both directions, with its partial index following it.
	if !strings.Contains(up, `getByName("amount_awarded")`) ||
		!strings.Contains(up, `= "registration_request_amount"`) {
		t.Error("up path must rename amount_awarded to registration_request_amount in place")
	}
	if !strings.Contains(down, `getByName("registration_request_amount")`) ||
		!strings.Contains(down, `= "amount_awarded"`) {
		t.Error("down path must rename registration_request_amount back to amount_awarded")
	}
	const requestIndex = "CREATE INDEX `idx_fa_apps_registration_request` ON `financial_aid_applications` " +
		"(`year`, `registration_request_amount`) WHERE `registration_request_amount` > 0"
	if !strings.Contains(constValue(t, body, "REQUEST_INDEX_SQL"), requestIndex) {
		t.Errorf("REQUEST_INDEX_SQL must be %s", requestIndex)
	}
	if !strings.Contains(up, "withoutIndex(collection, AWARDED_INDEX_NAME)") ||
		!strings.Contains(up, "indexes.push(REQUEST_INDEX_SQL)") {
		t.Error("up path must drop idx_fa_apps_awarded before the rename and install the renamed index")
	}
	if !strings.Contains(down, "indexes.push(AWARDED_INDEX_SQL)") {
		t.Error("down path must restore idx_fa_apps_awarded")
	}

	// 2. income_confirmed: bool -> number. PocketBase refuses a type change on a field id,
	// so the bool is removed in one save and the number added in a second.
	if !strings.Contains(up, `removeByName("income_confirmed")`) {
		t.Error("up path must remove the bool income_confirmed")
	}
	if !regexp.MustCompile(`type: "number",\s*name: "income_confirmed"`).MatchString(up) {
		t.Error("up path must add income_confirmed back as a number")
	}
	if !regexp.MustCompile(`type: "bool",\s*name: "income_confirmed"`).MatchString(down) {
		t.Error("down path must restore income_confirmed as a bool")
	}
	for name, half := range map[string]string{"up": up, "down": down} {
		if strings.Count(half, "app.save(collection)") < 2 {
			t.Errorf("%s path must save twice (remove, then re-add with the other type)", name)
		}
	}

	// 3. Dead fields dropped on up, restored on down.
	for _, f := range []string{"amount_requested", "deposit_paid"} {
		if !strings.Contains(up, `removeByName("`+f+`")`) {
			t.Errorf("up path must drop %s", f)
		}
		if !strings.Contains(down, `name: "`+f+`"`) {
			t.Errorf("down path must restore %s", f)
		}
	}

	// 4, 5. New derived fields.
	if !regexp.MustCompile(`type: "bool",\s*name: "is_applicant"`).MatchString(up) {
		t.Error("up path must add is_applicant (bool)")
	}
	carryover := regexp.MustCompile(`type: "json",\s*name: "carryover_last_updated",` +
		`[^}]*maxSize: 10000`)
	if !carryover.MatchString(up) {
		t.Error("up path must add carryover_last_updated (json, maxSize 10000)")
	}
	const applicantIndex = "CREATE INDEX `idx_fa_apps_applicant` ON `financial_aid_applications` " +
		"(`year`, `is_applicant`) WHERE `is_applicant` = 1"
	if !strings.Contains(constValue(t, body, "APPLICANT_INDEX_SQL"), applicantIndex) {
		t.Errorf("APPLICANT_INDEX_SQL must be %s", applicantIndex)
	}
	for _, f := range []string{"is_applicant", "carryover_last_updated"} {
		if !strings.Contains(down, `removeByName("`+f+`")`) {
			t.Errorf("down path must remove %s", f)
		}
	}
}
