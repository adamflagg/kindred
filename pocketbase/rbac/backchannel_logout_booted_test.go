package rbac

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/camp/kindred/pocketbase/audit"
	"github.com/camp/kindred/pocketbase/audit/audittest"
	"github.com/camp/kindred/pocketbase/oidclogout"
	"github.com/camp/kindred/pocketbase/oidclogout/oidclogouttest"
)

// TestBootedBackchannelLogoutEndsTheUsersSessions runs in CI's "Booted auth
// rules agreement" step: on the users collection the REAL migrations built,
// with Kindred's users hooks and the audit log bound as main.go binds them, a
// valid logout token makes the user's existing token fail a real auth-refresh,
// and touches nothing but tokenKey (not is_admin, cached_permissions or the
// sign-in stamps, and the record is not deleted).
func TestBootedBackchannelLogoutEndsTheUsersSessions(t *testing.T) {
	app := newBootedTestApp(t)
	defer app.Cleanup()
	RegisterHooks(app)
	audit.Register(app, audit.Config{ServiceEmail: audittest.ServiceEmail})
	idp := oidclogouttest.New(t)
	oidclogout.Register(app, oidclogout.Config{Issuer: idp.Issuer})

	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatalf("find users: %v", err)
	}
	users.OAuth2.Enabled = true
	users.OAuth2.Providers = []core.OAuth2ProviderConfig{{
		Name: "oidc", ClientId: oidclogouttest.ClientID, ClientSecret: "test-secret",
		AuthURL:     "https://idp.example.com/authorize",
		TokenURL:    "https://idp.example.com/api/oidc/token",
		UserInfoURL: "https://idp.example.com/api/oidc/userinfo",
	}}
	mustSave(t, app, users)

	lastLogin, _ := types.ParseDateTime(time.Date(2026, 6, 1, 9, 0, 0, 0, time.UTC))
	u := core.NewRecord(users)
	u.SetEmail("dana@example.com")
	u.SetPassword("correct-horse-battery-staple")
	u.Set(fieldIsAdmin, true)
	u.Set(fieldCachedPermissions, []string{"metrics.geo"})
	u.Set(fieldLastLogin, lastLogin)
	mustSave(t, app, u)
	link := core.NewExternalAuth(app)
	link.SetCollectionRef(users.Id)
	link.SetRecordRef(u.Id)
	link.SetProvider("oidc")
	link.SetProviderId("sub-dana")
	mustSave(t, app, link)
	oldToken, err := u.NewAuthToken()
	if err != nil {
		t.Fatalf("auth token: %v", err)
	}

	mux := bootedMux(t, app)
	const refresh = "/api/collections/users/auth-refresh"
	if got := bootedRequest(mux, http.MethodPost, refresh, oldToken, "", ""); got.Code != http.StatusOK {
		t.Fatalf("auth-refresh before logout = %d, want 200 (body %s)", got.Code, got.Body)
	}

	body := url.Values{"logout_token": {idp.Mint(t, idp.Claims("sub-dana", time.Now()))}}.Encode()
	rec := bootedRequest(mux, http.MethodPost, oidclogout.Path, "", "application/x-www-form-urlencoded", body)
	if rec.Code != http.StatusOK {
		t.Fatalf("logout status = %d, want 200 (body %s)", rec.Code, rec.Body)
	}

	if got := bootedRequest(mux, http.MethodPost, refresh, oldToken, "", ""); got.Code != http.StatusUnauthorized {
		t.Errorf("auth-refresh with the old token after logout = %d, want 401", got.Code)
	}
	after, err := app.FindRecordById("users", u.Id)
	if err != nil {
		t.Fatalf("the user record is gone (logout must not delete it): %v", err)
	}
	if after.TokenKey() == u.TokenKey() {
		t.Error("tokenKey did not change")
	}
	if !after.GetBool(fieldIsAdmin) {
		t.Error("is_admin was cleared")
	}
	if got := after.GetStringSlice(fieldCachedPermissions); len(got) != 1 || got[0] != "metrics.geo" {
		t.Errorf("cached_permissions = %v, want [metrics.geo]", got)
	}
	if got := after.GetDateTime(fieldLastLogin); !got.Equal(lastLogin) {
		t.Errorf("last_login = %v, want %v", got, lastLogin)
	}
}

// bootedMux builds the app's router the way `serve` does.
func bootedMux(t testing.TB, app core.App) http.Handler {
	t.Helper()
	r, err := apis.NewRouter(app)
	if err != nil {
		t.Fatalf("new router: %v", err)
	}
	var mux http.Handler
	if err := app.OnServe().Trigger(&core.ServeEvent{App: app, Router: r}, func(e *core.ServeEvent) error {
		m, err := e.Router.BuildMux()
		mux = m
		return err //nolint:wrapcheck // test helper
	}); err != nil {
		t.Fatalf("serve: %v", err)
	}
	return mux
}

func bootedRequest(mux http.Handler, method, path, authToken, contentType, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if authToken != "" {
		req.Header.Set("Authorization", authToken)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}
