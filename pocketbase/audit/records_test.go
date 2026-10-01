package audit_test

import (
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"

	"github.com/camp/kindred/pocketbase/audit"
	"github.com/camp/kindred/pocketbase/audit/audittest"
)

const (
	samID       = "sampatel0000001"
	registrar   = "roleregistrar01"
	cfgSolver   = "cfgsolvermaxcab"
	cabin14     = "unitcabin140001"
	userRoleSam = "userrolesam0001"
	financeRole = "rolefinance0001"
	taylorID    = "usertaylor00001"
	passphrase  = "a-very-secret-passphrase"
)

// seed is the state every record scenario starts from: the admin, a bunking
// staff member, the owner's superuser, the service superuser, one person, one
// role, one config row and one lodging unit. All saved in Go, so none is logged.
func seed(t testing.TB, app core.App) map[string]*core.Record {
	t.Helper()
	people := map[string]*core.Record{
		"admin":   createUser(t, app, "", adminEmail, "Alex Rivera", true, nil),
		"staff":   createUser(t, app, "", staffEmail, "Jordan Lee", false, []string{"bunking.manage"}),
		"owner":   createSuperuser(t, app, ownerEmail),
		"service": createSuperuser(t, app, audittest.ServiceEmail),
	}
	createUser(t, app, samID, "sam.patel@example.com", "Sam Patel", false, nil)
	saveRecord(t, app, "roles", registrar, map[string]any{
		"name": "Registrar", "permissions": []string{"financial_aid.view"},
	})
	saveRecord(t, app, "config", cfgSolver, map[string]any{
		"category": "solver", "config_key": "max_cabin_size", "value": 12,
	})
	saveRecord(t, app, "lodging_units", cabin14, map[string]any{"name": "Cabin 14", "code": "cabin-14", "beds": 8})
	return people
}

func onlyRow(t testing.TB, app core.App, entryType string) *core.Record {
	t.Helper()
	rows := audittest.RowsOfType(t, app, entryType)
	if len(rows) != 1 || len(audittest.Rows(t, app)) != 1 {
		t.Fatalf("want exactly one %s row and nothing else, got %d of %d rows",
			entryType, len(rows), len(audittest.Rows(t, app)))
	}
	return rows[0]
}

func expectNoRows(t testing.TB, app core.App) {
	t.Helper()
	if rows := audittest.Rows(t, app); len(rows) != 0 {
		t.Fatalf("want no audit rows, got %d (first: %s)", len(rows), audittest.Dump(t, rows[0]))
	}
}

func expect(t testing.TB, row *core.Record, want map[string]string) {
	t.Helper()
	for field, value := range want {
		if got := row.GetString(field); got != value {
			t.Errorf("%s = %q, want %q", field, got, value)
		}
	}
}

func TestRecordWritesAreAudited(t *testing.T) {
	headers := map[string]string{}
	var people map[string]*core.Record
	factory := func(t testing.TB) *tests.TestApp {
		clear(headers)
		app := newApp(t)
		people = seed(t, app)
		return app
	}
	as := func(who string) func(testing.TB, *tests.TestApp, *core.ServeEvent) {
		return func(t testing.TB, _ *tests.TestApp, _ *core.ServeEvent) { authAs(t, headers, people[who]) }
	}

	scenarios := []tests.ApiScenario{
		{
			Name: "an admin creating a role writes one Roles row", Method: http.MethodPost,
			URL:            "/api/collections/roles/records",
			Body:           strings.NewReader(`{"name":"Finance","permissions":["financial_aid.view","financial_aid.rules"]}`),
			TestAppFactory: factory, BeforeTestFunc: as("admin"), Headers: headers,
			ExpectedStatus: 200, ExpectedContent: []string{`"name":"Finance"`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				row := onlyRow(t, app, audit.TypeRoles)
				expect(t, row, map[string]string{
					"action": "create", "actor_kind": "user", "actor_email": adminEmail, "actor_name": "Alex Rivera",
					"collection": "roles", "target_label": "Finance", "fields": "name permissions",
				})
				if row.GetString("ip") == "" || row.GetString("record_id") == "" {
					t.Error("ip and record_id must be recorded")
				}
				if after := audittest.JSON(t, row, "after"); after["name"] != "Finance" {
					t.Errorf("after = %v", after)
				}
				if before := audittest.JSON(t, row, "before"); before != nil {
					t.Errorf("a create has no before, got %v", before)
				}
			},
		},
		{
			Name: "a permission description override is labeled by its codename", Method: http.MethodPost,
			URL:            "/api/collections/permission_descriptions/records",
			Body:           strings.NewReader(`{"codename":"financial_aid.view","description":"See aid awards"}`),
			TestAppFactory: factory, BeforeTestFunc: as("admin"), Headers: headers,
			ExpectedStatus: 200, ExpectedContent: []string{`"codename":"financial_aid.view"`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				row := onlyRow(t, app, audit.TypeRoles)
				expect(t, row, map[string]string{
					"collection": "permission_descriptions", "action": "create", "target_label": "financial_aid.view",
				})
			},
		},
		{
			Name: "a role assignment is Access and names the person and the role", Method: http.MethodPost,
			URL:            "/api/collections/user_roles/records",
			Body:           strings.NewReader(`{"user":"` + samID + `","role":"` + registrar + `"}`),
			TestAppFactory: factory, BeforeTestFunc: as("admin"), Headers: headers,
			ExpectedStatus: 200, ExpectedContent: []string{`"role":"` + registrar + `"`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				row := onlyRow(t, app, audit.TypeAccess)
				expect(t, row, map[string]string{"collection": "user_roles", "target_label": "Sam Patel", "action": "create"})
				if detail := audittest.JSON(t, row, "detail"); detail["role"] != "Registrar" {
					t.Errorf("detail = %v, want the role's name", detail)
				}
			},
		},
		{
			Name: "removing a role is Access", Method: http.MethodDelete,
			URL: "/api/collections/user_roles/records/" + userRoleSam,
			TestAppFactory: func(t testing.TB) *tests.TestApp {
				app := factory(t)
				saveRecord(t, app, "user_roles", userRoleSam, map[string]any{"user": samID, "role": registrar})
				return app
			},
			BeforeTestFunc: as("admin"), Headers: headers,
			ExpectedStatus: 204,
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				row := onlyRow(t, app, audit.TypeAccess)
				expect(t, row, map[string]string{"collection": "user_roles", "action": "delete", "target_label": "Sam Patel"})
				if before := audittest.JSON(t, row, "before"); before == nil {
					t.Errorf("before = %v, want the removed assignment", before)
				}
			},
		},
		{
			Name:   "a role-assignment UPDATE names the old and new role, and the old and new user",
			Method: http.MethodPatch,
			URL:    "/api/collections/user_roles/records/" + userRoleSam,
			Body:   strings.NewReader(`{"user":"` + taylorID + `","role":"` + financeRole + `"}`),
			TestAppFactory: func(t testing.TB) *tests.TestApp {
				app := factory(t)
				createUser(t, app, taylorID, "taylor.kim@example.com", "Taylor Kim", false, nil)
				saveRecord(t, app, "roles", financeRole, map[string]any{
					"name": "Finance", "permissions": []string{"financial_aid.view"},
				})
				saveRecord(t, app, "user_roles", userRoleSam, map[string]any{"user": samID, "role": registrar})
				return app
			},
			BeforeTestFunc: as("owner"), Headers: headers,
			ExpectedStatus: 200, ExpectedContent: []string{`"role":"` + financeRole + `"`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				row := onlyRow(t, app, audit.TypeAccess)
				expect(t, row, map[string]string{"collection": "user_roles", "action": "update"})
				detail := audittest.JSON(t, row, "detail")
				if detail["role"] != "Finance" || detail["role_before"] != "Registrar" {
					t.Errorf("role detail = %v, want role=Finance role_before=Registrar", detail)
				}
				if detail["user"] != "Taylor Kim" || detail["user_before"] != "Sam Patel" {
					t.Errorf("user detail = %v, want user=Taylor Kim user_before=Sam Patel", detail)
				}
			},
		},
		{
			Name: "a superuser granting admin is Access, not PB Admin", Method: http.MethodPatch,
			URL:            "/api/collections/users/records/" + samID,
			Body:           strings.NewReader(`{"is_admin":true}`),
			TestAppFactory: factory, BeforeTestFunc: as("owner"), Headers: headers,
			ExpectedStatus: 200, ExpectedContent: []string{`"is_admin":true`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				row := onlyRow(t, app, audit.TypeAccess)
				expect(t, row, map[string]string{
					"action": "update", "actor_kind": "superuser", "actor_email": ownerEmail,
					"target_label": "Sam Patel", "fields": "is_admin",
				})
				b, a := audittest.JSON(t, row, "before"), audittest.JSON(t, row, "after")
				if b["is_admin"] != false || a["is_admin"] != true {
					t.Errorf("before=%v after=%v", b, a)
				}
			},
		},
		{
			Name: "a new superuser is Access and its password is never stored", Method: http.MethodPost,
			URL: "/api/collections/_superusers/records",
			Body: strings.NewReader(`{"email":"second.admin@example.com","password":"` + passphrase +
				`","passwordConfirm":"` + passphrase + `"}`),
			TestAppFactory: factory, BeforeTestFunc: as("owner"), Headers: headers,
			ExpectedStatus: 200, ExpectedContent: []string{`"email":"second.admin@example.com"`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				row := onlyRow(t, app, audit.TypeAccess)
				expect(t, row, map[string]string{"collection": "_superusers", "target_label": "second.admin@example.com"})
				dump := audittest.Dump(t, row)
				for _, secret := range []string{passphrase, "$2a$"} {
					if strings.Contains(dump, secret) {
						t.Fatalf("%q reached the audit row: %s", secret, dump)
					}
				}
				after := audittest.JSON(t, row, "after")
				if after["password"] != audit.RedactedValue || after["tokenKey"] != audit.RedactedValue {
					t.Errorf("after = %v, want password and tokenKey redacted", after)
				}
			},
		},
		{
			Name: "an admin editing a config row is Settings", Method: http.MethodPatch,
			URL:            "/api/collections/config/records/" + cfgSolver,
			Body:           strings.NewReader(`{"value":14}`),
			TestAppFactory: factory, BeforeTestFunc: as("admin"), Headers: headers,
			ExpectedStatus: 200, ExpectedContent: []string{`"value":14`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				row := onlyRow(t, app, audit.TypeSettings)
				expect(t, row, map[string]string{"target_label": "solver.max_cabin_size", "fields": "value"})
				b, a := audittest.JSON(t, row, "before"), audittest.JSON(t, row, "after")
				if b["value"] != 12.0 || a["value"] != 14.0 {
					t.Errorf("before=%v after=%v", b, a)
				}
			},
		},
		{
			Name: "bunking staff editing a lodging unit is Settings", Method: http.MethodPatch,
			URL:            "/api/collections/lodging_units/records/" + cabin14,
			Body:           strings.NewReader(`{"beds":10}`),
			TestAppFactory: factory, BeforeTestFunc: as("staff"), Headers: headers,
			ExpectedStatus: 200, ExpectedContent: []string{`"beds":10`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				expect(t, onlyRow(t, app, audit.TypeSettings), map[string]string{
					"target_label": "Cabin 14", "actor_email": staffEmail, "fields": "beds",
				})
			},
		},
		{
			Name: "bunking work is not logged", Method: http.MethodPost,
			URL: "/api/collections/bunk_requests/records", Body: strings.NewReader(`{"status":"pending"}`),
			TestAppFactory: factory, BeforeTestFunc: as("staff"), Headers: headers,
			ExpectedStatus: 200, ExpectedContent: []string{`"status":"pending"`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) { expectNoRows(t, app) },
		},
		{
			Name: "a superuser touching bunking data is PB Admin", Method: http.MethodPost,
			URL: "/api/collections/bunk_requests/records", Body: strings.NewReader(`{"status":"pending"}`),
			TestAppFactory: factory, BeforeTestFunc: as("owner"), Headers: headers,
			ExpectedStatus: 200, ExpectedContent: []string{`"status":"pending"`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				expect(t, onlyRow(t, app, audit.TypePBAdmin), map[string]string{"collection": "bunk_requests", "action": "create"})
			},
		},
		{
			Name: "Kindred's service account is never logged", Method: http.MethodPatch,
			URL:            "/api/collections/config/records/" + cfgSolver,
			Body:           strings.NewReader(`{"value":15}`),
			TestAppFactory: factory, BeforeTestFunc: as("service"), Headers: headers,
			ExpectedStatus: 200, ExpectedContent: []string{`"value":15`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) { expectNoRows(t, app) },
		},
		{
			Name: "a save that changes nothing writes nothing", Method: http.MethodPatch,
			URL:            "/api/collections/config/records/" + cfgSolver,
			Body:           strings.NewReader(`{"value":12}`),
			TestAppFactory: factory, BeforeTestFunc: as("admin"), Headers: headers,
			ExpectedStatus: 200, ExpectedContent: []string{`"value":12`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) { expectNoRows(t, app) },
		},
		{
			Name: "a delete keeps the full before", Method: http.MethodDelete,
			URL:            "/api/collections/roles/records/" + registrar,
			TestAppFactory: factory, BeforeTestFunc: as("admin"), Headers: headers,
			ExpectedStatus: 204,
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				row := onlyRow(t, app, audit.TypeRoles)
				expect(t, row, map[string]string{"action": "delete", "target_label": "Registrar"})
				if before := audittest.JSON(t, row, "before"); before["name"] != "Registrar" || before["permissions"] == nil {
					t.Errorf("before = %v, want the whole role", before)
				}
			},
		},
		{
			// Fail closed (spec §4.1). The collection is dropped in Go, so the
			// audit write fails inside the request's transaction.
			Name: "a failing audit write rolls the change back", Method: http.MethodPost,
			URL:            "/api/collections/roles/records",
			Body:           strings.NewReader(`{"name":"Development","permissions":["financial_aid.summary"]}`),
			TestAppFactory: factory,
			BeforeTestFunc: func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
				as("admin")(t, app, e)
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
				if rows, _ := app.FindAllRecords("roles"); len(rows) != 1 {
					t.Fatalf("roles = %d, want only the seeded one: the create must roll back", len(rows))
				}
			},
		},
	}
	for _, s := range scenarios {
		s.Test(t)
	}
}

// TestAMissingServiceEmailLogsEverySuperuser: with POCKETBASE_ADMIN_EMAIL blank,
// no account is the service, so even the would-be service is logged (spec §3).
func TestAMissingServiceEmailLogsEverySuperuser(t *testing.T) {
	headers := map[string]string{}
	scenario := tests.ApiScenario{
		Name: "no service email: the service superuser's config write is PB Admin", Method: http.MethodPatch,
		URL: "/api/collections/config/records/" + cfgSolver, Body: strings.NewReader(`{"value":16}`),
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			app := newAppWith(t, audit.Config{})
			authAs(t, headers, seed(t, app)["service"])
			return app
		},
		Headers: headers, ExpectedStatus: 200, ExpectedContent: []string{`"value":16`},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			expect(t, onlyRow(t, app, audit.TypePBAdmin), map[string]string{"actor_email": audittest.ServiceEmail})
		},
	}
	scenario.Test(t)
}
