package main

import (
	"os"
	"strings"
	"testing"
)

// IN-BUCKETS (owner 2026-10-28). The camper registration ask (CA-) and the adult-weekend one (WW-) shared two
// columns, first value wins, so one bucket's ask could hide the other's. This migration adds a column pair per
// program. Like the other migration tests here, it asserts on the FILE, because tests.NewTestApp() does not run JS
// migrations.
const faRegistrationAskByProgramMigration = "pb_migrations/1500000253_financial_aid_applications_ask_by_program.js"

func TestFARegistrationAskByProgramMigrationAddsTheFourColumns(t *testing.T) {
	up := readAidMigrationUp(t, faRegistrationAskByProgramMigration)
	for _, want := range []string{
		`findCollectionByNameOrId("financial_aid_applications")`,
		`new Field({ type: "bool", name: "camper_interest_expressed"`,
		`new Field({ type: "number", name: "camper_registration_request_amount", required: false, ` +
			`presentable: false, min: null, max: null, onlyInt: false })`,
		`new Field({ type: "bool", name: "adult_weekend_interest_expressed"`,
		`new Field({ type: "number", name: "adult_weekend_registration_request_amount", required: false, ` +
			`presentable: false, min: null, max: null, onlyInt: false })`,
	} {
		if !strings.Contains(up, want) {
			t.Errorf("up must contain %q", want)
		}
	}
	for _, never := range []string{"Rule =", "removeByName", "registration_request_amount\").name", "DELETE", "UPDATE"} {
		if strings.Contains(up, never) {
			t.Errorf("up must only add columns, never %q: the legacy pair stays as it is", never)
		}
	}
	raw, err := os.ReadFile(faRegistrationAskByProgramMigration)
	if err != nil {
		t.Fatal(err)
	}
	_, down, _ := strings.Cut(string(raw), "}, (app) => {")
	for _, want := range []string{
		`removeByName("camper_interest_expressed")`,
		`removeByName("camper_registration_request_amount")`,
		`removeByName("adult_weekend_interest_expressed")`,
		`removeByName("adult_weekend_registration_request_amount")`,
	} {
		if !strings.Contains(down, want) {
			t.Errorf("down must contain %q", want)
		}
	}
}
