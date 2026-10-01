package rbac

import (
	"net/http"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/camp/kindred/pocketbase/audit"
	"github.com/camp/kindred/pocketbase/audit/audittest"
)

func TestShouldStampLastSeen(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)
	at := func(d time.Duration) types.DateTime { v, _ := types.ParseDateTime(now.Add(-d)); return v }
	cases := []struct {
		name string
		prev types.DateTime
		want bool
	}{
		{"never stamped", types.DateTime{}, true},
		{"59 minutes ago", at(59 * time.Minute), false},
		{"61 minutes ago", at(61 * time.Minute), true},
		{"months ago", at(90 * 24 * time.Hour), true},
	}
	for _, c := range cases {
		if got := shouldStampLastSeen(c.prev, now); got != c.want {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
}

func lastSeenApp(t testing.TB) *tests.TestApp {
	t.Helper()
	app, err := tests.NewTestAppWithConfig(core.BaseAppConfig{DataDir: t.TempDir()})
	if err != nil {
		t.Fatalf("new test app: %v", err)
	}
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatalf("find users: %v", err)
	}
	users.Fields.Add(&core.DateField{Name: "last_seen"}, &core.DateField{Name: "last_login"})
	if err := app.Save(users); err != nil {
		t.Fatalf("save users: %v", err)
	}
	registerLastSeenHook(app)
	return app
}

func newUser(t testing.TB, app core.App, email string, lastSeen time.Time) *core.Record {
	t.Helper()
	col, _ := app.FindCollectionByNameOrId("users")
	u := core.NewRecord(col)
	u.SetEmail(email)
	u.SetPassword("correct-horse-battery")
	if !lastSeen.IsZero() {
		u.Set("last_seen", lastSeen)
	}
	if err := app.Save(u); err != nil {
		t.Fatalf("save user: %v", err)
	}
	return u
}

func TestAuthRefreshStampsLastSeen(t *testing.T) {
	headers := map[string]string{}
	type checkFn func(t testing.TB, before time.Time, got types.DateTime)
	refresh := func(name, email string, prev time.Time, check checkFn) tests.ApiScenario {
		return tests.ApiScenario{
			Name: name, Method: http.MethodPost, URL: "/api/collections/users/auth-refresh", Headers: headers,
			ExpectedStatus: 200, ExpectedContent: []string{`"token"`},
			TestAppFactory: func(t testing.TB) *tests.TestApp {
				app := lastSeenApp(t)
				u := newUser(t, app, email, prev)
				token, err := u.NewAuthToken()
				if err != nil {
					t.Fatalf("token: %v", err)
				}
				headers["Authorization"] = token
				return app
			},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				u, err := app.FindAuthRecordByEmail("users", email)
				if err != nil {
					t.Fatalf("find: %v", err)
				}
				check(t, prev, u.GetDateTime("last_seen"))
			},
		}
	}
	stamped := func(t testing.TB, _ time.Time, got types.DateTime) {
		if got.IsZero() || time.Since(got.Time()) > time.Minute {
			t.Errorf("last_seen = %v, want just now", got)
		}
	}
	untouched := func(t testing.TB, before time.Time, got types.DateTime) {
		if !got.Time().Equal(before.Truncate(time.Millisecond)) {
			t.Errorf("last_seen = %v, want unchanged %v", got, before)
		}
	}
	for _, s := range []tests.ApiScenario{
		refresh("first refresh stamps", "emma@example.com", time.Time{}, stamped),
		refresh("stale stamp is refreshed", "liam@example.com", time.Now().Add(-2*time.Hour), stamped),
		refresh("fresh stamp is left alone", "olivia@example.com", time.Now().Add(-10*time.Minute).UTC(), untouched),
		refresh("view-as stand-in is never stamped", "va0123456789abc@"+viewAsPersonaEmailDomain, time.Time{},
			func(t testing.TB, _ time.Time, got types.DateTime) {
				if !got.IsZero() {
					t.Errorf("stand-in last_seen = %v, want empty", got)
				}
			}),
	} {
		s.Test(t)
	}
}

// TestLastSeenStampIsNotAudited: the stamp is a save inside an auth hook, not a
// record-update request, so the audit log must stay empty (spec §3.5).
func TestLastSeenStampIsNotAudited(t *testing.T) {
	headers := map[string]string{}
	s := tests.ApiScenario{
		Name: "refresh with audit registered", Method: http.MethodPost, URL: "/api/collections/users/auth-refresh",
		Headers: headers, ExpectedStatus: 200, ExpectedContent: []string{`"token"`},
		TestAppFactory: func(t testing.TB) *tests.TestApp {
			app := lastSeenApp(t)
			audittest.CreateCollection(t, app)
			audit.Register(app, audit.Config{ServiceEmail: audittest.ServiceEmail})
			u := newUser(t, app, "samuel@example.com", time.Time{})
			token, err := u.NewAuthToken()
			if err != nil {
				t.Fatalf("token: %v", err)
			}
			headers["Authorization"] = token
			return app
		},
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			n, err := app.CountRecords(audit.CollectionName)
			if err != nil {
				t.Fatalf("count: %v", err)
			}
			if n != 0 {
				t.Errorf("audit rows = %d, want 0", n)
			}
			u, _ := app.FindAuthRecordByEmail("users", "samuel@example.com")
			if u.GetDateTime("last_seen").IsZero() {
				t.Error("last_seen was not stamped")
			}
		},
	}
	s.Test(t)
}
