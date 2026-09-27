package rbac

import (
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/auth"

	"github.com/camp/kindred/pocketbase/audit"
	"github.com/camp/kindred/pocketbase/audit/audittest"
)

// The audit log lives in its own package, which cannot import rbac; this file
// proves the two halves meet: viewAsMiddleware hands the audit hooks the real
// admin (spec §4.3), in a plain request and inside a batch, and the OIDC
// admin-group sync records its grants and removals (spec §4.5).

func TestViewAsStandInDomainMatchesAudit(t *testing.T) {
	if audit.ViewAsEmailDomain != viewAsPersonaEmailDomain {
		t.Fatalf("audit.ViewAsEmailDomain = %q, rbac's is %q: a stand-in would be logged as a person",
			audit.ViewAsEmailDomain, viewAsPersonaEmailDomain)
	}
}

// newAuditedViewAsApp is newViewAsTestApp with the audit log registered and
// batch enabled, as migration 1500000195 enables it in production.
func newAuditedViewAsApp(t testing.TB) *tests.TestApp {
	t.Helper()
	app := newViewAsTestApp(t)
	audittest.Setup(t, app)
	settings := app.Settings()
	settings.Batch.Enabled = true
	settings.Batch.MaxRequests = 50
	settings.Batch.Timeout = 10
	mustSave(t, app, settings)
	return app
}

// TestViewAsWritesAreRecordedAgainstTheRealAdmin: a write made while previewing
// is the admin's (owner ruling 2026-09-26), never the stand-in's and never "an
// admin previewing (unidentified)" -- the tripwire actorFromRecord keeps for a
// stand-in that arrives without the real admin must never fire through the
// middleware.
func TestViewAsWritesAreRecordedAgainstTheRealAdmin(t *testing.T) {
	headers := map[string]string{}
	factory := func(t testing.TB) *tests.TestApp {
		clear(headers)
		return newAuditedViewAsApp(t)
	}
	asPreviewingAdmin := func(t testing.TB, app *tests.TestApp, _ *core.ServeEvent) {
		authAs(t, headers, createUser(t, app, viewAsEmail, true, nil))
		headers[ViewAsHeader] = "registration.manage"
	}
	regConfig := `{"key":"reg_dates","metadata":{"business_category":"registration"}}`
	assertRealAdmin := func(t testing.TB, app *tests.TestApp, want int) {
		t.Helper()
		rows := audittest.RowsOfType(t, app, audit.TypeSettings)
		if len(rows) != want {
			t.Fatalf("settings rows = %d, want %d", len(rows), want)
		}
		for _, row := range rows {
			if row.GetString("actor_email") != viewAsEmail || row.GetString("actor_name") == audit.UnidentifiedPreviewer {
				t.Fatalf("recorded against %q (%q), want the real admin %q",
					row.GetString("actor_email"), row.GetString("actor_name"), viewAsEmail)
			}
		}
	}
	scenarios := []tests.ApiScenario{
		{
			Name: "a single write while previewing", Method: http.MethodPost,
			URL: "/api/collections/config/records", Body: strings.NewReader(regConfig),
			TestAppFactory: factory, BeforeTestFunc: asPreviewingAdmin, Headers: headers,
			ExpectedStatus: 200, ExpectedContent: []string{`"key":"reg_dates"`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				assertRealAdmin(t, app, 1)
			},
		},
		{
			Name: "two writes inside one batch while previewing", Method: http.MethodPost, URL: "/api/batch",
			Body: strings.NewReader(`{"requests":[` +
				`{"method":"POST","url":"/api/collections/config/records","body":` + regConfig + `},` +
				`{"method":"POST","url":"/api/collections/config/records","body":` + regConfig + `}]}`),
			TestAppFactory: factory, BeforeTestFunc: asPreviewingAdmin, Headers: headers,
			ExpectedStatus: 200, ExpectedContent: []string{`"status":200`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				assertRealAdmin(t, app, 2)
			},
		},
		{
			// The switcher posts view-as events WITHOUT the header; one that
			// still carries a persona is refused rather than recorded.
			Name: "a view-as event sent under a persona is refused", Method: http.MethodPost,
			URL: audit.ViewAsStartPath, Body: strings.NewReader(`{"session_id":"3f2a9c1e-5b7d-4e2a-9c11-000000000002"}`),
			TestAppFactory: factory, BeforeTestFunc: asPreviewingAdmin, Headers: headers,
			ExpectedStatus: 400, ExpectedContent: []string{"without the view-as header"},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				if rows := audittest.Rows(t, app); len(rows) != 0 {
					t.Fatalf("rows = %d, want none", len(rows))
				}
			},
		},
	}
	for _, s := range scenarios {
		s.Test(t)
	}
}

// TestOIDCAdminGroupChangesAreAudited: the Pocket ID admin group granting admin
// on a first sign-in, and removing it on a later one (spec §4.5).
func TestOIDCAdminGroupChangesAreAudited(t *testing.T) {
	factory := func(t testing.TB) *tests.TestApp {
		app := newAuthTestApp(t, testAdminGroup)
		audittest.Setup(t, app)
		return app
	}
	byAction := func(t testing.TB, app core.App) map[string]*core.Record {
		out := map[string]*core.Record{}
		for _, r := range audittest.Rows(t, app) {
			out[r.GetString("type")+"/"+r.GetString("action")] = r
		}
		return out
	}
	scenarios := []tests.ApiScenario{
		{
			Name: "a first sign-in in the admin group: account created, admin granted, signed in", Method: http.MethodPost,
			URL: "/api/collections/users/auth-with-oauth2", Body: strings.NewReader(oauth2LoginBody),
			TestAppFactory: factory,
			BeforeTestFunc: func(t testing.TB, _ *tests.TestApp, _ *core.ServeEvent) {
				useMockIDP(t, &auth.AuthUser{
					Id: "idp-lead", Email: "lead@example.com", Name: "Olivia Chen",
					RawUser: map[string]any{"groups": []any{testAdminGroup}},
				})
			},
			ExpectedStatus: http.StatusOK, ExpectedContent: []string{`"isNew":true`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				rows := byAction(t, app)
				if len(rows) != 3 {
					t.Fatalf("rows = %v, want access/create, access/admin_granted and sign_in/sign_in", rows)
				}
				created := rows["access/create"]
				if created == nil || created.GetString("actor_email") != "lead@example.com" ||
					created.GetString("target_label") != "Olivia Chen" ||
					!strings.Contains(created.GetString("detail"), "first_sign_in") {
					t.Errorf("account-created row = %v", created)
				}
				granted := rows["access/admin_granted"]
				if granted == nil || granted.GetString("actor_kind") != audit.ActorSystem ||
					!strings.Contains(granted.GetString("detail"), "pocket_id_admin_group") {
					t.Errorf("admin-granted row = %v", granted)
				}
				if signIn := rows["sign_in/sign_in"]; signIn == nil || !strings.Contains(signIn.GetString("detail"), `"oauth2"`) {
					t.Errorf("sign-in row = %v", signIn)
				}
			},
		},
		{
			Name: "a later sign-in outside the group removes admin", Method: http.MethodPost,
			URL: "/api/collections/users/auth-with-oauth2", Body: strings.NewReader(oauth2LoginBody),
			TestAppFactory: factory,
			BeforeTestFunc: func(t testing.TB, app *tests.TestApp, _ *core.ServeEvent) {
				u := createUser(t, app, "director@example.com", true, nil)
				link := core.NewExternalAuth(app)
				link.SetCollectionRef(u.Collection().Id)
				link.SetRecordRef(u.Id)
				link.SetProvider(testOAuth2Provider)
				link.SetProviderId("idp-director")
				mustSave(t, app, link)
				useMockIDP(t, &auth.AuthUser{Id: "idp-director", Email: "director@example.com", RawUser: map[string]any{}})
			},
			ExpectedStatus: http.StatusOK, ExpectedContent: []string{`"isNew":false`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				rows := byAction(t, app)
				removed := rows["access/admin_removed"]
				if len(rows) != 2 || removed == nil || removed.GetString("after") != `{"is_admin":false}` {
					t.Fatalf("rows = %v, want access/admin_removed with after is_admin false, and one sign-in", rows)
				}
			},
		},
	}
	for _, s := range scenarios {
		s.Test(t)
	}
}
