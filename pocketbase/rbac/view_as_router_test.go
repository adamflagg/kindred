package rbac

import (
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/types"
)

// bunkingManageRule is the shape of the real bunking.manage rules
// (e.g. migration 1500000077).
const bunkingManageRule = `@request.auth.is_admin = true || @request.auth.cached_permissions ~ "bunking.manage"`

const viewAsEmail = "riley@example.com"

// newViewAsTestApp is newAuthTestApp plus three things to observe the persona
// through: a bunking.manage-gated list with one row, a row in the admin-only
// solver_runs list, and a config collection so guardConfigWrite runs.
func newViewAsTestApp(t testing.TB) *tests.TestApp {
	t.Helper()
	app := newAuthTestApp(t, testAdminGroup)

	probe := core.NewBaseCollection("probe_bunking")
	probe.Fields.Add(&core.TextField{Name: "label"})
	probe.ListRule = types.Pointer(bunkingManageRule)
	mustSave(t, app, probe)
	mustSave(t, app, core.NewRecord(probe))

	solverRuns, err := app.FindCollectionByNameOrId("solver_runs")
	if err != nil {
		t.Fatalf("find solver_runs: %v", err)
	}
	mustSave(t, app, core.NewRecord(solverRuns))

	config := core.NewBaseCollection("config")
	config.Fields.Add(&core.TextField{Name: "key"})
	config.Fields.Add(&core.JSONField{Name: "metadata", MaxSize: 2000000})
	config.CreateRule = types.Pointer(authedRule)
	mustSave(t, app, config)
	return app
}

// TestViewAsMiddleware drives PocketBase's real router: collection rules and
// request hooks must see the persona, and nothing about it may persist.
func TestViewAsMiddleware(t *testing.T) {
	headers := map[string]string{}
	factory := func(t testing.TB) *tests.TestApp {
		clear(headers)
		return newViewAsTestApp(t)
	}
	// asUser creates the caller in BeforeTestFunc, when the scenario's app exists.
	asUser := func(isAdmin bool, perms []string, viewAs string) func(testing.TB, *tests.TestApp, *core.ServeEvent) {
		return func(t testing.TB, app *tests.TestApp, _ *core.ServeEvent) {
			authAs(t, headers, createUser(t, app, viewAsEmail, isAdmin, perms))
			if viewAs != "" {
				headers[ViewAsHeader] = viewAs
			}
		}
	}
	const listProbe = "/api/collections/probe_bunking/records"
	const listSolverRuns = "/api/collections/solver_runs/records"
	regBody := `{"key":"reg_dates","metadata":{"business_category":"registration"}}`

	scenarios := []tests.ApiScenario{
		{
			Name: "admin without a persona sees bunking data", Method: http.MethodGet, URL: listProbe,
			TestAppFactory: factory, BeforeTestFunc: asUser(true, nil, ""), Headers: headers,
			ExpectedStatus: http.StatusOK, ExpectedContent: []string{`"totalItems":1`},
		},
		{
			Name: "admin previewing bunking.manage still sees bunking data", Method: http.MethodGet, URL: listProbe,
			TestAppFactory: factory, BeforeTestFunc: asUser(true, nil, "bunking.manage"), Headers: headers,
			ExpectedStatus: http.StatusOK, ExpectedContent: []string{`"totalItems":1`},
		},
		{
			Name: "admin previewing Registrar loses bunking data", Method: http.MethodGet, URL: listProbe,
			TestAppFactory: factory, BeforeTestFunc: asUser(true, nil, "registration.manage,metrics.geo"), Headers: headers,
			ExpectedStatus: http.StatusOK, ExpectedContent: []string{`"totalItems":0`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				stand, err := app.FindRecordById("users", viewAsPersonaID([]string{"metrics.geo", "registration.manage"}))
				if err != nil {
					t.Fatalf("the Registrar stand-in was not created: %v", err)
				}
				assertAccess(t, stand, false, []string{"metrics.geo", "registration.manage"})
				assertAccess(t, findUser(t, app, viewAsEmail), true, nil)
			},
		},
		{
			Name: "admin previewing No role loses bunking data", Method: http.MethodGet, URL: listProbe,
			TestAppFactory: factory, BeforeTestFunc: asUser(true, nil, "none"), Headers: headers,
			ExpectedStatus: http.StatusOK, ExpectedContent: []string{`"totalItems":0`},
		},
		{
			Name: "a persona drops is_admin: the admin-only list goes empty", Method: http.MethodGet, URL: listSolverRuns,
			TestAppFactory: factory, BeforeTestFunc: asUser(true, nil, "bunking.manage"), Headers: headers,
			ExpectedStatus: http.StatusOK, ExpectedContent: []string{`"totalItems":0`},
		},
		{
			Name: "non-admin header is inert: no self-downgrade", Method: http.MethodGet, URL: listProbe,
			TestAppFactory: factory, BeforeTestFunc: asUser(false, []string{"bunking.manage"}, "none"), Headers: headers,
			ExpectedStatus: http.StatusOK, ExpectedContent: []string{`"totalItems":1`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				if n := len(personaUsers(t, app)); n != 0 {
					t.Errorf("a stand-in was created for a caller whose header must be inert (%d rows)", n)
				}
			},
		},
		{
			Name: "non-admin header is inert: no escalation", Method: http.MethodGet, URL: listProbe,
			TestAppFactory: factory, BeforeTestFunc: asUser(false, nil, "bunking.manage"), Headers: headers,
			ExpectedStatus: http.StatusOK, ExpectedContent: []string{`"totalItems":0`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				if n := len(personaUsers(t, app)); n != 0 {
					t.Errorf("a stand-in was created for a caller whose header must be inert (%d rows)", n)
				}
			},
		},
		{
			Name: "superuser with a header is untouched", Method: http.MethodGet, URL: listSolverRuns,
			TestAppFactory: factory, Headers: headers,
			BeforeTestFunc: func(t testing.TB, app *tests.TestApp, _ *core.ServeEvent) {
				authAs(t, headers, createSuperuser(t, app))
				headers[ViewAsHeader] = "none"
			},
			ExpectedStatus: http.StatusOK, ExpectedContent: []string{`"totalItems":1`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				if n := len(personaUsers(t, app)); n != 0 {
					t.Errorf("a stand-in was created for a caller whose header must be inert (%d rows)", n)
				}
			},
		},
		{
			// The exit invariant: authRefresh returns e.Auth as the record, and the
			// SDK stores it. A downgraded record here would erase is_admin from the
			// tab and hide the switcher.
			Name: "auth-refresh ignores the persona", Method: http.MethodPost,
			URL:            "/api/collections/users/auth-refresh",
			TestAppFactory: factory, BeforeTestFunc: asUser(true, nil, "none"), Headers: headers,
			ExpectedStatus: http.StatusOK, ExpectedContent: []string{`"is_admin":true`},
		},
		{
			Name: "auth-refresh by collection id ignores the persona", Method: http.MethodPost,
			URL:            "/api/collections/_pb_users_auth_/auth-refresh",
			TestAppFactory: factory, BeforeTestFunc: asUser(true, nil, "none"), Headers: headers,
			ExpectedStatus: http.StatusOK, ExpectedContent: []string{`"is_admin":true`},
		},
		{
			// With the persona stand-in, a "none" preview correctly loses
			// bunking data too (is_admin=false, cached_permissions=[] on the
			// stand-in row), same as "admin previewing No role loses bunking
			// data" above. What this scenario tests is narrower: the request
			// runs AS the stand-in, but the REAL admin's own stored record is
			// never written. assertAccess below reads the DB-persisted row
			// directly and confirms is_admin/cached_permissions are exactly
			// what they were before the request.
			Name: "a previewed request leaves the stored record untouched", Method: http.MethodGet, URL: listProbe,
			TestAppFactory: factory, BeforeTestFunc: asUser(true, []string{"sheets.export"}, "none"), Headers: headers,
			ExpectedStatus: http.StatusOK, ExpectedContent: []string{`"totalItems":0`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				assertAccess(t, findUser(t, app, viewAsEmail), true, []string{"sheets.export"})
			},
		},
		{
			Name: "config write guard follows the persona", Method: http.MethodPost,
			URL: "/api/collections/config/records", Body: strings.NewReader(regBody),
			TestAppFactory: factory, BeforeTestFunc: asUser(true, nil, "none"), Headers: headers,
			ExpectedStatus: http.StatusForbidden, ExpectedContent: []string{"Missing registration.manage permission"},
		},
		{
			Name: "config write guard: admin without a persona may write", Method: http.MethodPost,
			URL: "/api/collections/config/records", Body: strings.NewReader(regBody),
			TestAppFactory: factory, BeforeTestFunc: asUser(true, nil, ""), Headers: headers,
			ExpectedStatus: http.StatusOK, ExpectedContent: []string{`"key":"reg_dates"`},
		},
	}
	for _, s := range scenarios {
		s.Test(t)
	}
}
