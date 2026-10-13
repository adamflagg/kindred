package version

import (
	"net/http"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

const versionURL = "/api/custom/version"

// newVersionTestApp is a bare PocketBase with this package's route mounted
// through the same RegisterRoutes main.go calls.
func newVersionTestApp(t testing.TB) *tests.TestApp {
	t.Helper()
	app, err := tests.NewTestAppWithConfig(core.BaseAppConfig{DataDir: t.TempDir()})
	if err != nil {
		t.Fatalf("new test app: %v", err)
	}
	return app
}

// signIn creates an ordinary (non-admin, no roles) user and puts its token in
// headers, so the scenario runs as "any signed-in user".
func signIn(t testing.TB, app core.App, headers map[string]string) {
	t.Helper()
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatalf("find users: %v", err)
	}
	u := core.NewRecord(users)
	u.SetEmail("emma.johnson@example.com")
	u.SetPassword("correct-horse-battery-staple")
	if err = app.Save(u); err != nil {
		t.Fatalf("save user: %v", err)
	}
	token, err := u.NewAuthToken()
	if err != nil {
		t.Fatalf("auth token: %v", err)
	}
	headers["Authorization"] = token
}

func TestVersionEndpoint(t *testing.T) {
	headers := map[string]string{}
	factory := func(t testing.TB) *tests.TestApp {
		clear(headers)
		return newVersionTestApp(t)
	}
	mount := func(withUser bool) func(testing.TB, *tests.TestApp, *core.ServeEvent) {
		return func(t testing.TB, app *tests.TestApp, e *core.ServeEvent) {
			RegisterRoutes(e)
			if withUser {
				signIn(t, app, headers)
			}
		}
	}

	t.Run("signed-in user gets the image's baked version", func(t *testing.T) {
		t.Setenv(EnvVar, "v6.4.0-248-gc35904c")
		(&tests.ApiScenario{
			Name: "signed in", Method: http.MethodGet, URL: versionURL, Headers: headers,
			TestAppFactory: factory, BeforeTestFunc: mount(true),
			ExpectedStatus:  http.StatusOK,
			ExpectedContent: []string{`{"pocketbase":"v6.4.0-248-gc35904c"}`},
		}).Test(t)
	})

	t.Run("no baked version reads as dev", func(t *testing.T) {
		t.Setenv(EnvVar, "")
		(&tests.ApiScenario{
			Name: "unset", Method: http.MethodGet, URL: versionURL, Headers: headers,
			TestAppFactory: factory, BeforeTestFunc: mount(true),
			ExpectedStatus:  http.StatusOK,
			ExpectedContent: []string{`{"pocketbase":"dev"}`},
		}).Test(t)
	})

	t.Run("anonymous request is refused", func(t *testing.T) {
		t.Setenv(EnvVar, "v6.4.0-248-gc35904c")
		(&tests.ApiScenario{
			Name: "anonymous", Method: http.MethodGet, URL: versionURL, Headers: headers,
			TestAppFactory: factory, BeforeTestFunc: mount(false),
			ExpectedStatus:     http.StatusUnauthorized,
			NotExpectedContent: []string{"v6.4.0"},
		}).Test(t)
	})
}
