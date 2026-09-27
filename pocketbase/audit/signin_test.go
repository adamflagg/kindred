package audit_test

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"

	"github.com/camp/kindred/pocketbase/audit"
	"github.com/camp/kindred/pocketbase/audit/audittest"
)

func TestSuccessfulSignInsAreLoggedExceptTheService(t *testing.T) {
	signIn := func(email string) io.Reader {
		return strings.NewReader(`{"identity":"` + email + `","password":"` + testPassword + `"}`)
	}
	factory := func(t testing.TB) *tests.TestApp {
		app := newApp(t)
		createSuperuser(t, app, ownerEmail)
		createSuperuser(t, app, audittest.ServiceEmail)
		return app
	}
	headers := map[string]string{}
	scenarios := []tests.ApiScenario{
		{
			Name: "the owner signing in to the PocketBase admin", Method: http.MethodPost,
			URL: "/api/collections/_superusers/auth-with-password", Body: signIn(ownerEmail),
			ExpectedStatus: 200, ExpectedContent: []string{`"token"`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				row := onlyRow(t, app, audit.TypeSignIn)
				expect(t, row, map[string]string{"action": "sign_in", "actor_kind": "superuser", "actor_email": ownerEmail})
				detail := audittest.JSON(t, row, "detail")
				if detail["method"] != "password" || detail["collection"] != "_superusers" {
					t.Errorf("detail = %v", detail)
				}
			},
		},
		{
			Name: "the service signing in", Method: http.MethodPost,
			URL: "/api/collections/_superusers/auth-with-password", Body: signIn(audittest.ServiceEmail),
			ExpectedStatus: 200, ExpectedContent: []string{`"token"`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) { expectNoRows(t, app) },
		},
		{
			Name: "a token refresh is not a sign-in", Method: http.MethodPost,
			URL: "/api/collections/_superusers/auth-refresh",
			TestAppFactory: func(t testing.TB) *tests.TestApp {
				app := factory(t)
				owner, err := app.FindAuthRecordByEmail(core.CollectionNameSuperusers, ownerEmail)
				if err != nil {
					t.Fatalf("find owner: %v", err)
				}
				authAs(t, headers, owner)
				return app
			},
			Headers: headers, ExpectedStatus: 200, ExpectedContent: []string{`"token"`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) { expectNoRows(t, app) },
		},
	}
	for _, s := range scenarios {
		if s.TestAppFactory == nil {
			s.TestAppFactory = factory
		}
		s.Test(t)
	}
}

// TestImpersonationIsLoggedExceptTheService: a superuser impersonating another
// account (POST /api/collections/{collection}/impersonate/{id}) fires
// OnRecordAuthRequest with an empty AuthMethod, same as a token refresh
// (apis/record_auth_impersonate.go). Only the impersonate path is logged; the
// service account's impersonation, and a plain token refresh, stay silent.
func TestImpersonationIsLoggedExceptTheService(t *testing.T) {
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
			Name: "a superuser impersonating a user writes one pb_admin row", Method: http.MethodPost,
			URL: "/api/collections/users/impersonate/" + samID, Body: strings.NewReader(`{}`),
			BeforeTestFunc: as("owner"), ExpectedStatus: 200, ExpectedContent: []string{`"token"`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				row := onlyRow(t, app, audit.TypePBAdmin)
				expect(t, row, map[string]string{
					"action": "impersonate", "actor_kind": "superuser", "actor_email": ownerEmail,
					"collection": "users", "record_id": samID, "target_label": "Sam Patel",
				})
			},
		},
		{
			Name: "the service impersonating writes nothing", Method: http.MethodPost,
			URL: "/api/collections/users/impersonate/" + samID, Body: strings.NewReader(`{}`),
			BeforeTestFunc: as("service"), ExpectedStatus: 200, ExpectedContent: []string{`"token"`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) { expectNoRows(t, app) },
		},
	}
	for _, s := range scenarios {
		s.TestAppFactory, s.Headers = factory, headers
		s.Test(t)
	}
}

func TestViewAsRoutesWriteStartAndStop(t *testing.T) {
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
	const session = "3f2a9c1e-5b7d-4e2a-9c11-000000000001"
	start := `{"session_id":"` + session + `","persona":"Registrar",` +
		`"permissions":["financial_aid.view","financial_aid.casework","financial_aid.view"]}`
	scenarios := []tests.ApiScenario{
		{
			Name: "an admin starting a preview", Method: http.MethodPost, URL: audit.ViewAsStartPath,
			Body: strings.NewReader(start), BeforeTestFunc: as("admin"), ExpectedStatus: 204,
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				row := onlyRow(t, app, audit.TypeViewAs)
				expect(t, row, map[string]string{"action": "view_as_start", "session_id": session, "actor_email": adminEmail})
				detail := audittest.JSON(t, row, "detail")
				perms, _ := json.Marshal(detail["permissions"])
				if detail["persona"] != "Registrar" || string(perms) != `["financial_aid.casework","financial_aid.view"]` {
					t.Errorf("detail = %v", detail)
				}
			},
		},
		{
			Name: "an admin stopping a preview", Method: http.MethodPost, URL: audit.ViewAsStopPath,
			Body: strings.NewReader(`{"session_id":"` + session + `"}`), BeforeTestFunc: as("admin"), ExpectedStatus: 204,
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				expect(t, onlyRow(t, app, audit.TypeViewAs), map[string]string{"action": "view_as_stop", "session_id": session})
			},
		},
		{
			Name: "a non-admin cannot record a preview", Method: http.MethodPost, URL: audit.ViewAsStartPath,
			Body: strings.NewReader(start), BeforeTestFunc: as("staff"), ExpectedStatus: 403,
			ExpectedContent: []string{"Only an admin"},
			AfterTestFunc:   func(t testing.TB, app *tests.TestApp, _ *http.Response) { expectNoRows(t, app) },
		},
		{
			Name: "a malformed session id is refused", Method: http.MethodPost, URL: audit.ViewAsStartPath,
			Body: strings.NewReader(`{"session_id":"x"}`), BeforeTestFunc: as("admin"), ExpectedStatus: 400,
			ExpectedContent: []string{"session id"},
			AfterTestFunc:   func(t testing.TB, app *tests.TestApp, _ *http.Response) { expectNoRows(t, app) },
		},
	}
	for _, s := range scenarios {
		s.TestAppFactory, s.Headers = factory, headers
		if s.ExpectedStatus == 204 {
			s.ExpectedContent = nil
		}
		s.Test(t)
	}
}

func TestWriteAction(t *testing.T) {
	t.Parallel()
	app := newApp(t)
	defer app.Cleanup()
	people := seed(t, app)
	event := func(auth *core.Record) *core.RequestEvent {
		e := &core.RequestEvent{App: app}
		e.Auth = auth
		req := httptest.NewRequest(http.MethodPost, "/api/custom/sync/run?year=2026", http.NoBody)
		req.RemoteAddr = "10.0.20.5:4000"
		e.Request = req
		return e
	}
	detail := map[string]any{"route": "run", "service": "all", "year": 2026}
	if err := audit.WriteAction(app, event(people["admin"]), audit.ActionSyncRun, detail); err != nil {
		t.Fatalf("WriteAction: %v", err)
	}
	if err := audit.WriteAction(app, event(people["service"]), audit.ActionSyncRun, detail); err != nil {
		t.Fatalf("WriteAction(service): %v", err)
	}
	row := onlyRow(t, app, audit.TypeSettings)
	expect(t, row, map[string]string{"action": "sync_run", "actor_email": adminEmail, "ip": "10.0.20.5"})

	bare, err := tests.NewTestAppWithConfig(core.BaseAppConfig{DataDir: t.TempDir()})
	if err != nil {
		t.Fatalf("bare app: %v", err)
	}
	defer bare.Cleanup()
	err = audit.WriteAction(bare, event(people["admin"]), audit.ActionSyncRun, detail)
	if !errors.Is(err, audit.ErrNotRegistered) {
		t.Fatalf("an unregistered app must refuse, got %v", err)
	}
}
