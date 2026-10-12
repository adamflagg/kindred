package oidclogout_test

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"

	"github.com/camp/kindred/pocketbase/oidclogout"
	"github.com/camp/kindred/pocketbase/oidclogout/oidclogouttest"
)

// clock is a settable time source shared by the handler and the token minter.
type clock struct {
	mu  sync.Mutex
	now time.Time
}

func newClock() *clock { return &clock{now: time.Now().Truncate(time.Second)} }

func (c *clock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *clock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
}

// newApp is a fresh PocketBase whose users collection signs in through the
// "oidc" provider with the fake client id, as kindred-init configures it.
func newApp(t testing.TB) *tests.TestApp {
	t.Helper()
	app, err := tests.NewTestAppWithConfig(core.BaseAppConfig{DataDir: t.TempDir()})
	if err != nil {
		t.Fatalf("new test app: %v", err)
	}
	t.Cleanup(app.Cleanup)
	configureProvider(t, app)
	return app
}

// configureProvider enables the users collection's oidc provider.
func configureProvider(t testing.TB, app core.App) {
	t.Helper()
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatalf("find users: %v", err)
	}
	users.OAuth2.Enabled = true
	users.OAuth2.Providers = []core.OAuth2ProviderConfig{{
		Name:         "oidc",
		ClientId:     oidclogouttest.ClientID,
		ClientSecret: "test-secret",
		AuthURL:      "https://idp.example.com/authorize",
		TokenURL:     "https://idp.example.com/api/oidc/token",
		UserInfoURL:  "https://idp.example.com/api/oidc/userinfo",
	}}
	if err := app.Save(users); err != nil {
		t.Fatalf("configure oidc provider: %v", err)
	}
}

// linkedUser creates a users record linked to the IdP subject sub through
// provider, the way an OAuth2 sign-in links it.
func linkedUser(t testing.TB, app core.App, email, provider, sub string) *core.Record {
	t.Helper()
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatalf("find users: %v", err)
	}
	u := core.NewRecord(users)
	u.SetEmail(email)
	u.SetPassword(rand.Text())
	if err := app.Save(u); err != nil {
		t.Fatalf("save user: %v", err)
	}
	ea := core.NewExternalAuth(app)
	ea.SetCollectionRef(users.Id)
	ea.SetRecordRef(u.Id)
	ea.SetProvider(provider)
	ea.SetProviderId(sub)
	if err := app.Save(ea); err != nil {
		t.Fatalf("save external auth: %v", err)
	}
	return u
}

// serve builds the app's router the way `serve` does, with the endpoint bound.
func serve(t testing.TB, app core.App, cfg oidclogout.Config) http.Handler {
	t.Helper()
	oidclogout.Register(app, cfg)
	r, err := apis.NewRouter(app)
	if err != nil {
		t.Fatalf("new router: %v", err)
	}
	var mux http.Handler
	se := &core.ServeEvent{App: app, Router: r}
	if err := app.OnServe().Trigger(se, func(e *core.ServeEvent) error {
		m, err := e.Router.BuildMux()
		mux = m
		return err
	}); err != nil {
		t.Fatalf("serve: %v", err)
	}
	return mux
}

func form(token string) string { return url.Values{"logout_token": {token}}.Encode() }

func post(mux http.Handler, contentType, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, oidclogout.Path, strings.NewReader(body))
	req.Header.Set("Content-Type", contentType)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func logout(mux http.Handler, token string) *httptest.ResponseRecorder {
	return post(mux, "application/x-www-form-urlencoded", form(token))
}

// refreshStatus is the status of a real auth-refresh carrying token.
func refreshStatus(mux http.Handler, token string) int {
	req := httptest.NewRequest(http.MethodPost, "/api/collections/users/auth-refresh", http.NoBody)
	req.Header.Set("Authorization", token)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec.Code
}

func tokenKey(t testing.TB, app core.App, id string) string {
	t.Helper()
	r, err := app.FindRecordById("users", id)
	if err != nil {
		t.Fatalf("reload user: %v", err)
	}
	return r.TokenKey()
}

func authToken(t testing.TB, u *core.Record) string {
	t.Helper()
	tok, err := u.NewAuthToken()
	if err != nil {
		t.Fatalf("auth token: %v", err)
	}
	return tok
}

func assertNoStore(t testing.TB, rec *httptest.ResponseRecorder) {
	t.Helper()
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store", got)
	}
}

func assertInvalidRequest(t testing.TB, rec *httptest.ResponseRecorder) {
	t.Helper()
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body %s)", rec.Code, rec.Body)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("body %q is not JSON: %v", rec.Body, err)
	}
	if len(body) != 1 || body["error"] != "invalid_request" {
		t.Errorf("body = %s, want exactly {\"error\":\"invalid_request\"}", rec.Body)
	}
	assertNoStore(t, rec)
}

type fixture struct {
	app   *tests.TestApp
	idp   *oidclogouttest.Provider
	clk   *clock
	mux   http.Handler
	alice *core.Record
	bob   *core.Record
}

func newFixture(t testing.TB) *fixture {
	t.Helper()
	f := &fixture{app: newApp(t), idp: oidclogouttest.New(t), clk: newClock()}
	f.alice = linkedUser(t, f.app, "alice@example.com", "oidc", "sub-alice")
	f.bob = linkedUser(t, f.app, "bob@example.com", "oidc", "sub-bob")
	f.mux = serve(t, f.app, oidclogout.Config{Issuer: f.idp.Issuer, Now: f.clk.Now})
	return f
}

func TestValidLogoutTokenEndsEverySessionOfThatUserOnly(t *testing.T) {
	f := newFixture(t)
	aliceToken, bobToken := authToken(t, f.alice), authToken(t, f.bob)
	if got := refreshStatus(f.mux, aliceToken); got != http.StatusOK {
		t.Fatalf("auth-refresh before logout = %d, want 200", got)
	}
	aliceKey, bobKey := tokenKey(t, f.app, f.alice.Id), tokenKey(t, f.app, f.bob.Id)

	rec := logout(f.mux, f.idp.Mint(t, f.idp.Claims("sub-alice", f.clk.Now())))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body %s)", rec.Code, rec.Body)
	}
	assertNoStore(t, rec)
	if tokenKey(t, f.app, f.alice.Id) == aliceKey {
		t.Error("alice's tokenKey did not change")
	}
	if got := refreshStatus(f.mux, aliceToken); got != http.StatusUnauthorized {
		t.Errorf("auth-refresh with alice's old token = %d, want 401", got)
	}
	if _, err := f.app.FindRecordById("users", f.alice.Id); err != nil {
		t.Errorf("alice's record is gone (logout must not delete it): %v", err)
	}
	if tokenKey(t, f.app, f.bob.Id) != bobKey {
		t.Error("bob's tokenKey changed on alice's logout")
	}
	if got := refreshStatus(f.mux, bobToken); got != http.StatusOK {
		t.Errorf("auth-refresh with bob's token = %d, want 200", got)
	}
}

func TestInvalidLogoutTokensAreRefusedAndChangeNothing(t *testing.T) {
	other := oidclogouttest.NewRSAKey(t, "key-1") // same kid, wrong key
	cases := []struct {
		name  string
		token func(t testing.TB, f *fixture) string
	}{
		{"signature from another key", func(t testing.TB, f *fixture) string {
			return oidclogouttest.Sign(t, other, f.idp.Claims("sub-alice", f.clk.Now()))
		}},
		{"alg none", func(t testing.TB, f *fixture) string {
			tok := jwt.NewWithClaims(jwt.SigningMethodNone, f.idp.Claims("sub-alice", f.clk.Now()))
			tok.Header["kid"] = "key-1"
			s, err := tok.SignedString(jwt.UnsafeAllowNoneSignatureType)
			if err != nil {
				t.Fatalf("sign none: %v", err)
			}
			return s
		}},
		{"HMAC", func(t testing.TB, f *fixture) string {
			tok := jwt.NewWithClaims(jwt.SigningMethodHS256, f.idp.Claims("sub-alice", f.clk.Now()))
			tok.Header["kid"] = "key-1"
			s, err := tok.SignedString([]byte(oidclogouttest.ClientID))
			if err != nil {
				t.Fatalf("sign HS256: %v", err)
			}
			return s
		}},
		{"wrong iss", claims(func(c jwt.MapClaims) { c["iss"] = "https://evil.example.com" })},
		{"missing iss", claims(func(c jwt.MapClaims) { delete(c, "iss") })},
		{"wrong aud", claims(func(c jwt.MapClaims) { c["aud"] = []string{"some-other-client"} })},
		{"missing aud", claims(func(c jwt.MapClaims) { delete(c, "aud") })},
		{"missing events", claims(func(c jwt.MapClaims) { delete(c, "events") })},
		{"events without the logout event", claims(func(c jwt.MapClaims) {
			c["events"] = map[string]any{"http://schemas.openid.net/event/other": map[string]any{}}
		})},
		{"nonce present", claims(func(c jwt.MapClaims) { c["nonce"] = "n-0S6_WzA2Mj" })},
		{"iat older than five minutes", func(t testing.TB, f *fixture) string {
			c := f.idp.Claims("sub-alice", f.clk.Now().Add(-6*time.Minute))
			c["exp"] = f.clk.Now().Add(time.Hour).Unix()
			return f.idp.Mint(t, c)
		}},
		{"iat in the future", func(t testing.TB, f *fixture) string {
			return f.idp.Mint(t, f.idp.Claims("sub-alice", f.clk.Now().Add(5*time.Minute)))
		}},
		{"missing iat", claims(func(c jwt.MapClaims) { delete(c, "iat") })},
		{"expired", func(t testing.TB, f *fixture) string {
			c := f.idp.Claims("sub-alice", f.clk.Now().Add(-3*time.Minute))
			c["exp"] = f.clk.Now().Add(-time.Minute).Unix()
			return f.idp.Mint(t, c)
		}},
		{"missing jti", claims(func(c jwt.MapClaims) { delete(c, "jti") })},
		{"neither sub nor sid", claims(func(c jwt.MapClaims) { delete(c, "sub") })},
		{"sid only (sessions are not tracked by sid)", claims(func(c jwt.MapClaims) {
			delete(c, "sub")
			c["sid"] = "session-1"
		})},
		{"not a JWT", func(testing.TB, *fixture) string { return "not-a-jwt" }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := newFixture(t)
			old := authToken(t, f.alice)
			key := tokenKey(t, f.app, f.alice.Id)

			assertInvalidRequest(t, logout(f.mux, tc.token(t, f)))

			if tokenKey(t, f.app, f.alice.Id) != key {
				t.Error("tokenKey changed on a refused token")
			}
			if got := refreshStatus(f.mux, old); got != http.StatusOK {
				t.Errorf("auth-refresh after a refused token = %d, want 200", got)
			}
		})
	}
}

// claims mints a token for alice after applying mutate to otherwise valid claims.
func claims(mutate func(jwt.MapClaims)) func(t testing.TB, f *fixture) string {
	return func(t testing.TB, f *fixture) string {
		c := f.idp.Claims("sub-alice", f.clk.Now())
		mutate(c)
		return f.idp.Mint(t, c)
	}
}

func TestMalformedRequestsAreRefused(t *testing.T) {
	f := newFixture(t)
	valid := func() string { return f.idp.Mint(t, f.idp.Claims("sub-alice", f.clk.Now())) }
	cases := []struct {
		name, contentType, body string
	}{
		{"JSON body", "application/json", `{"logout_token":"` + valid() + `"}`},
		{"no content type", "", form(valid())},
		{"missing logout_token", "application/x-www-form-urlencoded", "other=1"},
		{"two logout_tokens", "application/x-www-form-urlencoded",
			url.Values{"logout_token": {valid(), valid()}}.Encode()},
		{"body over 64 KiB", "application/x-www-form-urlencoded",
			form(valid()) + "&pad=" + strings.Repeat("a", 64<<10)},
	}
	key := tokenKey(t, f.app, f.alice.Id)
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assertInvalidRequest(t, post(f.mux, tc.contentType, tc.body))
		})
	}
	if tokenKey(t, f.app, f.alice.Id) != key {
		t.Error("tokenKey changed on a malformed request")
	}
	// The charset parameter is legal on the form media type.
	rec := post(f.mux, "application/x-www-form-urlencoded; charset=utf-8", form(valid()))
	if rec.Code != http.StatusOK {
		t.Errorf("form with charset: status = %d, want 200 (body %s)", rec.Code, rec.Body)
	}
}

func TestReplayedTokenIsRefused(t *testing.T) {
	f := newFixture(t)
	tok := f.idp.Mint(t, f.idp.Claims("sub-alice", f.clk.Now()))
	if rec := logout(f.mux, tok); rec.Code != http.StatusOK {
		t.Fatalf("first delivery: status = %d, want 200", rec.Code)
	}
	key := tokenKey(t, f.app, f.alice.Id)
	assertInvalidRequest(t, logout(f.mux, tok))
	if tokenKey(t, f.app, f.alice.Id) != key {
		t.Error("a replayed token rotated the tokenKey again")
	}
}

func TestUnknownSubjectIsANoOp(t *testing.T) {
	f := newFixture(t)
	// The same subject linked through a different provider is not ours.
	carol := linkedUser(t, f.app, "carol@example.com", "google", "sub-carol")
	keys := map[string]string{}
	for _, u := range []*core.Record{f.alice, f.bob, carol} {
		keys[u.Id] = tokenKey(t, f.app, u.Id)
	}
	for _, sub := range []string{"sub-nobody", "sub-carol"} {
		rec := logout(f.mux, f.idp.Mint(t, f.idp.Claims(sub, f.clk.Now())))
		if rec.Code != http.StatusOK {
			t.Errorf("%s: status = %d, want 200 (nothing to log out)", sub, rec.Code)
		}
		assertNoStore(t, rec)
	}
	for id, key := range keys {
		if tokenKey(t, f.app, id) != key {
			t.Errorf("user %s's tokenKey changed", id)
		}
	}
}

func TestOnlyPOSTIsAllowed(t *testing.T) {
	f := newFixture(t)
	for _, m := range []string{http.MethodGet, http.MethodPut, http.MethodPatch, http.MethodDelete} {
		req := httptest.NewRequest(m, oidclogout.Path, http.NoBody)
		rec := httptest.NewRecorder()
		f.mux.ServeHTTP(rec, req)
		if rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("%s: status = %d, want 405", m, rec.Code)
		}
		if got := rec.Header().Get("Allow"); got != http.MethodPost {
			t.Errorf("%s: Allow = %q, want POST", m, got)
		}
		assertNoStore(t, rec)
	}
}

func TestNotConfiguredIsNotFound(t *testing.T) {
	idp := oidclogouttest.New(t)
	tok := idp.Mint(t, idp.Claims("sub-alice", time.Now()))

	t.Run("no issuer", func(t *testing.T) {
		app := newApp(t)
		rec := logout(serve(t, app, oidclogout.Config{}), tok)
		if rec.Code != http.StatusNotFound {
			t.Errorf("status = %d, want 404", rec.Code)
		}
		assertNoStore(t, rec)
	})
	t.Run("no oidc provider on users", func(t *testing.T) {
		app := newApp(t)
		users, _ := app.FindCollectionByNameOrId("users")
		users.OAuth2.Providers = nil
		if err := app.Save(users); err != nil {
			t.Fatalf("save users: %v", err)
		}
		rec := logout(serve(t, app, oidclogout.Config{Issuer: idp.Issuer}), tok)
		if rec.Code != http.StatusNotFound {
			t.Errorf("status = %d, want 404", rec.Code)
		}
	})
	t.Run("oauth2 disabled on users", func(t *testing.T) {
		app := newApp(t)
		users, _ := app.FindCollectionByNameOrId("users")
		users.OAuth2.Enabled = false
		if err := app.Save(users); err != nil {
			t.Fatalf("save users: %v", err)
		}
		rec := logout(serve(t, app, oidclogout.Config{Issuer: idp.Issuer}), tok)
		if rec.Code != http.StatusNotFound {
			t.Errorf("status = %d, want 404", rec.Code)
		}
	})
}

func TestUnknownKidRefetchesAtMostOncePerInterval(t *testing.T) {
	f := newFixture(t)
	if rec := logout(f.mux, f.idp.Mint(t, f.idp.Claims("sub-bob", f.clk.Now()))); rec.Code != http.StatusOK {
		t.Fatalf("first token: status = %d, want 200", rec.Code)
	}
	if got := f.idp.JWKSFetches(); got != 1 {
		t.Fatalf("JWKS fetches after the first token = %d, want 1", got)
	}

	rotated := oidclogouttest.NewRSAKey(t, "key-2")
	unknown := func() string { return oidclogouttest.Sign(t, rotated, f.idp.Claims("sub-alice", f.clk.Now())) }

	// Inside the interval since that fetch, an unknown kid fetches nothing.
	assertInvalidRequest(t, logout(f.mux, unknown()))
	if got := f.idp.JWKSFetches(); got != 1 {
		t.Fatalf("JWKS fetches right after the first fetch = %d, want 1 (rate-limited)", got)
	}

	f.clk.Advance(2 * time.Minute)
	assertInvalidRequest(t, logout(f.mux, unknown()))
	if got := f.idp.JWKSFetches(); got != 2 {
		t.Fatalf("JWKS fetches after one unknown kid = %d, want 2 (one refetch)", got)
	}
	for range 5 {
		assertInvalidRequest(t, logout(f.mux, unknown()))
	}
	if got := f.idp.JWKSFetches(); got != 2 {
		t.Fatalf("JWKS fetches after six unknown kids = %d, want 2 (rate-limited)", got)
	}

	// The provider rotates; once the interval has passed the new key is picked up.
	f.idp.Publish(rotated)
	f.clk.Advance(2 * time.Minute)
	if rec := logout(f.mux, unknown()); rec.Code != http.StatusOK {
		t.Fatalf("token from the rotated key: status = %d, want 200 (body %s)", rec.Code, rec.Body)
	}
	if got := f.idp.JWKSFetches(); got != 3 {
		t.Errorf("JWKS fetches after rotation = %d, want 3", got)
	}
}

// A caller that hangs up must not abort the key fetch its request triggered. A
// failed fetch closes the fetch window for a minute, so an unauthenticated
// caller hanging up once a window would otherwise keep the endpoint keyless,
// and the provider's genuine logouts in that minute would be refused for good.
func TestCancelledRequestDoesNotAbortTheKeyFetch(t *testing.T) {
	f := newFixture(t)
	stranger := oidclogouttest.NewRSAKey(t, "stranger")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	body := form(oidclogouttest.Sign(t, stranger, f.idp.Claims("sub-bob", f.clk.Now())))
	req := httptest.NewRequest(http.MethodPost, oidclogout.Path, strings.NewReader(body)).WithContext(ctx)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	f.mux.ServeHTTP(httptest.NewRecorder(), req)

	rec := logout(f.mux, f.idp.Mint(t, f.idp.Claims("sub-alice", f.clk.Now())))
	if rec.Code != http.StatusOK {
		t.Fatalf("genuine token after a cancelled request: status = %d, want 200 (body %s)", rec.Code, rec.Body)
	}
}

func TestNonRSAKeysVerify(t *testing.T) {
	for _, key := range []oidclogouttest.Key{
		oidclogouttest.NewECKey(t, "ec-1"),
		oidclogouttest.NewEd25519Key(t, "ed-1"),
	} {
		t.Run(key.Alg.Alg(), func(t *testing.T) {
			app := newApp(t)
			idp := oidclogouttest.NewWithKeys(t, key)
			alice := linkedUser(t, app, "alice@example.com", "oidc", "sub-alice")
			before := tokenKey(t, app, alice.Id)
			mux := serve(t, app, oidclogout.Config{Issuer: idp.Issuer})
			rec := logout(mux, idp.Mint(t, idp.Claims("sub-alice", time.Now())))
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200 (body %s)", rec.Code, rec.Body)
			}
			if tokenKey(t, app, alice.Id) == before {
				t.Error("tokenKey did not change")
			}
		})
	}
}

func TestKeysOlderThanAnHourAreRefetched(t *testing.T) {
	f := newFixture(t)
	if rec := logout(f.mux, f.idp.Mint(t, f.idp.Claims("sub-bob", f.clk.Now()))); rec.Code != http.StatusOK {
		t.Fatalf("first token: status = %d, want 200", rec.Code)
	}
	f.clk.Advance(30 * time.Minute)
	if rec := logout(f.mux, f.idp.Mint(t, f.idp.Claims("sub-bob", f.clk.Now()))); rec.Code != http.StatusOK {
		t.Fatalf("token at 30 minutes: status = %d, want 200", rec.Code)
	}
	if got := f.idp.JWKSFetches(); got != 1 {
		t.Fatalf("JWKS fetches at 30 minutes = %d, want 1 (keys still fresh)", got)
	}
	f.clk.Advance(31 * time.Minute)
	if rec := logout(f.mux, f.idp.Mint(t, f.idp.Claims("sub-alice", f.clk.Now()))); rec.Code != http.StatusOK {
		t.Fatalf("token at 61 minutes: status = %d, want 200", rec.Code)
	}
	if got := f.idp.JWKSFetches(); got != 2 {
		t.Errorf("JWKS fetches at 61 minutes = %d, want 2 (keys refetched)", got)
	}
}

func TestTokenAlgMustMatchTheKeysDeclaredAlg(t *testing.T) {
	f := newFixture(t)
	k := f.idp.SigningKey() // published with alg RS256
	k.Alg = jwt.SigningMethodPS256
	assertInvalidRequest(t, logout(f.mux, oidclogouttest.Sign(t, k, f.idp.Claims("sub-alice", f.clk.Now()))))
}

func TestDiscoveryMustNameTheConfiguredIssuer(t *testing.T) {
	f := newFixture(t)
	f.idp.SetDiscoveryIssuer("https://impostor.example.com")
	assertInvalidRequest(t, logout(f.mux, f.idp.Mint(t, f.idp.Claims("sub-alice", f.clk.Now()))))
	if got := f.idp.JWKSFetches(); got != 0 {
		t.Errorf("JWKS fetched %d times from a discovery document naming another issuer", got)
	}
}

func TestIssuerWithATrailingSlashStillMatches(t *testing.T) {
	app := newApp(t)
	idp := oidclogouttest.New(t)
	linkedUser(t, app, "alice@example.com", "oidc", "sub-alice")
	mux := serve(t, app, oidclogout.Config{Issuer: idp.Issuer + "/"})
	if rec := logout(mux, idp.Mint(t, idp.Claims("sub-alice", time.Now()))); rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200 (body %s)", rec.Code, rec.Body)
	}
}

func TestStorageFailureLetsTheSameTokenBeRetried(t *testing.T) {
	f := newFixture(t)
	failSave := true
	f.app.OnRecordUpdate("users").BindFunc(func(e *core.RecordEvent) error {
		if failSave {
			return errors.New("disk full")
		}
		return e.Next()
	})
	key := tokenKey(t, f.app, f.alice.Id)
	tok := f.idp.Mint(t, f.idp.Claims("sub-alice", f.clk.Now()))

	if rec := logout(f.mux, tok); rec.Code != http.StatusInternalServerError {
		t.Fatalf("delivery during a storage failure: status = %d, want 500 (body %s)", rec.Code, rec.Body)
	}
	if tokenKey(t, f.app, f.alice.Id) != key {
		t.Fatal("tokenKey changed although the save failed")
	}

	// The spec lets a provider resend the same logout_token after a 5xx; the
	// failed attempt must not have spent its jti.
	failSave = false
	if rec := logout(f.mux, tok); rec.Code != http.StatusOK {
		t.Fatalf("retry of the same token after the failure: status = %d, want 200 (body %s)", rec.Code, rec.Body)
	}
	if tokenKey(t, f.app, f.alice.Id) == key {
		t.Error("the retry did not rotate alice's tokenKey")
	}
	assertInvalidRequest(t, logout(f.mux, tok))
}
