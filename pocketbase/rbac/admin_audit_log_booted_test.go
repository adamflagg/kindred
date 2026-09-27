package rbac

import (
	"bytes"
	"encoding/json"
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"

	"github.com/camp/kindred/pocketbase/audit"
	"github.com/camp/kindred/pocketbase/audit/audittest"
)

// These run only in CI's "Booted auth rules agreement" step, against the
// database the REAL pb_migrations produced (newBootedTestApp skips elsewhere).
// Add each name to that step's TESTS list in .github/workflows/ci.yml.

// fieldShape is the part of a field definition both the migration and the Go
// mirror must agree on.
func fieldShape(t testing.TB, f core.Field) map[string]any {
	t.Helper()
	raw, err := json.Marshal(f)
	if err != nil {
		t.Fatalf("marshal field %s: %v", f.GetName(), err)
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("unmarshal field %s: %v", f.GetName(), err)
	}
	delete(m, "id") // generated per save
	delete(m, "presentable")
	return m
}

// TestBootedAdminAuditLogMatchesTheGoMirror: the Go tests build the collection
// from audittest.Collection(); this proves that mirror is the migration.
func TestBootedAdminAuditLogMatchesTheGoMirror(t *testing.T) {
	app := newBootedTestApp(t)
	defer app.Cleanup()

	booted, err := app.FindCollectionByNameOrId(audit.CollectionName)
	if err != nil {
		t.Fatalf("the migrations did not create %s: %v", audit.CollectionName, err)
	}
	for name, rule := range map[string]*string{
		"listRule": booted.ListRule, "viewRule": booted.ViewRule, "createRule": booted.CreateRule,
		"updateRule": booted.UpdateRule, "deleteRule": booted.DeleteRule,
	} {
		if rule != nil {
			t.Errorf("%s = %q, want null (superusers only; \"\" would be PUBLIC)", name, *rule)
		}
	}
	mirror := audittest.Collection()
	if got, want := booted.Fields.FieldNames(), mirror.Fields.FieldNames(); !slices.Equal(
		slices.Sorted(slices.Values(got)), slices.Sorted(slices.Values(want))) {
		t.Fatalf("booted fields %v, Go mirror %v", got, want)
	}
	for _, f := range mirror.Fields {
		b, m := fieldShape(t, booted.Fields.GetByName(f.GetName())), fieldShape(t, f)
		bj, _ := json.Marshal(b)
		mj, _ := json.Marshal(m)
		if !bytes.Equal(bj, mj) {
			t.Errorf("field %s: migration %s, Go mirror %s", f.GetName(), bj, mj)
		}
	}
	gotIdx, wantIdx := slices.Sorted(slices.Values(booted.Indexes)), slices.Sorted(slices.Values(mirror.Indexes))
	if !slices.Equal(gotIdx, wantIdx) {
		t.Errorf("indexes: migration %v, Go mirror %v", gotIdx, wantIdx)
	}
}

// TestBootedAdminAuditLogIsAtomicAndAppendOnly: on the real schema and real
// rules, a logged write commits with its row, a failing audit write rolls the
// change back, and a Go save of an entry is refused.
func TestBootedAdminAuditLogIsAtomicAndAppendOnly(t *testing.T) {
	headers := map[string]string{}
	factory := func(t testing.TB) *tests.TestApp {
		clear(headers)
		app := newBootedTestApp(t)
		audit.Register(app, audit.Config{ServiceEmail: audittest.ServiceEmail})
		superusers, err := app.FindCollectionByNameOrId(core.CollectionNameSuperusers)
		if err != nil {
			t.Fatalf("find superusers: %v", err)
		}
		su := core.NewRecord(superusers)
		su.SetEmail("owner@example.com")
		su.SetPassword("correct-horse-battery-staple")
		mustSave(t, app, su)
		authAs(t, headers, su)
		return app
	}
	body := `{"name":"Audit Probe","slug":"audit-probe","permissions":["metrics.geo"]}`
	scenarios := []tests.ApiScenario{
		{
			Name: "a role created by a superuser commits with one Roles row", Method: http.MethodPost,
			URL: "/api/collections/roles/records", Body: strings.NewReader(body),
			TestAppFactory: factory, Headers: headers,
			ExpectedStatus: 200, ExpectedContent: []string{`"slug":"audit-probe"`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				rows := audittest.RowsOfType(t, app, audit.TypeRoles)
				if len(rows) != 1 || rows[0].GetString("target_label") != "Audit Probe" {
					t.Fatalf("roles rows = %d, want 1 for the role Audit Probe", len(rows))
				}
				rows[0].Set("action", "tampered")
				if err := app.Save(rows[0]); err == nil {
					t.Fatal("a Go save changed an audit entry on the booted schema")
				}
			},
		},
		{
			Name: "a failing audit write rolls the role back", Method: http.MethodPost,
			URL: "/api/collections/roles/records", Body: strings.NewReader(body),
			TestAppFactory: factory,
			BeforeTestFunc: func(t testing.TB, app *tests.TestApp, _ *core.ServeEvent) {
				col, err := app.FindCollectionByNameOrId(audit.CollectionName)
				if err != nil {
					t.Fatalf("find audit log: %v", err)
				}
				if err := app.Delete(col); err != nil {
					t.Fatalf("drop audit log: %v", err)
				}
			},
			Headers: headers, ExpectedStatus: 500, ExpectedContent: []string{"admin audit log could not record it"},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				if _, err := app.FindFirstRecordByData("roles", "slug", "audit-probe"); err == nil {
					t.Fatal("the role survived a failed audit write")
				}
			},
		},
	}
	for _, s := range scenarios {
		s.Test(t)
	}
}
