package rbac

import (
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/auth"
	"github.com/pocketbase/pocketbase/tools/types"
)

// bunkingManageRule is the shape of the real bunking.manage rules
// (e.g. migration 1500000077).
const bunkingManageRule = `@request.auth.is_admin = true || @request.auth.cached_permissions ~ "bunking.manage"`

const viewAsEmail = "riley@example.com"

// newViewAsTestApp is newAuthTestApp plus three things to observe the persona
// through: a bunking.manage-gated list (and create) with one row, a row in
// the admin-only solver_runs list, and a config collection so
// guardConfigWrite runs.
func newViewAsTestApp(t testing.TB) *tests.TestApp {
	t.Helper()
	app := newAuthTestApp(t, testAdminGroup)

	probe := core.NewBaseCollection("probe_bunking")
	probe.Fields.Add(&core.TextField{Name: "label"})
	probe.ListRule = types.Pointer(bunkingManageRule)
	probe.CreateRule = types.Pointer(bunkingManageRule)
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
	squattedID := viewAsPersonaID([]string{"metrics.geo", "registration.manage"})
	squattedEmail := squattedID + "@" + viewAsPersonaEmailDomain
	standInID := viewAsPersonaID([]string{"bunking.manage"})
	const roleAssignRoleID = "roleforvatest01"
	const roleAssignRowID = "userroleva00001"

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
			// Write rules, not just List, must see the persona (spec §7): a
			// CreateRule gated on bunking.manage must refuse a preview that
			// lacks it, exactly as the ListRule does above.
			Name: "admin previewing Registrar is refused creating bunking data", Method: http.MethodPost, URL: listProbe,
			Body:           strings.NewReader(`{"label":"planted"}`),
			TestAppFactory: factory, BeforeTestFunc: asUser(true, nil, "registration.manage,metrics.geo"), Headers: headers,
			// A failed CreateRule answers 400 ("Failed to create record."),
			// unlike a failed List/View/Update rule, which filters an
			// existing record out and answers 404 -- there is no record yet
			// for a create to be filtered from. Verified by running this
			// scenario, not assumed.
			ExpectedStatus:  http.StatusBadRequest,
			ExpectedContent: []string{"Failed to create record."},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				rows, err := app.FindAllRecords("probe_bunking")
				if err != nil {
					t.Fatalf("find probe_bunking: %v", err)
				}
				if len(rows) != 1 {
					t.Errorf("probe_bunking rows = %d, want 1 (the refused create must not have landed)", len(rows))
				}
			},
		},
		{
			Name: "admin previewing bunking.manage may create bunking data", Method: http.MethodPost, URL: listProbe,
			Body:           strings.NewReader(`{"label":"planted"}`),
			TestAppFactory: factory, BeforeTestFunc: asUser(true, nil, "bunking.manage"), Headers: headers,
			ExpectedStatus:  http.StatusOK,
			ExpectedContent: []string{`"label":"planted"`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				rows, err := app.FindAllRecords("probe_bunking")
				if err != nil {
					t.Fatalf("find probe_bunking: %v", err)
				}
				if len(rows) != 2 {
					t.Errorf("probe_bunking rows = %d, want 2 (the allowed create must have landed)", len(rows))
				}
			},
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
		{
			// The squatting hole: OAuth2 first sign-up forwards client createData
			// -- including a chosen id and email -- into the record create
			// (apis/record_auth_with_oauth2.go). Without the namespace reservation
			// in registerUsersWriteGuard (users_guard.go), a squatter could plant a
			// real account at a persona's exact deterministic id/email, and every
			// future admin preview of that persona would silently run as the
			// squatter's real account instead of a stand-in.
			Name:   "OAuth2 first sign-up cannot squat the view-as persona namespace",
			Method: http.MethodPost,
			URL:    "/api/collections/users/auth-with-oauth2",
			Body: strings.NewReader(`{
				"provider": "` + testOAuth2Provider + `",
				"code": "123",
				"redirectURL": "https://example.com",
				"createData": {"id": "` + squattedID + `", "email": "` + squattedEmail + `"}
			}`),
			TestAppFactory: factory,
			BeforeTestFunc: func(t testing.TB, _ *tests.TestApp, _ *core.ServeEvent) {
				useMockIDP(t, &auth.AuthUser{
					Id: "idp-squatter", Email: "squatter@example.com", Name: "Alex Squatter",
					RawUser: map[string]any{"groups": []any{}},
				})
			},
			ExpectedStatus:  http.StatusBadRequest,
			ExpectedContent: []string{"This id/email is reserved"},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				assertNoUser(t, app, "squatter@example.com")
				if _, err := app.FindRecordById("users", squattedID); err == nil {
					t.Error("a row was created at the reserved persona id despite the refusal")
				}
			},
		},
		{
			// The fail-closed branch (view_as.go: ensureViewAsPersona error ->
			// apis.NewInternalServerError) is only real if the request truly
			// aborts: a bug that logged the error and fell through to e.Next()
			// would run the request as the real, undowngraded admin and leak
			// bunking data straight past the preview.
			Name: "stand-in creation failure fails closed", Method: http.MethodGet, URL: listProbe,
			TestAppFactory: factory,
			BeforeTestFunc: func(t testing.TB, app *tests.TestApp, ev *core.ServeEvent) {
				app.OnRecordCreate("users").BindFunc(func(e *core.RecordEvent) error {
					if strings.HasPrefix(e.Record.Id, "va") {
						return errors.New("simulated persona creation failure")
					}
					return e.Next() //nolint:wrapcheck // test-only hook
				})
				asUser(true, nil, "registration.manage,metrics.geo")(t, app, ev)
			},
			Headers:         headers,
			ExpectedStatus:  http.StatusInternalServerError,
			ExpectedContent: []string{"View-as persona unavailable"},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, res *http.Response) {
				body, err := io.ReadAll(res.Body)
				if err != nil {
					t.Fatalf("read response body: %v", err)
				}
				if strings.Contains(string(body), `"totalItems":1`) {
					t.Errorf("probe data leaked despite the failed-closed persona: %s", body)
				}
			},
		},
		{
			// A users.manage holder could otherwise POST a user_roles row naming
			// a stand-in as the target user. recomputeUserPermissions (hooks.go)
			// would then overwrite the stand-in's cached_permissions, and
			// verifyViewAsPersona (view_as.go) would fail every later preview of
			// that persona closed with a 500.
			Name:   "assigning a role to a view-as persona stand-in is refused",
			Method: http.MethodPost,
			URL:    "/api/collections/user_roles/records",
			Body:   strings.NewReader(`{"user":"` + standInID + `","role":"` + roleAssignRoleID + `"}`),
			TestAppFactory: func(t testing.TB) *tests.TestApp {
				clear(headers)
				app := newViewAsTestApp(t)
				setRule(t, app, "user_roles", func(c *core.Collection) { c.CreateRule = types.Pointer(authedRule) })
				return app
			},
			BeforeTestFunc: func(t testing.TB, app *tests.TestApp, ev *core.ServeEvent) {
				if _, err := ensureViewAsPersona(app, []string{"bunking.manage"}); err != nil {
					t.Fatalf("create stand-in: %v", err)
				}
				rolesCol, err := app.FindCollectionByNameOrId("roles")
				if err != nil {
					t.Fatalf("find roles: %v", err)
				}
				role := core.NewRecord(rolesCol)
				role.Id = roleAssignRoleID
				mustSave(t, app, role)
				asUser(true, nil, "")(t, app, ev)
			},
			Headers:         headers,
			ExpectedStatus:  http.StatusBadRequest,
			ExpectedContent: []string{"Cannot assign roles to a view-as persona stand-in"},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				rows, err := app.FindAllRecords("user_roles")
				if err != nil {
					t.Fatalf("find user_roles: %v", err)
				}
				if len(rows) != 0 {
					t.Errorf("a user_roles row was created for a view-as persona stand-in (%d rows)", len(rows))
				}
			},
		},
		{
			// The same hole through the update path: user_roles' real updateRule
			// admits users.manage, so a PATCH could retarget an existing
			// assignment at a stand-in. The next role edit would then recompute
			// the stand-in (hooks.go) and break its persona just as a create would.
			Name:   "retargeting a role assignment at a view-as persona stand-in is refused",
			Method: http.MethodPatch,
			URL:    "/api/collections/user_roles/records/" + roleAssignRowID,
			Body:   strings.NewReader(`{"user":"` + standInID + `"}`),
			TestAppFactory: func(t testing.TB) *tests.TestApp {
				clear(headers)
				app := newViewAsTestApp(t)
				setRule(t, app, "user_roles", func(c *core.Collection) { c.UpdateRule = types.Pointer(authedRule) })
				return app
			},
			BeforeTestFunc: func(t testing.TB, app *tests.TestApp, ev *core.ServeEvent) {
				if _, err := ensureViewAsPersona(app, []string{"bunking.manage"}); err != nil {
					t.Fatalf("create stand-in: %v", err)
				}
				rolesCol, err := app.FindCollectionByNameOrId("roles")
				if err != nil {
					t.Fatalf("find roles: %v", err)
				}
				role := core.NewRecord(rolesCol)
				role.Id = roleAssignRoleID
				mustSave(t, app, role)
				target := createUser(t, app, "casey@example.com", false, nil)
				urCol, err := app.FindCollectionByNameOrId("user_roles")
				if err != nil {
					t.Fatalf("find user_roles: %v", err)
				}
				ur := core.NewRecord(urCol)
				ur.Id = roleAssignRowID
				ur.Set("user", target.Id)
				ur.Set("role", role.Id)
				mustSave(t, app, ur)
				asUser(true, nil, "")(t, app, ev)
			},
			Headers:         headers,
			ExpectedStatus:  http.StatusBadRequest,
			ExpectedContent: []string{"Cannot assign roles to a view-as persona stand-in"},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				row, err := app.FindRecordById("user_roles", roleAssignRowID)
				if err != nil {
					t.Fatalf("find user_roles row: %v", err)
				}
				if row.GetString("user") == standInID {
					t.Error("a user_roles row was retargeted at a view-as persona stand-in")
				}
			},
		},
	}
	for _, s := range scenarios {
		s.Test(t)
	}
}
