package rbac

import (
	"encoding/json"
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/auth"
	"github.com/pocketbase/pocketbase/tools/types"
	"golang.org/x/oauth2"
)

// The hardened access rules, exactly as migration
// 1500000181_users_auth_hardening.js writes them and as production has
// carried them since 2026-09-24. Duplicated verbatim from the migration on
// purpose: TestBootedSchemaAuthRules (users_rules_schema_test.go) compares
// these same constants against a PocketBase booted from the real
// pb_migrations, so the migration, the booted schema and these runtime
// fixtures cannot drift apart without a test failing.
//
// PocketBase rule semantics, because getting them backwards is how the holes
// opened: a nil rule means superusers only; "" means ANYONE, guests included.
const (
	hardenedUsersCreateRule = `@request.context = "oauth2"`
	authedRule              = `@request.auth.id != ""`
	adminOnlyRule           = `@request.auth.is_admin = true`

	// preHardeningOwnerRule is PocketBase's default users update rule, which
	// production carried until 2026-09-24. The defense-in-depth scenarios put
	// it (or a public create rule) back, to prove the request hooks keep
	// is_admin and cached_permissions server-owned even if a rule is loosened.
	preHardeningOwnerRule = "id = @request.auth.id"

	testAdminGroup     = "kindred-test-admins"
	testOAuth2Provider = "kindredtest"
)

// oauth2MockProvider stands in for the IdP, the same way PocketBase's own
// auth-with-oauth2 tests do: FetchToken/FetchAuthUser return canned values so
// the whole sign-up path runs without a network.
type oauth2MockProvider struct {
	auth.BaseProvider

	AuthUser *auth.AuthUser
	Token    *oauth2.Token
}

func (p *oauth2MockProvider) FetchToken(string, ...oauth2.AuthCodeOption) (*oauth2.Token, error) {
	return p.Token, nil
}

func (p *oauth2MockProvider) FetchAuthUser(*oauth2.Token) (*auth.AuthUser, error) {
	return p.AuthUser, nil
}

// useMockIDP makes the test provider return user on the next OAuth2 login.
// auth.Providers is a package global, so these tests must not run in parallel.
func useMockIDP(t testing.TB, user *auth.AuthUser) {
	t.Helper()
	auth.Providers[testOAuth2Provider] = func() auth.Provider {
		return &oauth2MockProvider{AuthUser: user, Token: &oauth2.Token{AccessToken: "abc"}}
	}
	t.Cleanup(func() { delete(auth.Providers, testOAuth2Provider) })
}

// newAuthTestApp builds a PocketBase app from an EMPTY data dir -- not
// tests.NewTestApp()'s bundled demo data, whose "users" collection is unrelated
// to Kindred's -- so "users" starts as PocketBase's own default (public create
// rule and all) and is then shaped like production: the RBAC fields, the
// hardened rules, password auth off, OAuth2 on. It registers the real
// RegisterHooks wiring, with ADMIN_GROUP_NAME set to adminGroup.
func newAuthTestApp(t testing.TB, adminGroup string) *tests.TestApp {
	t.Helper()
	t.Setenv("ADMIN_GROUP_NAME", adminGroup)

	app, err := tests.NewTestAppWithConfig(core.BaseAppConfig{DataDir: t.TempDir()})
	if err != nil {
		t.Fatalf("new test app: %v", err)
	}

	// The provider must exist before the collection referencing it is saved.
	useMockIDP(t, &auth.AuthUser{Id: "unused"})

	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatalf("find users collection: %v", err)
	}
	users.Fields.Add(&core.BoolField{Name: "is_admin"})
	users.Fields.Add(&core.JSONField{Name: "cached_permissions", MaxSize: 2000000})
	users.Fields.Add(&core.DateField{Name: "last_login"})
	users.ListRule = types.Pointer(authedRule)
	users.ViewRule = types.Pointer(authedRule)
	users.CreateRule = types.Pointer(hardenedUsersCreateRule)
	users.UpdateRule = nil
	users.DeleteRule = nil
	users.PasswordAuth.Enabled = false
	users.MFA.Enabled = false
	users.OAuth2.Enabled = true
	users.OAuth2.Providers = []core.OAuth2ProviderConfig{{
		Name:         testOAuth2Provider,
		ClientId:     "123",
		ClientSecret: "456",
	}}
	mustSave(t, app, users)

	solverRuns := core.NewBaseCollection("solver_runs")
	solverRuns.Fields.Add(&core.TextField{Name: "status"})
	solverRuns.ListRule = types.Pointer(adminOnlyRule)
	solverRuns.ViewRule = types.Pointer(adminOnlyRule)
	mustSave(t, app, solverRuns) // create/update/delete stay nil

	debugParse := core.NewBaseCollection("debug_parse_results")
	debugParse.Fields.Add(&core.TextField{Name: "parse_notes"})
	mustSave(t, app, debugParse) // all five rules stay nil

	roles := core.NewBaseCollection("roles")
	roles.Fields.Add(&core.TextField{Name: "name"})
	roles.Fields.Add(&core.JSONField{Name: "permissions", MaxSize: 2000000})
	mustSave(t, app, roles)

	userRoles := core.NewBaseCollection("user_roles")
	userRoles.Fields.Add(&core.RelationField{Name: "user", CollectionId: users.Id, MaxSelect: 1})
	userRoles.Fields.Add(&core.RelationField{Name: "role", CollectionId: roles.Id, MaxSelect: 1})
	mustSave(t, app, userRoles)

	RegisterHooks(app)
	return app
}

func mustSave(t testing.TB, app core.App, m core.Model) {
	t.Helper()
	if err := app.Save(m); err != nil {
		t.Fatalf("save %T: %v", m, err)
	}
}

func setRule(t testing.TB, app core.App, collection string, set func(*core.Collection)) {
	t.Helper()
	col, err := app.FindCollectionByNameOrId(collection)
	if err != nil {
		t.Fatalf("find %s: %v", collection, err)
	}
	set(col)
	mustSave(t, app, col)
}

// selfUserID is a fixed record id, so a scenario can PATCH a user it creates
// in BeforeTestFunc -- the scenario's URL is fixed before that runs.
const selfUserID = "selfstaff000001"

func createUser(t testing.TB, app core.App, email string, isAdmin bool, perms []string) *core.Record {
	t.Helper()
	return createUserWithID(t, app, "", email, isAdmin, perms)
}

func createUserWithID(t testing.TB, app core.App, id, email string, isAdmin bool, perms []string) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatalf("find users: %v", err)
	}
	u := core.NewRecord(col)
	if id != "" {
		u.Id = id
	}
	u.SetEmail(email)
	u.SetPassword("correct-horse-battery-staple")
	u.Set("is_admin", isAdmin)
	u.Set("cached_permissions", perms)
	mustSave(t, app, u)
	return u
}

func createSuperuser(t testing.TB, app core.App) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId(core.CollectionNameSuperusers)
	if err != nil {
		t.Fatalf("find superusers: %v", err)
	}
	su := core.NewRecord(col)
	su.SetEmail("root@example.com")
	su.SetPassword("correct-horse-battery-staple")
	mustSave(t, app, su)
	return su
}

// authAs puts record's auth token into headers. The map is shared with the
// scenario, which reads it only when it builds the request -- after
// BeforeTestFunc has created the record.
func authAs(t testing.TB, headers map[string]string, record *core.Record) {
	t.Helper()
	token, err := record.NewAuthToken()
	if err != nil {
		t.Fatalf("auth token: %v", err)
	}
	headers["Authorization"] = token
}

func findUser(t testing.TB, app core.App, email string) *core.Record {
	t.Helper()
	u, err := app.FindAuthRecordByEmail("users", email)
	if err != nil {
		t.Fatalf("find user %s: %v", email, err)
	}
	return u
}

func assertNoUser(t testing.TB, app core.App, email string) {
	t.Helper()
	if u, err := app.FindAuthRecordByEmail("users", email); err == nil {
		t.Fatalf("user %s exists (id %s), but the create should have been refused", email, u.Id)
	}
}

func cachedPermissions(t testing.TB, r *core.Record) []string {
	t.Helper()
	raw := strings.TrimSpace(r.GetString("cached_permissions"))
	if raw == "" || raw == "null" {
		return nil
	}
	var perms []string
	if err := json.Unmarshal([]byte(raw), &perms); err != nil {
		t.Fatalf("cached_permissions %q is not a string array: %v", raw, err)
	}
	return perms
}

func assertAccess(t testing.TB, r *core.Record, wantAdmin bool, wantPerms []string) {
	t.Helper()
	if got := r.GetBool("is_admin"); got != wantAdmin {
		t.Errorf("is_admin = %v, want %v", got, wantAdmin)
	}
	if got := cachedPermissions(t, r); !slices.Equal(got, wantPerms) && (len(got) != 0 || len(wantPerms) != 0) {
		t.Errorf("cached_permissions = %v, want %v", got, wantPerms)
	}
}

// oauth2LoginBody is an auth-with-oauth2 request whose createData tries to
// plant elevated access -- what a user signing in for the first time can send.
const oauth2LoginBody = `{
	"provider": "` + testOAuth2Provider + `",
	"code": "123",
	"redirectURL": "https://example.com",
	"createData": {"is_admin": true, "cached_permissions": ["users.manage", "financial_aid.view"]}
}`

// TestUsersAuthHardening exercises the rules and hooks end to end through
// PocketBase's real router: anonymous and self-service writes are refused,
// OAuth2 sign-up still works and cannot plant access, and the hooks hold
// even when a rule is loosened.
func TestUsersAuthHardening(t *testing.T) {
	headers := map[string]string{}
	factory := func(adminGroup string) func(testing.TB) *tests.TestApp {
		return func(t testing.TB) *tests.TestApp {
			clear(headers)
			return newAuthTestApp(t, adminGroup)
		}
	}

	scenarios := []tests.ApiScenario{
		{
			Name:   "anonymous create is refused",
			Method: http.MethodPost,
			URL:    "/api/collections/users/records",
			Body: strings.NewReader(`{"email":"intruder@example.com","password":"correct-horse-battery-staple",
				"passwordConfirm":"correct-horse-battery-staple","is_admin":true,"cached_permissions":["users.manage"]}`),
			TestAppFactory:  factory(testAdminGroup),
			ExpectedStatus:  http.StatusBadRequest,
			ExpectedContent: []string{`"data":{}`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				assertNoUser(t, app, "intruder@example.com")
			},
		},
		{
			// PocketBase resolves {collection} by id as well as name.
			Name:   "anonymous create by collection id is refused",
			Method: http.MethodPost,
			URL:    "/api/collections/_pb_users_auth_/records",
			Body: strings.NewReader(`{"email":"intruder@example.com","password":"correct-horse-battery-staple",
				"passwordConfirm":"correct-horse-battery-staple","is_admin":true}`),
			TestAppFactory:  factory(testAdminGroup),
			ExpectedStatus:  http.StatusBadRequest,
			ExpectedContent: []string{`"data":{}`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				assertNoUser(t, app, "intruder@example.com")
			},
		},
		{
			Name:           "password login on users is refused",
			Method:         http.MethodPost,
			URL:            "/api/collections/users/auth-with-password",
			Body:           strings.NewReader(`{"identity":"staff@example.com","password":"correct-horse-battery-staple"}`),
			TestAppFactory: factory(testAdminGroup),
			BeforeTestFunc: func(t testing.TB, app *tests.TestApp, _ *core.ServeEvent) {
				createUser(t, app, "staff@example.com", false, nil)
			},
			ExpectedStatus:     http.StatusForbidden,
			NotExpectedContent: []string{`"token"`},
		},
		{
			Name:           "self-service PATCH of is_admin and cached_permissions is refused",
			Method:         http.MethodPatch,
			URL:            "/api/collections/users/records/" + selfUserID,
			Body:           strings.NewReader(`{"is_admin":true,"cached_permissions":["users.manage"]}`),
			TestAppFactory: factory(testAdminGroup),
			BeforeTestFunc: func(t testing.TB, app *tests.TestApp, _ *core.ServeEvent) {
				u := createUserWithID(t, app, selfUserID, "staff@example.com", false, []string{"bunking.manage"})
				authAs(t, headers, u)
			},
			Headers:         headers,
			ExpectedStatus:  http.StatusForbidden,
			ExpectedContent: []string{`"Only superusers can perform this action."`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				assertAccess(t, findUser(t, app, "staff@example.com"), false, []string{"bunking.manage"})
			},
		},
		{
			// Defense in depth: with the pre-hardening owner update rule back,
			// the request is allowed but the access fields do not move.
			Name:           "loosened update rule: self PATCH cannot change is_admin or cached_permissions",
			Method:         http.MethodPatch,
			URL:            "/api/collections/users/records/" + selfUserID,
			Body:           strings.NewReader(`{"name":"Riley Sam","is_admin":true,"cached_permissions":["users.manage"]}`),
			TestAppFactory: factory(testAdminGroup),
			BeforeTestFunc: func(t testing.TB, app *tests.TestApp, _ *core.ServeEvent) {
				setRule(t, app, "users", func(c *core.Collection) { c.UpdateRule = types.Pointer(preHardeningOwnerRule) })
				u := createUserWithID(t, app, selfUserID, "staff@example.com", false, []string{"bunking.manage"})
				authAs(t, headers, u)
			},
			Headers:         headers,
			ExpectedStatus:  http.StatusOK,
			ExpectedContent: []string{`"name":"Riley Sam"`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				u := findUser(t, app, "staff@example.com")
				if got := u.GetString("name"); got != "Riley Sam" {
					t.Errorf("name = %q, want the ordinary field edit to go through", got)
				}
				assertAccess(t, u, false, []string{"bunking.manage"})
			},
		},
		{
			// Defense in depth: with PocketBase's default public create rule
			// back, a guest can create an account but not an admin one.
			Name:   "loosened create rule: guest create cannot set is_admin or cached_permissions",
			Method: http.MethodPost,
			URL:    "/api/collections/users/records",
			Body: strings.NewReader(`{"email":"guest@example.com","password":"correct-horse-battery-staple",
				"passwordConfirm":"correct-horse-battery-staple","is_admin":true,"cached_permissions":["users.manage"]}`),
			TestAppFactory: factory(testAdminGroup),
			BeforeTestFunc: func(t testing.TB, app *tests.TestApp, _ *core.ServeEvent) {
				setRule(t, app, "users", func(c *core.Collection) { c.CreateRule = types.Pointer("") })
			},
			ExpectedStatus:  http.StatusOK,
			ExpectedContent: []string{`"is_admin":false`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				assertAccess(t, findUser(t, app, "guest@example.com"), false, nil)
			},
		},
		{
			Name:   "superuser can still create an admin user",
			Method: http.MethodPost,
			URL:    "/api/collections/users/records",
			Body: strings.NewReader(`{"email":"newadmin@example.com","password":"correct-horse-battery-staple",
				"passwordConfirm":"correct-horse-battery-staple","is_admin":true,"cached_permissions":["users.manage"]}`),
			TestAppFactory: factory(testAdminGroup),
			BeforeTestFunc: func(t testing.TB, app *tests.TestApp, _ *core.ServeEvent) {
				authAs(t, headers, createSuperuser(t, app))
			},
			Headers:         headers,
			ExpectedStatus:  http.StatusOK,
			ExpectedContent: []string{`"is_admin":true`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				assertAccess(t, findUser(t, app, "newadmin@example.com"), true, []string{"users.manage"})
			},
		},
		{
			Name:           "OAuth2 first login, admin group member: is_admin from the IdP, planted permissions dropped",
			Method:         http.MethodPost,
			URL:            "/api/collections/users/auth-with-oauth2",
			Body:           strings.NewReader(oauth2LoginBody),
			TestAppFactory: factory(testAdminGroup),
			BeforeTestFunc: func(t testing.TB, _ *tests.TestApp, _ *core.ServeEvent) {
				useMockIDP(t, &auth.AuthUser{
					Id: "idp-admin", Email: "lead@example.com", Name: "Olivia Chen",
					RawUser: map[string]any{"groups": []any{testAdminGroup}},
				})
			},
			ExpectedStatus:  http.StatusOK,
			ExpectedContent: []string{`"token":`, `"meta":{`, `"isNew":true`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				assertAccess(t, findUser(t, app, "lead@example.com"), true, nil)
			},
		},
		{
			Name:           "OAuth2 first login, not in admin group: planted is_admin and permissions dropped",
			Method:         http.MethodPost,
			URL:            "/api/collections/users/auth-with-oauth2",
			Body:           strings.NewReader(oauth2LoginBody),
			TestAppFactory: factory(testAdminGroup),
			BeforeTestFunc: func(t testing.TB, _ *tests.TestApp, _ *core.ServeEvent) {
				useMockIDP(t, &auth.AuthUser{
					Id: "idp-staff", Email: "counselor@example.com", Name: "Liam Garcia",
					RawUser: map[string]any{"groups": []any{"staff"}},
				})
			},
			ExpectedStatus:  http.StatusOK,
			ExpectedContent: []string{`"token":`, `"isNew":true`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				assertAccess(t, findUser(t, app, "counselor@example.com"), false, nil)
			},
		},
		{
			// Without ADMIN_GROUP_NAME the admin-sync hook is not registered,
			// so nothing overwrites the client's createData -- the guard must.
			Name:           "OAuth2 first login without ADMIN_GROUP_NAME: planted is_admin dropped",
			Method:         http.MethodPost,
			URL:            "/api/collections/users/auth-with-oauth2",
			Body:           strings.NewReader(oauth2LoginBody),
			TestAppFactory: factory(""),
			BeforeTestFunc: func(t testing.TB, _ *tests.TestApp, _ *core.ServeEvent) {
				useMockIDP(t, &auth.AuthUser{
					Id: "idp-staff", Email: "counselor@example.com", Name: "Liam Garcia",
					RawUser: map[string]any{"groups": []any{testAdminGroup}},
				})
			},
			ExpectedStatus:  http.StatusOK,
			ExpectedContent: []string{`"token":`, `"isNew":true`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				assertAccess(t, findUser(t, app, "counselor@example.com"), false, nil)
			},
		},
		{
			// Re-login goes through the admin-sync + last-login hooks, which
			// save with app.Save (a model save, no request hooks). Role-derived
			// permissions must survive it; is_admin follows the IdP group.
			Name:           "OAuth2 re-login: admin sync still applies and existing permissions survive",
			Method:         http.MethodPost,
			URL:            "/api/collections/users/auth-with-oauth2",
			Body:           strings.NewReader(oauth2LoginBody),
			TestAppFactory: factory(testAdminGroup),
			BeforeTestFunc: func(t testing.TB, app *tests.TestApp, _ *core.ServeEvent) {
				u := createUser(t, app, "director@example.com", false, []string{"bunking.manage"})
				link := core.NewExternalAuth(app)
				link.SetCollectionRef(u.Collection().Id)
				link.SetRecordRef(u.Id)
				link.SetProvider(testOAuth2Provider)
				link.SetProviderId("idp-director")
				mustSave(t, app, link)
				useMockIDP(t, &auth.AuthUser{
					Id: "idp-director", Email: "director@example.com", Name: "Samuel Johnson",
					RawUser: map[string]any{"groups": []any{testAdminGroup}},
				})
			},
			ExpectedStatus:  http.StatusOK,
			ExpectedContent: []string{`"token":`, `"isNew":false`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				assertAccess(t, findUser(t, app, "director@example.com"), true, []string{"bunking.manage"})
			},
		},
		{
			Name:           "solver_runs: anonymous list sees nothing",
			Method:         http.MethodGet,
			URL:            "/api/collections/solver_runs/records",
			TestAppFactory: factory(testAdminGroup),
			BeforeTestFunc: func(t testing.TB, app *tests.TestApp, _ *core.ServeEvent) {
				seedSolverRun(t, app)
			},
			ExpectedStatus:  http.StatusOK,
			ExpectedContent: []string{`"totalItems":0`, `"items":[]`},
		},
		{
			Name:            "solver_runs: anonymous create is refused",
			Method:          http.MethodPost,
			URL:             "/api/collections/solver_runs/records",
			Body:            strings.NewReader(`{"status":"planted"}`),
			TestAppFactory:  factory(testAdminGroup),
			ExpectedStatus:  http.StatusForbidden,
			ExpectedContent: []string{`"Only superusers can perform this action."`},
		},
		{
			// The Solver Debug page (frontend/src/hooks/useSolverRuns.ts) reads
			// solver_runs with the signed-in admin's own token.
			Name:           "solver_runs: an admin user can list",
			Method:         http.MethodGet,
			URL:            "/api/collections/solver_runs/records",
			TestAppFactory: factory(testAdminGroup),
			BeforeTestFunc: func(t testing.TB, app *tests.TestApp, _ *core.ServeEvent) {
				seedSolverRun(t, app)
				authAs(t, headers, createUser(t, app, "admin@example.com", true, nil))
			},
			Headers:         headers,
			ExpectedStatus:  http.StatusOK,
			ExpectedContent: []string{`"totalItems":1`},
		},
		{
			Name:           "solver_runs: a non-admin user sees nothing",
			Method:         http.MethodGet,
			URL:            "/api/collections/solver_runs/records",
			TestAppFactory: factory(testAdminGroup),
			BeforeTestFunc: func(t testing.TB, app *tests.TestApp, _ *core.ServeEvent) {
				seedSolverRun(t, app)
				authAs(t, headers, createUser(t, app, "staff@example.com", false, []string{"bunking.manage"}))
			},
			Headers:         headers,
			ExpectedStatus:  http.StatusOK,
			ExpectedContent: []string{`"totalItems":0`},
		},
		{
			Name:            "debug_parse_results: anonymous list is refused",
			Method:          http.MethodGet,
			URL:             "/api/collections/debug_parse_results/records",
			TestAppFactory:  factory(testAdminGroup),
			ExpectedStatus:  http.StatusForbidden,
			ExpectedContent: []string{`"Only superusers can perform this action."`},
		},
		{
			Name:            "debug_parse_results: anonymous create is refused",
			Method:          http.MethodPost,
			URL:             "/api/collections/debug_parse_results/records",
			Body:            strings.NewReader(`{"parse_notes":"planted"}`),
			TestAppFactory:  factory(testAdminGroup),
			ExpectedStatus:  http.StatusForbidden,
			ExpectedContent: []string{`"Only superusers can perform this action."`},
		},
		{
			// nil is superusers only: even an is_admin user goes through FastAPI.
			Name:           "debug_parse_results: an admin user is refused too",
			Method:         http.MethodGet,
			URL:            "/api/collections/debug_parse_results/records",
			TestAppFactory: factory(testAdminGroup),
			BeforeTestFunc: func(t testing.TB, app *tests.TestApp, _ *core.ServeEvent) {
				authAs(t, headers, createUser(t, app, "admin@example.com", true, nil))
			},
			Headers:         headers,
			ExpectedStatus:  http.StatusForbidden,
			ExpectedContent: []string{`"Only superusers can perform this action."`},
		},
	}

	for _, scenario := range scenarios {
		scenario.Test(t)
	}
}

func seedSolverRun(t testing.TB, app core.App) {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("solver_runs")
	if err != nil {
		t.Fatalf("find solver_runs: %v", err)
	}
	r := core.NewRecord(col)
	r.Set("status", "completed")
	mustSave(t, app, r)
}

// TestUserRolesStillRecomputeCachedPermissions pins the flow the brief warned
// a MODEL hook would break: recomputeUserPermissions writes cached_permissions
// with app.Save, which fires no request hooks, so the guard must leave it be.
func TestUserRolesStillRecomputeCachedPermissions(t *testing.T) {
	app := newAuthTestApp(t, testAdminGroup)
	t.Cleanup(app.Cleanup)

	u := createUser(t, app, "registrar@example.com", false, nil)

	rolesCol, err := app.FindCollectionByNameOrId("roles")
	if err != nil {
		t.Fatalf("find roles: %v", err)
	}
	role := core.NewRecord(rolesCol)
	role.Set("name", "Registrar")
	role.Set("permissions", []string{"registration.manage", "sheets.export"})
	mustSave(t, app, role)

	urCol, err := app.FindCollectionByNameOrId("user_roles")
	if err != nil {
		t.Fatalf("find user_roles: %v", err)
	}
	ur := core.NewRecord(urCol)
	ur.Set("user", u.Id)
	ur.Set("role", role.Id)
	mustSave(t, app, ur)

	assertAccess(t, findUser(t, app, "registrar@example.com"), false,
		[]string{"registration.manage", "sheets.export"})
}
