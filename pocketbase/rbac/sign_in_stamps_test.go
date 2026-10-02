package rbac

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/auth"
	"github.com/pocketbase/pocketbase/tools/hook"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/camp/kindred/pocketbase/audit"
	"github.com/camp/kindred/pocketbase/audit/audittest"
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

// TestSelfPatchCannotSetSignInTimestamps: users.updateRule is null (superusers
// only) since migration 1500000181; this test loosens it to owner-only to prove
// that, were it ever loosened, a person still could not PATCH their own
// last_seen / last_login to hide (or invent) their activity. Like is_admin and
// cached_permissions, the request guard keeps them server-owned; the auth hooks
// still write them as column-only UPDATEs.
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

// writeUnderneath binds a sign-in hook that runs ahead of the admin-sync and
// last-login hooks (priority -1 < the default 0). By then PocketBase has loaded
// e.Record, so the write it makes lands underneath that snapshot -- the shape of
// a role recompute (cached_permissions) or an admin edit racing a sign-in.
func writeUnderneath(app core.App, perms []string) {
	app.OnRecordAuthWithOAuth2Request("users").Bind(&hook.Handler[*core.RecordAuthWithOAuth2RequestEvent]{
		Priority: -1,
		Func: func(e *core.RecordAuthWithOAuth2RequestEvent) error {
			if e.Record != nil && !e.IsNewRecord {
				fresh, err := e.App.FindRecordById("users", e.Record.Id)
				if err != nil {
					return fmt.Errorf("reload: %w", err)
				}
				fresh.Set("cached_permissions", perms)
				fresh.Set("name", "Changed Underneath")
				if err := e.App.Save(fresh); err != nil {
					return fmt.Errorf("concurrent save: %w", err)
				}
			}
			return e.Next()
		},
	})
}

// linkedUser creates a user linked to the mock IdP, with sign-in stamps long
// in the past, and makes the IdP answer for it with the given groups. It is
// verified, as every account a first Pocket ID sign-in creates is: PocketBase
// itself re-saves an UNverified e.Record during the sign-in (oauth2Submit),
// which is its own pre-hijack defense and outside these hooks.
func linkedUser(t testing.TB, app core.App, email string, isAdmin bool, perms []string, groups []any) *core.Record {
	t.Helper()
	u := createUser(t, app, email, isAdmin, perms)
	u.SetVerified(true)
	old := time.Now().Add(-90 * 24 * time.Hour)
	u.Set("last_login", old)
	u.Set("last_seen", old)
	u.Set("emailVisibility", false)
	mustSave(t, app, u)
	link := core.NewExternalAuth(app)
	link.SetCollectionRef(u.Collection().Id)
	link.SetRecordRef(u.Id)
	link.SetProvider(testOAuth2Provider)
	link.SetProviderId("idp-" + u.Id)
	mustSave(t, app, link)
	useMockIDP(t, &auth.AuthUser{Id: "idp-" + u.Id, Email: email, RawUser: map[string]any{"groups": groups}})
	return u
}

// TestOAuth2SignInStampsDoNotClobberConcurrentWrites: the sign-in hooks hold the
// users record PocketBase loaded at request start. A permission recompute or an
// admin edit that lands before the stamps must survive them -- otherwise a
// removed permission stays in effect until the next recompute.
func TestOAuth2SignInStampsDoNotClobberConcurrentWrites(t *testing.T) {
	recomputed := []string{"bunking.view"}
	factory := func(t testing.TB) *tests.TestApp {
		app := newAuthTestApp(t, testAdminGroup)
		audittest.Setup(t, app)
		return app
	}
	scenarios := []tests.ApiScenario{
		{
			Name: "re-login, admin unchanged: the stamps are columns", Method: http.MethodPost,
			URL: "/api/collections/users/auth-with-oauth2", Body: strings.NewReader(oauth2PlainLogin),
			TestAppFactory: factory,
			BeforeTestFunc: func(t testing.TB, app *tests.TestApp, _ *core.ServeEvent) {
				linkedUser(t, app, "noah.williams@example.com", false, []string{"bunking.manage", "users.manage"}, nil)
				writeUnderneath(app, recomputed)
			},
			ExpectedStatus: http.StatusOK, ExpectedContent: []string{`"isNew":false`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				u := findUser(t, app, "noah.williams@example.com")
				assertAccess(t, u, false, recomputed)
				if got := u.GetString("name"); got != "Changed Underneath" {
					t.Errorf("name = %q, the sign-in overwrote the concurrent write", got)
				}
				expectJustNow(t, u, "last_login", "last_seen")
				if !u.GetBool("emailVisibility") {
					t.Error("emailVisibility was not set")
				}
			},
		},
		{
			Name: "re-login that removes admin: saved through hooks from a fresh copy, and audited", Method: http.MethodPost,
			URL: "/api/collections/users/auth-with-oauth2", Body: strings.NewReader(oauth2PlainLogin),
			TestAppFactory: factory,
			BeforeTestFunc: func(t testing.TB, app *tests.TestApp, _ *core.ServeEvent) {
				linkedUser(t, app, "ava.martinez@example.com", true, []string{"bunking.manage", "users.manage"}, []any{"staff"})
				writeUnderneath(app, recomputed)
			},
			ExpectedStatus: http.StatusOK, ExpectedContent: []string{`"isNew":false`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				u := findUser(t, app, "ava.martinez@example.com")
				assertAccess(t, u, false, recomputed)
				if got := u.GetString("name"); got != "Changed Underneath" {
					t.Errorf("name = %q, the admin-sync save overwrote the concurrent write", got)
				}
				expectJustNow(t, u, "last_login", "last_seen")
				removed := 0
				for _, r := range audittest.Rows(t, app) {
					if r.GetString("action") == audit.ActionAdminRemoved {
						removed++
					}
				}
				if removed != 1 {
					t.Errorf("admin_removed audit rows = %d, want 1", removed)
				}
			},
		},
	}
	for _, s := range scenarios {
		s.Test(t)
	}
}

// TestOAuth2AdminSyncSaveFailureIsNotReported: when the admin-group save fails,
// the sign-in still succeeds (fail open), but the response must keep the stored
// is_admin and no admin_removed audit row may be written for a change that
// never persisted.
func TestOAuth2AdminSyncSaveFailureIsNotReported(t *testing.T) {
	s := tests.ApiScenario{
		Name: "admin removal whose save fails", Method: http.MethodPost,
		URL: "/api/collections/users/auth-with-oauth2", Body: strings.NewReader(oauth2PlainLogin),
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			app := newAuthTestApp(t, testAdminGroup)
			audittest.Setup(t, app)
			return app
		},
		BeforeTestFunc: func(t testing.TB, app *tests.TestApp, _ *core.ServeEvent) {
			linkedUser(t, app, "ava.martinez@example.com", true, []string{"bunking.manage"}, []any{"staff"})
			app.OnRecordUpdate("users").BindFunc(func(e *core.RecordEvent) error {
				return fmt.Errorf("simulated save failure")
			})
		},
		ExpectedStatus: http.StatusOK, ExpectedContent: []string{`"isNew":false`, `"is_admin":true`},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			assertAccess(t, findUser(t, app, "ava.martinez@example.com"), true, []string{"bunking.manage"})
			for _, r := range audittest.Rows(t, app) {
				if r.GetString("action") == audit.ActionAdminRemoved {
					t.Error("admin_removed audited although the save failed")
				}
			}
		},
	}
	s.Test(t)
}
