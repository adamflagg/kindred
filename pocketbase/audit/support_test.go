package audit_test

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/camp/kindred/pocketbase/audit"
	"github.com/camp/kindred/pocketbase/audit/audittest"
)

// Rules as production writes them (1500000181 users hardening, 1500000130
// lodging, the bunking.manage shape of 1500000077). Restated, not imported:
// this package must not depend on rbac.
const (
	adminRule    = `@request.auth.is_admin = true`
	bunkingRule  = `@request.auth.is_admin = true || @request.auth.cached_permissions ~ "bunking.manage"`
	usersManage  = `@request.auth.is_admin = true || @request.auth.cached_permissions ~ "users.manage"`
	authedRule   = `@request.auth.id != ""`
	testPassword = "correct-horse-battery-staple"
)

// Fictional people (tests/CLAUDE.md): the admin, a bunking-staff member, the
// owner's personal superuser.
const (
	adminEmail = "alex.rivera@example.com"
	staffEmail = "jordan.lee@example.com"
	ownerEmail = "owner@example.com"
)

// newApp is an empty-data-dir PocketBase shaped like the collections the audit
// log touches, with the audit log registered and audittest.ServiceEmail as
// Kindred's service account.
func newApp(t testing.TB) *tests.TestApp {
	t.Helper()
	return newAppWith(t, audit.Config{ServiceEmail: audittest.ServiceEmail})
}

// newAppWith is newApp with an explicit audit Config.
func newAppWith(t testing.TB, cfg audit.Config) *tests.TestApp {
	t.Helper()
	app, err := tests.NewTestAppWithConfig(core.BaseAppConfig{DataDir: t.TempDir()})
	if err != nil {
		t.Fatalf("new test app: %v", err)
	}

	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatalf("find users: %v", err)
	}
	users.Fields.Add(&core.BoolField{Name: "is_admin"})
	users.Fields.Add(&core.JSONField{Name: "cached_permissions", MaxSize: 2000000})
	users.ListRule, users.ViewRule = types.Pointer(authedRule), types.Pointer(authedRule)
	users.CreateRule, users.UpdateRule, users.DeleteRule = nil, nil, nil
	mustSave(t, app, users)

	roles := core.NewBaseCollection("roles")
	roles.Fields.Add(&core.TextField{Name: "name"}, &core.JSONField{Name: "permissions", MaxSize: 2000000})
	roles.CreateRule, roles.UpdateRule, roles.DeleteRule = rule(adminRule), rule(adminRule), rule(adminRule)
	mustSave(t, app, roles)

	descriptions := core.NewBaseCollection("permission_descriptions")
	descriptions.Fields.Add(&core.TextField{Name: "codename"}, &core.TextField{Name: "description"})
	descriptions.CreateRule, descriptions.UpdateRule, descriptions.DeleteRule = rule(adminRule), rule(adminRule), rule(adminRule)
	mustSave(t, app, descriptions)

	userRoles := core.NewBaseCollection("user_roles")
	userRoles.Fields.Add(
		&core.RelationField{Name: "user", CollectionId: users.Id, MaxSelect: 1, CascadeDelete: true},
		&core.RelationField{Name: "role", CollectionId: roles.Id, MaxSelect: 1},
	)
	userRoles.CreateRule, userRoles.DeleteRule = types.Pointer(usersManage), types.Pointer(usersManage)
	mustSave(t, app, userRoles)

	config := core.NewBaseCollection("config")
	config.Fields.Add(
		&core.TextField{Name: "category"}, &core.TextField{Name: "subcategory"}, &core.TextField{Name: "config_key"},
		&core.JSONField{Name: "value", MaxSize: 2000000}, &core.JSONField{Name: "metadata", MaxSize: 2000000},
	)
	config.CreateRule, config.UpdateRule = types.Pointer(adminRule), types.Pointer(adminRule)
	mustSave(t, app, config)

	units := core.NewBaseCollection("lodging_units")
	units.Fields.Add(&core.TextField{Name: "name"}, &core.TextField{Name: "code"}, &core.NumberField{Name: "beds"},
		&core.TextField{Name: "notes"})
	units.CreateRule, units.UpdateRule, units.DeleteRule = rule(bunkingRule), rule(bunkingRule), rule(bunkingRule)
	mustSave(t, app, units)

	// Business work: never logged unless a superuser does it.
	bunkRequests := core.NewBaseCollection("bunk_requests")
	bunkRequests.Fields.Add(&core.TextField{Name: "status"})
	bunkRequests.CreateRule, bunkRequests.UpdateRule = types.Pointer(bunkingRule), types.Pointer(bunkingRule)
	mustSave(t, app, bunkRequests)

	audittest.CreateCollection(t, app)
	audit.Register(app, cfg)
	return app
}

func rule(r string) *string { return types.Pointer(r) }

func mustSave(t testing.TB, app core.App, m core.Model) {
	t.Helper()
	if err := app.Save(m); err != nil {
		t.Fatalf("save %T: %v", m, err)
	}
}

func createUser(t testing.TB, app core.App, id, email, name string, isAdmin bool, perms []string) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatalf("find users: %v", err)
	}
	u := core.NewRecord(col)
	if id != "" {
		u.Id = id
	}
	u.SetEmail(email)
	u.SetPassword(testPassword)
	u.Set("name", name)
	u.Set("is_admin", isAdmin)
	u.Set("cached_permissions", perms)
	mustSave(t, app, u)
	return u
}

func createSuperuser(t testing.TB, app core.App, email string) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId(core.CollectionNameSuperusers)
	if err != nil {
		t.Fatalf("find superusers: %v", err)
	}
	su := core.NewRecord(col)
	su.SetEmail(email)
	su.SetPassword(testPassword)
	mustSave(t, app, su)
	return su
}

func authAs(t testing.TB, headers map[string]string, record *core.Record) {
	t.Helper()
	token, err := record.NewAuthToken()
	if err != nil {
		t.Fatalf("auth token: %v", err)
	}
	headers["Authorization"] = token
}

func saveRecord(t testing.TB, app core.App, collection, id string, fields map[string]any) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId(collection)
	if err != nil {
		t.Fatalf("find %s: %v", collection, err)
	}
	r := core.NewRecord(col)
	r.Id = id
	for k, v := range fields {
		r.Set(k, v)
	}
	mustSave(t, app, r)
	return r
}
