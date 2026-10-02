package rbac

import (
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

func superuserCount(t testing.TB, app core.App) int {
	t.Helper()
	rows, err := app.FindAllRecords(core.CollectionNameSuperusers)
	if err != nil {
		t.Fatalf("list superusers: %v", err)
	}
	return len(rows)
}

// TestBatchRefusesSuperusersCollection: /api/batch is routed to PocketBase by
// Caddy, and Caddy's ADMIN_ALLOWLIST gate covers only the direct
// /api/collections/_superusers* paths. Without this guard a superuser token
// could do _superusers record CRUD from outside the allowlist by wrapping it
// in a batch.
func TestBatchRefusesSuperusersCollection(t *testing.T) {
	headers := map[string]string{}
	factory := func(t testing.TB) *tests.TestApp {
		clear(headers)
		return newUserRolesBoundsApp(t)
	}
	asSuperuser := func(t testing.TB, app *tests.TestApp, _ *core.ServeEvent) {
		authAs(t, headers, createSuperuser(t, app))
	}
	body := func(items ...string) *strings.Reader {
		return strings.NewReader(`{"requests":[` + strings.Join(items, ",") + `]}`)
	}
	superCreate := func(collection string) string {
		return `{"method":"POST","url":"/api/collections/` + collection + `/records","body":` +
			`{"email":"intruder@example.com","password":"correct-horse-battery-staple",` +
			`"passwordConfirm":"correct-horse-battery-staple"}}`
	}
	grant := `{"method":"POST","url":"/api/collections/user_roles/records","body":` +
		`{"user":"` + urFreshID + `","role":"` + urRoleBunking + `"}}`
	refusedInBatch := []string{"Superuser accounts can't be changed", `"status":403`}
	// Only the superuser the scenario itself created.
	expectOnlyTheCaller := func(t testing.TB, app *tests.TestApp) {
		t.Helper()
		if n := superuserCount(t, app); n != 1 {
			t.Errorf("%d superusers after a refused batch, want only the caller", n)
		}
	}

	scenarios := make([]tests.ApiScenario, 0, 10)
	for _, spelling := range []string{
		core.CollectionNameSuperusers, "_SUPERUSERS", "pbc_3142635823", "_\u017fuperusers", "_superuser\u017f",
	} {
		scenarios = append(scenarios, tests.ApiScenario{
			Name: "a _superusers create as " + spelling + " is refused", Method: http.MethodPost, URL: "/api/batch",
			Body: body(superCreate(spelling)), TestAppFactory: factory, BeforeTestFunc: asSuperuser, Headers: headers,
			ExpectedStatus: http.StatusBadRequest, ExpectedContent: refusedInBatch,
			AfterTestFunc: after(expectOnlyTheCaller),
		})
	}
	scenarios = append(scenarios,
		tests.ApiScenario{
			Name: "a percent-encoded name is a not-found, not a refusal", Method: http.MethodPost, URL: "/api/batch",
			Body: body(superCreate("%5Fsuperusers")), TestAppFactory: factory, BeforeTestFunc: asSuperuser, Headers: headers,
			ExpectedStatus: http.StatusBadRequest, ExpectedContent: []string{`"status":404`},
			NotExpectedContent: []string{"Superuser accounts can't be changed"},
			AfterTestFunc:      after(expectOnlyTheCaller),
		},
		tests.ApiScenario{
			Name: "the direct records API is not this hook's business", Method: http.MethodPost,
			URL: "/api/collections/_superusers/records",
			Body: strings.NewReader(`{"email":"direct@example.com","password":"correct-horse-battery-staple",` +
				`"passwordConfirm":"correct-horse-battery-staple"}`),
			TestAppFactory: factory, BeforeTestFunc: asSuperuser, Headers: headers,
			ExpectedStatus: http.StatusOK, ExpectedContent: []string{`"email":"direct@example.com"`},
		},
		tests.ApiScenario{
			Name: "one _superusers sub-request refuses the whole batch", Method: http.MethodPost, URL: "/api/batch",
			Body: body(grant, superCreate(core.CollectionNameSuperusers)), TestAppFactory: factory,
			BeforeTestFunc: asSuperuser, Headers: headers,
			ExpectedStatus: http.StatusBadRequest, ExpectedContent: refusedInBatch,
			AfterTestFunc: after(expectOnlyTheCaller, expectRefusedUntouched),
		},
		tests.ApiScenario{
			Name: "an ordinary user_roles batch is still allowed", Method: http.MethodPost, URL: "/api/batch",
			Body: body(grant), TestAppFactory: factory, BeforeTestFunc: asSuperuser, Headers: headers,
			ExpectedStatus: http.StatusOK, ExpectedContent: []string{`"status":200`},
			AfterTestFunc: after(expectLinks(with(seededLinks, urFreshID+"->"+urRoleBunking)...)),
		},
	)
	for _, s := range scenarios {
		s.Test(t)
	}
}
