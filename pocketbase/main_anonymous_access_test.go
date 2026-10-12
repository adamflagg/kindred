package main

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/plugins/jsvm"
	"github.com/pocketbase/pocketbase/tests"
)

// anonymousAccessAllowlist names every (collection, action) a caller with no
// credentials at all is allowed through. Key: "<collection>.<action>", action
// one of list/view/create/update/delete. Value: why it must be public.
//
// It is empty, and should stay that way: every Kindred surface sits behind
// sign-in. An entry here is a deliberate decision to serve data to anyone on
// the internet, so it needs a reason a reviewer can argue with -- not a way to
// turn this test green.
var anonymousAccessAllowlist = map[string]string{}

// newMigratedTestApp returns a throwaway PocketBase app on an EMPTY data dir
// with every pb_migrations/*.js applied, exactly as `pocketbase serve` applies
// them on a fresh database.
//
// tests.NewTestApp() alone does not do this: it runs only the migrations
// already registered in core.AppMigrations, and the JS ones are registered by
// the jsvm plugin, which main() wires up and a test does not. So this registers
// jsvm itself, against pb_migrations, and runs them. core.AppMigrations is a
// package global, so it is swapped out for the duration and restored after:
// otherwise every later tests.NewTestApp() in this package would replay the
// Kindred migrations over PocketBase's demo data dir.
func newMigratedTestApp(t *testing.T) *tests.TestApp {
	t.Helper()
	app, err := tests.NewTestApp(t.TempDir())
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)

	saved := core.AppMigrations
	core.AppMigrations = core.MigrationsList{}
	defer func() { core.AppMigrations = saved }()

	// HooksDir points at an empty dir: this harness asserts what the schema
	// says, not what pb_hooks add on top.
	if err := jsvm.Register(app, jsvm.Config{MigrationsDir: "pb_migrations", HooksDir: t.TempDir()}); err != nil {
		t.Fatalf("register jsvm migrations: %v", err)
	}
	if n := len(core.AppMigrations.Items()); n == 0 {
		t.Fatal("jsvm registered no migrations from pb_migrations -- wrong working directory?")
	}
	if err := app.RunAppMigrations(); err != nil {
		t.Fatalf("apply pb_migrations: %v", err)
	}
	return app
}

var errProbeAdmitted = errors.New("rule probe: request admitted past the collection rule")

// TestNoCollectionIsReachableAnonymously applies every migration to a fresh
// database and then, for every collection, sends the five record requests
// (list, view, create, update, delete) with no credentials through
// PocketBase's real router, asserting each one is refused.
//
// In a rule, "" means PUBLIC -- anyone, no sign-in -- and nil means
// superusers only. Reading the rule strings would only catch the literal "";
// it would pass a filter an anonymous caller can still satisfy (say
// `@request.auth.id = ""`). So this asks PocketBase itself, which is the
// thing that will answer a real anonymous request:
//
//   - One row is seeded into every collection, so list/view/update/delete
//     have something to find. Without it a list returns nothing whatever the
//     rule says.
//   - A request hook on each action records whether the request got PAST the
//     rule. PocketBase evaluates list/view/update/delete rules while fetching
//     the record and the create rule against the submitted body, all before it
//     triggers these hooks, so reaching a hook means the rule let the caller
//     in (for list: the rule-filtered page is non-empty). The hook then aborts
//     the request, so nothing is written.
//   - The same probes sent as a superuser, who bypasses every rule, must ALL
//     be admitted. That is the control: it proves each probe reaches the rule
//     check at all, so a refusal for some unrelated reason (missing row, bad
//     route) cannot pass as a locked rule.
//
// What it cannot see: a rule that gates on a COLUMN rather than on the caller
// (`status = "published"`) is only tested against the seeded row's default
// values. Every rule today gates on @request.*, so the row does not matter.
//
// Only the rule layer is under test -- no Kindred Go hooks are registered --
// because the rules are what PocketBase enforces for every route, including
// ones a Go hook forgets. The users collection's OAuth2 create rule
// (`@request.context = "oauth2"`) is not reachable by a plain anonymous POST
// and is covered by rbac's users-guard tests.
func TestNoCollectionIsReachableAnonymously(t *testing.T) {
	app := newMigratedTestApp(t)

	var admitted bool
	app.OnRecordsListRequest().BindFunc(func(e *core.RecordsListRequestEvent) error {
		admitted = len(e.Records) > 0
		return errProbeAdmitted
	})
	app.OnRecordViewRequest().BindFunc(func(e *core.RecordRequestEvent) error {
		admitted = true
		return errProbeAdmitted
	})
	app.OnRecordCreateRequest().BindFunc(func(e *core.RecordRequestEvent) error {
		admitted = true
		return errProbeAdmitted
	})
	app.OnRecordUpdateRequest().BindFunc(func(e *core.RecordRequestEvent) error {
		admitted = true
		return errProbeAdmitted
	})
	app.OnRecordDeleteRequest().BindFunc(func(e *core.RecordRequestEvent) error {
		admitted = true
		return errProbeAdmitted
	})

	collections, err := app.FindAllCollections()
	if err != nil {
		t.Fatalf("list collections: %v", err)
	}

	// Seed one row everywhere. SaveNoValidate: the row only has to exist for
	// the rule to be evaluated against it; required fields and relations are
	// beside the point. Views get rows from the tables they select over.
	seeded := make(map[string]string, len(collections))
	var superuserToken string
	for _, c := range collections {
		if c.IsView() {
			continue
		}
		rec := core.NewRecord(c)
		if c.IsAuth() {
			rec.SetEmail("rule-probe-" + strings.TrimPrefix(c.Name, "_") + "@example.com")
			rec.SetRandomPassword()
		}
		if err = app.SaveNoValidate(rec); err != nil {
			t.Fatalf("seed a row into %s: %v", c.Name, err)
		}
		seeded[c.Name] = rec.Id
		if c.Name == core.CollectionNameSuperusers {
			if superuserToken, err = rec.NewAuthToken(); err != nil {
				t.Fatalf("superuser token: %v", err)
			}
		}
	}
	if superuserToken == "" {
		t.Fatal("no superuser was seeded, so the control probes cannot run")
	}

	router, err := apis.NewRouter(app)
	if err != nil {
		t.Fatalf("build router: %v", err)
	}
	mux, err := router.BuildMux()
	if err != nil {
		t.Fatalf("build mux: %v", err)
	}

	probe := func(method, url, token string) (bool, int) {
		admitted = false
		var body *strings.Reader
		if method == http.MethodPost || method == http.MethodPatch {
			body = strings.NewReader("{}")
		} else {
			body = strings.NewReader("")
		}
		req := httptest.NewRequest(method, url, body)
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", token)
		}
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		return admitted, rec.Code
	}

	type action struct {
		name, method string
		withID       bool
		rule         func(*core.Collection) *string
	}
	actions := []action{
		{"list", http.MethodGet, false, func(c *core.Collection) *string { return c.ListRule }},
		{"view", http.MethodGet, true, func(c *core.Collection) *string { return c.ViewRule }},
		{"create", http.MethodPost, false, func(c *core.Collection) *string { return c.CreateRule }},
		{"update", http.MethodPatch, true, func(c *core.Collection) *string { return c.UpdateRule }},
		{"delete", http.MethodDelete, true, func(c *core.Collection) *string { return c.DeleteRule }},
	}

	var probed []string
	stillAllowed := make(map[string]bool, len(anonymousAccessAllowlist))
	for _, c := range collections {
		id, ok := seeded[c.Name]
		if !ok {
			// A view: find a row it derives from the seeded tables, or say
			// plainly that this view went unchecked.
			var r struct {
				ID string `db:"id"`
			}
			if err := app.DB().Select("id").From(c.Name).Limit(1).One(&r); err != nil || r.ID == "" {
				t.Errorf("view collection %s has no row to probe, so its rules went unchecked -- "+
					"extend this test's seeding", c.Name)
				continue
			}
			id = r.ID
		}
		probed = append(probed, c.Name)

		for _, a := range actions {
			if c.IsView() && a.method != http.MethodGet {
				continue // views are read-only
			}
			url := "/api/collections/" + c.Name + "/records"
			if a.withID {
				url += "/" + id
			}
			key := c.Name + "." + a.name

			if ok, code := probe(a.method, url, superuserToken); !ok {
				t.Errorf("control: a superuser %s %s (%s) never reached the rule check (status %d) -- "+
					"the anonymous probe for it proves nothing", a.method, url, key, code)
				continue
			}

			ok, _ := probe(a.method, url, "")
			if _, allowed := anonymousAccessAllowlist[key]; allowed {
				stillAllowed[key] = ok
				continue
			}
			if ok {
				t.Errorf("%s: an anonymous %s %s got past the %sRule %s -- no sign-in needed; "+
					"use nil (superusers only) or a filter on @request.auth",
					key, a.method, url, a.name, ruleString(a.rule(c)))
			}
		}
	}

	for key, ok := range stillAllowed {
		if !ok {
			t.Errorf("allowlist entry %q is no longer reachable anonymously -- remove it", key)
		}
	}
	for key := range anonymousAccessAllowlist {
		if _, seen := stillAllowed[key]; !seen {
			t.Errorf("allowlist entry %q names no collection action this test probed -- remove it", key)
		}
	}

	// Without these the loop can pass by looking at nothing.
	for _, want := range []string{"users", "persons", "attendees", "aid_change_log", "admin_audit_log"} {
		if !slices.Contains(probed, want) {
			t.Errorf("collection %s was not probed (probed %d collections)", want, len(probed))
		}
	}
}

func ruleString(r *string) string {
	if r == nil {
		return "<nil: superusers only>"
	}
	return "\"" + *r + "\""
}
