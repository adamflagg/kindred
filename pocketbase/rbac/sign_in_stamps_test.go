package rbac

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/auth"
	"github.com/pocketbase/pocketbase/tools/types"
)

const oauth2PlainLogin = `{"provider":"` + testOAuth2Provider + `","code":"123","redirectURL":"https://example.com"}`

func expectJustNow(t testing.TB, u *core.Record, fields ...string) {
	t.Helper()
	for _, f := range fields {
		got := u.GetDateTime(f)
		if got.IsZero() || time.Since(got.Time()) > time.Minute {
			t.Errorf("%s = %v, want just now", f, got)
		}
	}
}

// TestOAuth2SignInStampsBothTimestamps: an OAuth2 sign-in sets last_login AND
// last_seen (oidc_hooks.go) -- last_seen so "last active" is never older than
// the person's last sign-in (spec §7).
func TestOAuth2SignInStampsBothTimestamps(t *testing.T) {
	headers := map[string]string{}
	factory := func(t testing.TB) *tests.TestApp {
		clear(headers)
		return newAuthTestApp(t, testAdminGroup)
	}
	scenarios := []tests.ApiScenario{
		{
			Name: "first sign-in", Method: http.MethodPost, URL: "/api/collections/users/auth-with-oauth2",
			Body:           strings.NewReader(oauth2PlainLogin),
			TestAppFactory: factory,
			BeforeTestFunc: func(t testing.TB, _ *tests.TestApp, _ *core.ServeEvent) {
				useMockIDP(t, &auth.AuthUser{Id: "idp-new", Email: "emma.johnson@example.com", Name: "Emma Johnson"})
			},
			ExpectedStatus: http.StatusOK, ExpectedContent: []string{`"isNew":true`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				expectJustNow(t, findUser(t, app, "emma.johnson@example.com"), "last_login", "last_seen")
			},
		},
		{
			Name: "re-login", Method: http.MethodPost, URL: "/api/collections/users/auth-with-oauth2",
			Body:           strings.NewReader(oauth2PlainLogin),
			TestAppFactory: factory,
			BeforeTestFunc: func(t testing.TB, app *tests.TestApp, _ *core.ServeEvent) {
				u := createUser(t, app, "liam.garcia@example.com", false, nil)
				old := time.Now().Add(-90 * 24 * time.Hour)
				u.Set("last_login", old)
				u.Set("last_seen", old)
				mustSave(t, app, u)
				link := core.NewExternalAuth(app)
				link.SetCollectionRef(u.Collection().Id)
				link.SetRecordRef(u.Id)
				link.SetProvider(testOAuth2Provider)
				link.SetProviderId("idp-liam")
				mustSave(t, app, link)
				useMockIDP(t, &auth.AuthUser{Id: "idp-liam", Email: "liam.garcia@example.com", Name: "Liam Garcia"})
			},
			ExpectedStatus: http.StatusOK, ExpectedContent: []string{`"isNew":false`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				expectJustNow(t, findUser(t, app, "liam.garcia@example.com"), "last_login", "last_seen")
			},
		},
	}
	for _, s := range scenarios {
		s.Test(t)
	}
}

// TestSelfPatchCannotSetSignInTimestamps: users.updateRule is owner-only, so a
// person could otherwise PATCH their own last_seen / last_login and hide (or
// invent) their activity. Like is_admin and cached_permissions, the request
// guard keeps them server-owned; the auth hooks still write them with app.Save.
func TestSelfPatchCannotSetSignInTimestamps(t *testing.T) {
	headers := map[string]string{}
	past := time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)
	s := tests.ApiScenario{
		Name: "owner PATCH keeps the name edit and drops the timestamps", Method: http.MethodPatch,
		URL: "/api/collections/users/records/" + selfUserID,
		Body: strings.NewReader(`{"name":"Riley Sam",` +
			`"last_seen":"2030-01-01 00:00:00.000Z","last_login":"2030-01-01 00:00:00.000Z"}`),
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			clear(headers)
			return newAuthTestApp(t, testAdminGroup)
		},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, _ *core.ServeEvent) {
			setRule(t, app, "users", func(c *core.Collection) { c.UpdateRule = types.Pointer(preHardeningOwnerRule) })
			u := createUserWithID(t, app, selfUserID, "staff@example.com", false, nil)
			u.Set("last_seen", past)
			u.Set("last_login", past)
			mustSave(t, app, u)
			authAs(t, headers, u)
		},
		Headers:        headers,
		ExpectedStatus: http.StatusOK, ExpectedContent: []string{`"name":"Riley Sam"`},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			u := findUser(t, app, "staff@example.com")
			for _, f := range []string{"last_seen", "last_login"} {
				if got := u.GetDateTime(f).Time(); !got.Equal(past) {
					t.Errorf("%s = %v after a self-PATCH, want unchanged %v", f, got, past)
				}
			}
		},
	}
	s.Test(t)
}
