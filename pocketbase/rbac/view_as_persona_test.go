package rbac

import (
	"fmt"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

var pbIDPattern = regexp.MustCompile(`^[a-z0-9]{15}$`)

// personaUsers returns every stand-in row in the users collection.
func personaUsers(t testing.TB, app core.App) []*core.Record {
	t.Helper()
	all, err := app.FindAllRecords("users",
		dbx.NewExp("email LIKE {:suffix}", dbx.Params{"suffix": "%@" + viewAsPersonaEmailDomain}))
	if err != nil {
		t.Fatalf("find persona users: %v", err)
	}
	return all
}

func TestViewAsPersonaID(t *testing.T) {
	a := viewAsPersonaID([]string{"metrics.geo", "registration.manage"})
	if !pbIDPattern.MatchString(a) || !strings.HasPrefix(a, "va") {
		t.Fatalf("viewAsPersonaID = %q, want 15 chars of [a-z0-9] starting with va", a)
	}
	if b := viewAsPersonaID([]string{"metrics.geo", "registration.manage"}); b != a {
		t.Errorf("same persona gave %q then %q; the id must be deterministic", a, b)
	}
	if c := viewAsPersonaID([]string{"bunking.manage"}); c == a {
		t.Errorf("different personas share id %q", c)
	}
	if empty := viewAsPersonaID([]string{}); !pbIDPattern.MatchString(empty) {
		t.Errorf("empty persona id %q is not a valid PocketBase id", empty)
	}
}

func TestViewAsPersonaName(t *testing.T) {
	if got := viewAsPersonaName([]string{}); got != "View as: No role" {
		t.Errorf("empty persona name = %q", got)
	}
	got := viewAsPersonaName([]string{"metrics.geo", "registration.manage"})
	want := "View as: metrics.geo · registration.manage"
	if got != want {
		t.Errorf("persona name = %q, want %q", got, want)
	}
}

func TestEnsureViewAsPersona(t *testing.T) {
	app := newAuthTestApp(t, testAdminGroup)
	perms := []string{"metrics.geo", "registration.manage"}

	first, err := ensureViewAsPersona(app, perms)
	if err != nil {
		t.Fatalf("ensureViewAsPersona: %v", err)
	}
	if first.Id != viewAsPersonaID(perms) {
		t.Errorf("stand-in id = %q, want %q", first.Id, viewAsPersonaID(perms))
	}
	if first.Email() != first.Id+"@"+viewAsPersonaEmailDomain {
		t.Errorf("stand-in email = %q", first.Email())
	}
	if !first.EmailVisibility() {
		t.Error("stand-in emailVisibility must be true so the Users page can recognize it")
	}
	assertAccess(t, first, false, perms)

	second, err := ensureViewAsPersona(app, perms)
	if err != nil {
		t.Fatalf("second ensureViewAsPersona: %v", err)
	}
	if second.Id != first.Id {
		t.Errorf("second call returned %q, want the same row %q", second.Id, first.Id)
	}
	if got := len(personaUsers(t, app)); got != 1 {
		t.Errorf("persona users after two calls for one persona = %d, want 1", got)
	}

	if _, err := ensureViewAsPersona(app, []string{}); err != nil {
		t.Fatalf("ensureViewAsPersona(no role): %v", err)
	}
	all := personaUsers(t, app)
	ids := make([]string, 0, len(all))
	for _, r := range all {
		ids = append(ids, r.Id)
	}
	if len(ids) != 2 || !slices.Contains(ids, viewAsPersonaID([]string{})) {
		t.Errorf("persona users = %v, want the Registrar and No-role stand-ins", ids)
	}
}

// TestEnsureViewAsPersonaRejectsSquatter pins the squatting hole: a real
// account (e.g. a first-time OAuth2 sign-up, which forwards client createData
// -- including a chosen id and email -- into the record create) can land at a
// persona's deterministic id/email before any admin ever previews it.
// ensureViewAsPersona must fail closed rather than silently treat that row as
// the stand-in and run every future preview of this persona as the squatter's
// real account. One row per branch verifyViewAsPersona checks: every row
// starts identical to a genuine stand-in and deviates in exactly the one way
// named, so each subtest pins that check alone.
func TestEnsureViewAsPersonaRejectsSquatter(t *testing.T) {
	perms := []string{"metrics.geo", "registration.manage"}
	id := viewAsPersonaID(perms)
	wantEmail := id + "@" + viewAsPersonaEmailDomain

	cases := []struct {
		name    string
		email   string
		isAdmin bool
		perms   []string
		extAuth bool
	}{
		{name: "wrong email", email: "squatter@example.com", isAdmin: false, perms: perms},
		{name: "is_admin true", email: wantEmail, isAdmin: true, perms: perms},
		{name: "cached_permissions mismatch", email: wantEmail, isAdmin: false, perms: []string{"other.permission"}},
		{name: "has external auth", email: wantEmail, isAdmin: false, perms: perms, extAuth: true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			app := newAuthTestApp(t, testAdminGroup)
			u := createUserWithID(t, app, id, tc.email, tc.isAdmin, tc.perms)

			if tc.extAuth {
				link := core.NewExternalAuth(app)
				link.SetCollectionRef(u.Collection().Id)
				link.SetRecordRef(u.Id)
				link.SetProvider(testOAuth2Provider)
				link.SetProviderId("idp-squatter")
				mustSave(t, app, link)
			}

			if _, err := ensureViewAsPersona(app, perms); err == nil {
				t.Fatalf("ensureViewAsPersona accepted a row failing check %q", tc.name)
			}
		})
	}
}

// TestViewAsPersonaNameCapsLength pins a permanent-500 trap: the users.name
// field has a 255-char cap, and an uncapped "View as: " + joined permissions
// name can exceed it once an admin's persona carries enough permissions.
func TestViewAsPersonaNameCapsLength(t *testing.T) {
	perms := make([]string, 0, 40)
	for i := range 40 {
		perms = append(perms, fmt.Sprintf("some.very.long.permission.codename.number.%02d", i))
	}
	got := viewAsPersonaName(perms)
	if n := len([]rune(got)); n > 255 {
		t.Fatalf("persona name is %d runes, exceeds the users.name 255-char cap: %q", n, got)
	}
	if !strings.HasSuffix(got, "…") {
		t.Errorf("a truncated persona name should end with an ellipsis, got %q", got)
	}
}
