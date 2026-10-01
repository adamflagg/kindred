package rbac

import (
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/camp/kindred/pocketbase/audit"
	"github.com/camp/kindred/pocketbase/audit/audittest"
)

// usersManageRule is user_roles' create/update/delete rule exactly as
// migration 1500000071_rbac_user_roles.js writes it.
const usersManageRule = `@request.auth.is_admin = true || @request.auth.cached_permissions ~ "users.manage"`

// Fixed ids, so a scenario's URL can name a seeded row. PocketBase ids are 15
// [a-z0-9] characters.
const (
	urManagerID = "managerusr00001" // non-admin holding users.manage (via urManagerSelf)
	urTargetID  = "targetusr000001" // non-admin with an ordinary role and a users.manage role
	urFreshID   = "freshusr0000001" // non-admin with no roles yet
	urAdminID   = "adminusr0000001" // an admin

	urRoleBunking   = "rolebunking0001" // carries bunking.manage only
	urRoleUsers     = "roleusersmgr001" // carries users.manage
	urRoleRegistrar = "roleregistrar01" // carries registration.manage only

	urManagerSelf  = "urmanagerself01" // manager -> roleUsers
	urTargetBunk   = "urtargetbunk001" // target  -> roleBunking
	urTargetUsers  = "urtargetusers01" // target  -> roleUsers
	urAdminBunking = "uradminbunk0001" // admin   -> roleBunking
)

// newUserRolesBoundsApp is newAuthTestApp with user_roles carrying its
// production rules, the admin audit log registered (it classifies user_roles
// as Access), and a small cast of users, roles and assignments.
func newUserRolesBoundsApp(t testing.TB) *tests.TestApp {
	t.Helper()
	app := newAuthTestApp(t, testAdminGroup)
	setRule(t, app, "user_roles", func(c *core.Collection) {
		c.ListRule, c.ViewRule = types.Pointer(authedRule), types.Pointer(authedRule)
		c.CreateRule = types.Pointer(usersManageRule)
		c.UpdateRule = types.Pointer(usersManageRule)
		c.DeleteRule = types.Pointer(usersManageRule)
	})
	audittest.Setup(t, app)
	// Batch on, as migration 1500000195 enables it in production: the Users
	// page saves through pb.createBatch(), so each sub-request must be guarded.
	settings := app.Settings()
	settings.Batch.Enabled = true
	settings.Batch.MaxRequests = 50
	settings.Batch.Timeout = 10
	mustSave(t, app, settings)

	createUserWithID(t, app, urManagerID, "jordan.lee@example.com", false, nil)
	createUserWithID(t, app, urTargetID, "casey.morgan@example.com", false, nil)
	createUserWithID(t, app, urFreshID, "sam.patel@example.com", false, nil)
	createUserWithID(t, app, urAdminID, "alex.rivera@example.com", true, nil)

	rolesCol, err := app.FindCollectionByNameOrId("roles")
	if err != nil {
		t.Fatalf("find roles: %v", err)
	}
	for id, perms := range map[string][]string{
		urRoleBunking:   {"bunking.manage"},
		urRoleUsers:     {"registration.manage", "users.manage"},
		urRoleRegistrar: {"registration.manage"},
	} {
		role := core.NewRecord(rolesCol)
		role.Id = id
		role.Set("name", id)
		role.Set("permissions", perms)
		mustSave(t, app, role)
	}

	urCol, err := app.FindCollectionByNameOrId("user_roles")
	if err != nil {
		t.Fatalf("find user_roles: %v", err)
	}
	for id, link := range map[string][2]string{
		urManagerSelf:  {urManagerID, urRoleUsers},
		urTargetBunk:   {urTargetID, urRoleBunking},
		urTargetUsers:  {urTargetID, urRoleUsers},
		urAdminBunking: {urAdminID, urRoleBunking},
	} {
		ur := core.NewRecord(urCol)
		ur.Id = id
		ur.Set("user", link[0])
		ur.Set("role", link[1])
		mustSave(t, app, ur) // Go save: recomputes cached_permissions, logs nothing
	}

	// The seed must leave the manager holding users.manage (the precondition
	// every refusal below depends on) and the audit log empty.
	manager, err := app.FindRecordById("users", urManagerID)
	if err != nil {
		t.Fatalf("find manager: %v", err)
	}
	if !slices.Contains(cachedPermissions(t, manager), "users.manage") || manager.GetBool("is_admin") {
		t.Fatalf("seed: manager should be a non-admin users.manage holder, got admin=%v perms=%v",
			manager.GetBool("is_admin"), cachedPermissions(t, manager))
	}
	if rows := audittest.Rows(t, app); len(rows) != 0 {
		t.Fatalf("seed wrote %d audit rows, want 0", len(rows))
	}
	return app
}

// userRoleLinks returns every user_roles row as "user->role", sorted.
func userRoleLinks(t testing.TB, app core.App) []string {
	t.Helper()
	rows, err := app.FindAllRecords("user_roles")
	if err != nil {
		t.Fatalf("find user_roles: %v", err)
	}
	links := make([]string, 0, len(rows))
	for _, r := range rows {
		links = append(links, r.GetString("user")+"->"+r.GetString("role"))
	}
	slices.Sort(links)
	return links
}

// seededLinks is userRoleLinks right after newUserRolesBoundsApp.
var seededLinks = func() []string {
	l := []string{
		urManagerID + "->" + urRoleUsers,
		urTargetID + "->" + urRoleBunking,
		urTargetID + "->" + urRoleUsers,
		urAdminID + "->" + urRoleBunking,
	}
	slices.Sort(l)
	return l
}()

// expectRefusedUntouched: nothing changed and nothing was logged.
func expectRefusedUntouched(t testing.TB, app *tests.TestApp) {
	t.Helper()
	if got := userRoleLinks(t, app); !slices.Equal(got, seededLinks) {
		t.Errorf("user_roles changed on a refused write:\n got %v\nwant %v", got, seededLinks)
	}
	if rows := audittest.Rows(t, app); len(rows) != 0 {
		t.Errorf("a refused write left %d audit rows, want 0", len(rows))
	}
}

// expectOneAccessRow: an allowed write is in the audit log as Access.
func expectOneAccessRow(action, recordID string) check {
	return func(t testing.TB, app *tests.TestApp) {
		t.Helper()
		rows := audittest.Rows(t, app)
		if len(rows) != 1 {
			t.Fatalf("audit rows = %d, want 1", len(rows))
		}
		row := rows[0]
		if row.GetString("type") != audit.TypeAccess || row.GetString("action") != action ||
			row.GetString("collection") != "user_roles" {
			t.Errorf("audit row = %s, want an access %s on user_roles", audittest.Dump(t, row), action)
		}
		if recordID != "" && row.GetString("record_id") != recordID {
			t.Errorf("audit row record_id = %q, want %q", row.GetString("record_id"), recordID)
		}
	}
}

func expectLinks(want ...string) check {
	return func(t testing.TB, app *tests.TestApp) {
		t.Helper()
		slices.Sort(want)
		if got := userRoleLinks(t, app); !slices.Equal(got, want) {
			t.Errorf("user_roles:\n got %v\nwant %v", got, want)
		}
	}
}

func without(links []string, drop string) []string {
	return slices.DeleteFunc(slices.Clone(links), func(l string) bool { return l == drop })
}

func with(links []string, add string) []string { return append(slices.Clone(links), add) }

// check is one assertion about the app after a scenario's request.
type check func(t testing.TB, app *tests.TestApp)

// afterFunc is tests.ApiScenario.AfterTestFunc's type.
type afterFunc func(t testing.TB, app *tests.TestApp, res *http.Response)

// after runs checks as a scenario's AfterTestFunc. The harness owns, and
// closes, the response; no check reads it.
func after(checks ...check) afterFunc {
	return func(t testing.TB, app *tests.TestApp, _ *http.Response) {
		t.Helper()
		for _, c := range checks {
			c(t, app)
		}
	}
}

// TestUserRolesBounds: a non-admin users.manage holder may hand out and take
// back ordinary roles for other non-admins, and nothing else. Admins and the
// superuser are unrestricted.
func TestUserRolesBounds(t *testing.T) {
	headers := map[string]string{}
	factory := func(t testing.TB) *tests.TestApp {
		clear(headers)
		return newUserRolesBoundsApp(t)
	}
	as := func(userID, viewAs string) func(testing.TB, *tests.TestApp, *core.ServeEvent) {
		return func(t testing.TB, app *tests.TestApp, _ *core.ServeEvent) {
			u, err := app.FindRecordById("users", userID)
			if err != nil {
				t.Fatalf("find %s: %v", userID, err)
			}
			authAs(t, headers, u)
			if viewAs != "" {
				headers[ViewAsHeader] = viewAs
			}
		}
	}
	asSuperuser := func(t testing.TB, app *tests.TestApp, _ *core.ServeEvent) {
		authAs(t, headers, createSuperuser(t, app))
	}
	grant := func(userID, roleID string) *strings.Reader {
		return strings.NewReader(`{"user":"` + userID + `","role":"` + roleID + `"}`)
	}
	const records = "/api/collections/user_roles/records"
	grantItem := func(userID, roleID string) string {
		return `{"method":"POST","url":"` + records + `","body":{"user":"` + userID + `","role":"` + roleID + `"}}`
	}
	batchOf := func(items ...string) *strings.Reader {
		return strings.NewReader(`{"requests":[` + strings.Join(items, ",") + `]}`)
	}
	link := func(u, r string) string { return u + "->" + r }

	scenarios := []tests.ApiScenario{
		// --- a non-admin users.manage holder: refused ---
		{
			Name: "manager cannot give themselves a role", Method: http.MethodPost, URL: records,
			Body: grant(urManagerID, urRoleBunking), BeforeTestFunc: as(urManagerID, ""),
			ExpectedStatus: http.StatusForbidden, ExpectedContent: []string{"your own roles"},
			AfterTestFunc: after(expectRefusedUntouched),
		},
		{
			Name: "manager cannot remove one of their own roles", Method: http.MethodDelete,
			URL: records + "/" + urManagerSelf, BeforeTestFunc: as(urManagerID, ""),
			ExpectedStatus: http.StatusForbidden, ExpectedContent: []string{"your own roles"},
			AfterTestFunc: after(expectRefusedUntouched),
		},
		{
			Name: "manager cannot give an admin a role", Method: http.MethodPost, URL: records,
			Body: grant(urAdminID, urRoleRegistrar), BeforeTestFunc: as(urManagerID, ""),
			ExpectedStatus: http.StatusForbidden, ExpectedContent: []string{"an admin's roles"},
			AfterTestFunc: after(expectRefusedUntouched),
		},
		{
			Name: "manager cannot remove an admin's role", Method: http.MethodDelete,
			URL: records + "/" + urAdminBunking, BeforeTestFunc: as(urManagerID, ""),
			ExpectedStatus: http.StatusForbidden, ExpectedContent: []string{"an admin's roles"},
			AfterTestFunc: after(expectRefusedUntouched),
		},
		{
			Name: "manager cannot grant a role carrying users.manage", Method: http.MethodPost, URL: records,
			Body: grant(urFreshID, urRoleUsers), BeforeTestFunc: as(urManagerID, ""),
			ExpectedStatus: http.StatusForbidden, ExpectedContent: []string{"carries users.manage"},
			AfterTestFunc: after(expectRefusedUntouched, func(t testing.TB, app *tests.TestApp) {
				assertAccess(t, findUser(t, app, "sam.patel@example.com"), false, nil)
			}),
		},
		{
			Name: "manager cannot remove a role carrying users.manage", Method: http.MethodDelete,
			URL: records + "/" + urTargetUsers, BeforeTestFunc: as(urManagerID, ""),
			ExpectedStatus: http.StatusForbidden, ExpectedContent: []string{"carries users.manage"},
			AfterTestFunc: after(expectRefusedUntouched),
		},
		{
			// An in-place edit could move an ordinary assignment onto a
			// users.manage role, an admin, or the actor; a non-admin is
			// refused every update, which also covers each of those.
			Name: "manager cannot edit an assignment in place", Method: http.MethodPatch,
			URL: records + "/" + urTargetBunk, Body: strings.NewReader(`{"role":"` + urRoleRegistrar + `"}`),
			BeforeTestFunc: as(urManagerID, ""),
			ExpectedStatus: http.StatusForbidden, ExpectedContent: []string{"remove the role and add"},
			AfterTestFunc: after(expectRefusedUntouched),
		},
		{
			Name: "manager cannot retarget an assignment at themselves", Method: http.MethodPatch,
			URL: records + "/" + urTargetBunk, Body: strings.NewReader(`{"user":"` + urManagerID + `"}`),
			BeforeTestFunc: as(urManagerID, ""),
			ExpectedStatus: http.StatusForbidden, ExpectedContent: []string{"remove the role and add"},
			AfterTestFunc: after(expectRefusedUntouched),
		},
		{
			// A preview downgrades and never grants: an admin previewing a
			// users.manage persona is bounded exactly like that persona.
			Name: "an admin previewing users.manage is bounded like the persona", Method: http.MethodPost,
			URL: records, Body: grant(urFreshID, urRoleUsers), BeforeTestFunc: as(urAdminID, "users.manage"),
			ExpectedStatus: http.StatusForbidden, ExpectedContent: []string{"carries users.manage"},
			AfterTestFunc: after(expectRefusedUntouched),
		},

		{
			// /api/batch runs each sub-request through the record create and
			// delete actions, so the guard fires per sub-request; one refusal
			// fails the whole batch and its transaction rolls the allowed
			// sub-request back with it.
			Name: "a batch with one refused grant is refused whole", Method: http.MethodPost, URL: "/api/batch",
			Body:            batchOf(grantItem(urFreshID, urRoleBunking), grantItem(urFreshID, urRoleUsers)),
			BeforeTestFunc:  as(urManagerID, ""),
			ExpectedStatus:  http.StatusBadRequest,
			ExpectedContent: []string{`"requests":{"1":`, `"status":403`, "carries users.manage"},
			AfterTestFunc:   after(expectRefusedUntouched),
		},

		// --- a non-admin users.manage holder: allowed ---
		{
			Name: "manager can grant an ordinary role to another non-admin", Method: http.MethodPost, URL: records,
			Body: grant(urFreshID, urRoleBunking), BeforeTestFunc: as(urManagerID, ""),
			ExpectedStatus: http.StatusOK, ExpectedContent: []string{`"role":"` + urRoleBunking + `"`},
			AfterTestFunc: after(
				expectLinks(with(seededLinks, link(urFreshID, urRoleBunking))...),
				expectOneAccessRow(audit.ActionCreate, ""),
				func(t testing.TB, app *tests.TestApp) {
					assertAccess(t, findUser(t, app, "sam.patel@example.com"), false, []string{"bunking.manage"})
				},
			),
		},
		{
			Name: "manager can remove an ordinary role from another non-admin", Method: http.MethodDelete,
			URL: records + "/" + urTargetBunk, BeforeTestFunc: as(urManagerID, ""),
			ExpectedStatus: http.StatusNoContent,
			AfterTestFunc: after(
				expectLinks(without(seededLinks, link(urTargetID, urRoleBunking))...),
				expectOneAccessRow(audit.ActionDelete, urTargetBunk),
			),
		},

		{
			Name: "manager can grant an ordinary role inside a batch", Method: http.MethodPost, URL: "/api/batch",
			Body: batchOf(grantItem(urFreshID, urRoleBunking)), BeforeTestFunc: as(urManagerID, ""),
			ExpectedStatus: http.StatusOK, ExpectedContent: []string{`"role":"` + urRoleBunking + `"`},
			AfterTestFunc: after(
				expectLinks(with(seededLinks, link(urFreshID, urRoleBunking))...),
				expectOneAccessRow(audit.ActionCreate, ""),
			),
		},

		// --- an admin: unrestricted ---
		{
			Name: "admin can grant a role carrying users.manage", Method: http.MethodPost, URL: records,
			Body: grant(urFreshID, urRoleUsers), BeforeTestFunc: as(urAdminID, ""),
			ExpectedStatus: http.StatusOK, ExpectedContent: []string{`"role":"` + urRoleUsers + `"`},
			AfterTestFunc: after(
				expectLinks(with(seededLinks, link(urFreshID, urRoleUsers))...),
				expectOneAccessRow(audit.ActionCreate, ""),
			),
		},
		{
			Name: "admin can remove a role carrying users.manage", Method: http.MethodDelete,
			URL: records + "/" + urManagerSelf, BeforeTestFunc: as(urAdminID, ""),
			ExpectedStatus: http.StatusNoContent,
			AfterTestFunc: after(
				expectLinks(without(seededLinks, link(urManagerID, urRoleUsers))...),
				expectOneAccessRow(audit.ActionDelete, urManagerSelf),
			),
		},
		{
			Name: "admin can give themselves a role", Method: http.MethodPost, URL: records,
			Body: grant(urAdminID, urRoleRegistrar), BeforeTestFunc: as(urAdminID, ""),
			ExpectedStatus: http.StatusOK, ExpectedContent: []string{`"user":"` + urAdminID + `"`},
			AfterTestFunc: after(
				expectLinks(with(seededLinks, link(urAdminID, urRoleRegistrar))...),
				expectOneAccessRow(audit.ActionCreate, ""),
			),
		},
		{
			Name: "admin can remove an admin's role", Method: http.MethodDelete,
			URL: records + "/" + urAdminBunking, BeforeTestFunc: as(urAdminID, ""),
			ExpectedStatus: http.StatusNoContent,
			AfterTestFunc: after(
				expectLinks(without(seededLinks, link(urAdminID, urRoleBunking))...),
				expectOneAccessRow(audit.ActionDelete, urAdminBunking),
			),
		},
		{
			Name: "admin can edit an assignment in place", Method: http.MethodPatch,
			URL: records + "/" + urTargetBunk, Body: strings.NewReader(`{"role":"` + urRoleRegistrar + `"}`),
			BeforeTestFunc: as(urAdminID, ""),
			ExpectedStatus: http.StatusOK, ExpectedContent: []string{`"role":"` + urRoleRegistrar + `"`},
			AfterTestFunc: after(
				expectLinks(with(without(seededLinks, link(urTargetID, urRoleBunking)),
					link(urTargetID, urRoleRegistrar))...),
				expectOneAccessRow(audit.ActionUpdate, urTargetBunk),
			),
		},

		// --- the superuser: unrestricted ---
		{
			Name: "superuser can grant a role carrying users.manage", Method: http.MethodPost, URL: records,
			Body: grant(urFreshID, urRoleUsers), BeforeTestFunc: asSuperuser,
			ExpectedStatus: http.StatusOK, ExpectedContent: []string{`"role":"` + urRoleUsers + `"`},
			AfterTestFunc: after(expectLinks(with(seededLinks, link(urFreshID, urRoleUsers))...)),
		},
	}
	for _, s := range scenarios {
		s.TestAppFactory, s.Headers = factory, headers
		s.Test(t)
	}
}

// TestRoleCarriesIsExactMembership: the users.manage check is exact codename
// membership, not the rule's LIKE substring match.
func TestRoleCarriesIsExactMembership(t *testing.T) {
	for _, tc := range []struct {
		name string
		raw  any
		want bool
	}{
		{"carries it", types.JSONRaw(`["bunking.manage","users.manage"]`), true},
		{"a string slice", []string{"users.manage"}, true},
		{"a longer codename containing it", types.JSONRaw(`["users.manage.audit"]`), false},
		{"a prefix of it", types.JSONRaw(`["users.man"]`), false},
		{"ordinary role", types.JSONRaw(`["bunking.manage"]`), false},
		{"no permissions", types.JSONRaw(`[]`), false},
		{"null", nil, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			perms, err := rolePermissions(tc.raw)
			if err != nil {
				t.Fatalf("rolePermissions(%v): %v", tc.raw, err)
			}
			if got := slices.Contains(perms, permUsersManage); got != tc.want {
				t.Errorf("carries users.manage = %v, want %v (perms %v)", got, tc.want, perms)
			}
		})
	}
	if _, err := rolePermissions(types.JSONRaw(`{"not":"a list"}`)); err == nil {
		t.Error("rolePermissions accepted a non-list; an unreadable role must fail closed")
	}
}
