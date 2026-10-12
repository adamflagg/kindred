//go:build !race

// Not built under the race detector. Applying pb_migrations runs every JS
// migration through the goja runtime, which the race detector slows from ~5s
// to ~208s on a CI shard, and the probes below run one at a time on the test
// goroutine, so there is no concurrency for it to find. CI runs this file in a
// non-race step instead: "Collection rule probes (no race detector)" in the
// tests-migrations job, which is gated on pb_migrations and on every .go file.
// tests/unit/scripts/test_ci_path_filters.py holds that step to this file.

package main

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"sort"
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

// anyAuthReadGaps is a RATCHET: the collections holding personal data that,
// today, every signed-in user can list or view, whatever their role. Each
// entry is a known gap, to be closed by giving the collection a
// permission-gated listRule and viewRule (`@request.auth.is_admin = true ||
// @request.auth.cached_permissions ~ "..."`, as bunk_assignments_draft has).
//
// The list may only shrink. TestNoPersonalDataIsReadableByAnySignedInUser
// fails if a personal-data collection that is NOT listed here becomes readable
// by any signed-in user, and also if a listed one stops being readable -- so
// closing a gap means deleting its line here in the same change.
var anyAuthReadGaps = []string{
	// Who can sign in, and with which role.
	"users",
	"user_roles",

	// Campers and their enrolment.
	"persons",
	"attendees",
	"attendee_status_history",

	// Summer bunking: who asked to bunk with whom, and where each camper sleeps.
	"bunk_requests",
	"bunk_assignments",

	// Family-camp lodging: which household sleeps where, and the free text
	// staff type about families (occupant names, write-ins, raw cabin strings).
	"lodging_assignments",
	"lodging_assignments_draft",
	"lodging_assignment_history",
	"lodging_availability",
	"lodging_friend_groups",
	"lodging_friend_group_members",
	"lodging_ingest_issues",
	"lodging_unit_aliases",
	"lodging_write_ins",
	"lodging_write_ins_draft",

	// No person columns, but `value` is free-form JSON the app writes settings
	// into, and nothing constrains what lands there. Not classified
	// non-personal until someone has looked at every key it holds.
	"config",
}

// nonPersonalCollections is the deliberate classification behind the ratchet:
// the collections that hold no personal data, so a rule letting every
// signed-in user read them is not a gap. Value: why.
//
// The classification is by exclusion on purpose. Every collection NOT named
// here counts as personal data, so a new collection fails closed: if it ships
// readable by any signed-in user, this test goes red until someone either
// gates it or comes here and says, in a reviewable line, that it holds nothing
// about a person. The opposite design -- a list of the personal collections --
// would let a new table of camper data through silently, which is the one
// mistake this guard exists to catch.
//
// "Personal" is read broadly: a row naming, identifying or describing a
// camper, family member, staff member or user -- including a bare CampMinder
// person or household id, and free text staff type about a family (an
// occupant name, a write-in). Only reference and structural data is listed.
var nonPersonalCollections = map[string]string{
	"camp_sessions":           "the session calendar: names, dates, grade and gender bounds",
	"divisions":               "age/grade divisions: names, grade and gender bounds, capacity",
	"bunks":                   "cabin names, gender and sort order",
	"bunk_plans":              "which bunk is used in which session",
	"roles":                   "role names and the permissions each grants -- no user is named",
	"permission_descriptions": "help text for each permission codename",
	"lodging_areas":           "family-camp lodging areas and their map positions",
	"lodging_units":           "cabins and rooms: capacity, amenities, accessibility",
	"lodging_field_mappings":  "which CampMinder custom field feeds which lodging column",
	"lodging_session_status":  "a planning status per session",
	"lodging_slot_merges":     "which units are combined for a session -- no household named",
}

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

	// HooksDir points at an EMPTY temp dir, so nothing in pb_hooks is loaded:
	// this harness asserts what the schema says, not what pb_hooks add on top.
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

// ruleProbe is a migrated app with one row seeded into every collection and
// hooks that report whether a record request got past the collection's rule.
type ruleProbe struct {
	app            *tests.TestApp
	mux            http.Handler
	collections    []*core.Collection
	rowIDs         map[string]string // collection name -> id of a row to probe
	superuserToken string

	// Set by the request hooks for the probe in flight.
	admitted bool
	// The signed-in caller's own record id, if any: a list that returns only
	// the caller's own row (a self-only rule on users) is not an admission.
	callerID string
}

type probeAction struct {
	name, method string
	withID       bool
	rule         func(*core.Collection) *string
}

var (
	probeList   = probeAction{"list", http.MethodGet, false, func(c *core.Collection) *string { return c.ListRule }}
	probeView   = probeAction{"view", http.MethodGet, true, func(c *core.Collection) *string { return c.ViewRule }}
	probeCreate = probeAction{"create", http.MethodPost, false, func(c *core.Collection) *string { return c.CreateRule }}
	probeUpdate = probeAction{"update", http.MethodPatch, true, func(c *core.Collection) *string { return c.UpdateRule }}
	probeDelete = probeAction{"delete", http.MethodDelete, true, func(c *core.Collection) *string { return c.DeleteRule }}
)

// newRuleProbe migrates a fresh app, seeds one row into every collection and
// builds PocketBase's real router over it.
//
// PocketBase evaluates list/view/update/delete rules while fetching the record
// and the create rule against the submitted body, all before it triggers the
// OnRecord*Request hooks bound here, so reaching a hook means the rule let the
// caller in (for list: the rule-filtered page holds a row that is not the
// caller's own). The hook then aborts the request, so nothing is written.
func newRuleProbe(t *testing.T) *ruleProbe {
	t.Helper()
	p := &ruleProbe{app: newMigratedTestApp(t)}
	app := p.app

	app.OnRecordsListRequest().BindFunc(func(e *core.RecordsListRequestEvent) error {
		p.admitted = slices.ContainsFunc(e.Records, func(r *core.Record) bool { return r.Id != p.callerID })
		return errProbeAdmitted
	})
	admit := func(*core.RecordRequestEvent) error {
		p.admitted = true
		return errProbeAdmitted
	}
	app.OnRecordViewRequest().BindFunc(admit)
	app.OnRecordCreateRequest().BindFunc(admit)
	app.OnRecordUpdateRequest().BindFunc(admit)
	app.OnRecordDeleteRequest().BindFunc(admit)

	var err error
	if p.collections, err = app.FindAllCollections(); err != nil {
		t.Fatalf("list collections: %v", err)
	}

	// Seed one row everywhere. SaveNoValidate: the row only has to exist for
	// the rule to be evaluated against it; required fields and relations are
	// beside the point. Views get rows from the tables they select over.
	p.rowIDs = make(map[string]string, len(p.collections))
	for _, c := range p.collections {
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
		p.rowIDs[c.Name] = rec.Id
		if c.Name == core.CollectionNameSuperusers {
			if p.superuserToken, err = rec.NewAuthToken(); err != nil {
				t.Fatalf("superuser token: %v", err)
			}
		}
	}
	if p.superuserToken == "" {
		t.Fatal("no superuser was seeded, so the control probes cannot run")
	}
	for _, c := range p.collections {
		if !c.IsView() {
			continue
		}
		// A view: find a row it derives from the seeded tables, or say plainly
		// that this view went unchecked.
		var r struct {
			ID string `db:"id"`
		}
		if err := app.DB().Select("id").From(c.Name).Limit(1).One(&r); err != nil || r.ID == "" {
			t.Errorf("view collection %s has no row to probe, so its rules went unchecked -- "+
				"extend this test's seeding", c.Name)
			continue
		}
		p.rowIDs[c.Name] = r.ID
	}

	router, err := apis.NewRouter(app)
	if err != nil {
		t.Fatalf("build router: %v", err)
	}
	if p.mux, err = router.BuildMux(); err != nil {
		t.Fatalf("build mux: %v", err)
	}
	return p
}

// send issues one record request as the given caller ("" token = anonymous)
// and reports whether it got past the collection rule.
func (p *ruleProbe) send(c *core.Collection, a probeAction, token, callerID string) (admitted bool, status int) {
	url := "/api/collections/" + c.Name + "/records"
	if a.withID {
		url += "/" + p.rowIDs[c.Name]
	}
	body := ""
	if a.method == http.MethodPost || a.method == http.MethodPatch {
		body = "{}"
	}
	req := httptest.NewRequest(a.method, url, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", token)
	}
	p.admitted, p.callerID = false, callerID
	rec := httptest.NewRecorder()
	p.mux.ServeHTTP(rec, req)
	return p.admitted, rec.Code
}

// controlled sends the probe as a superuser first, who bypasses every rule and
// so must be admitted. That is the control: it proves the probe reaches the
// rule check at all, so a refusal for some unrelated reason (missing row, bad
// route) cannot pass as a locked rule. ok is false when the control failed,
// and then the caller's result means nothing.
func (p *ruleProbe) controlled(t *testing.T, c *core.Collection, a probeAction, token, callerID string) (admitted, ok bool) {
	t.Helper()
	if in, code := p.send(c, a, p.superuserToken, ""); !in {
		t.Errorf("control: a superuser %s on %s never reached the rule check (status %d) -- "+
			"the probe for it proves nothing", a.name, c.Name, code)
		return false, false
	}
	admitted, _ = p.send(c, a, token, callerID)
	return admitted, true
}

// TestNoCollectionIsReachableAnonymously applies every migration to a fresh
// database and then, for every collection, sends the five record requests
// (list, view, create, update, delete) with no credentials through
// PocketBase's real router, asserting each one is refused.
//
// In a rule, "" means PUBLIC -- anyone, no sign-in -- and nil means
// superusers only. Reading the rule strings would only catch the literal "";
// it would pass a filter an anonymous caller can still satisfy (say
// `@request.auth.id = ""`). So this asks PocketBase itself, which is the
// thing that will answer a real anonymous request (see newRuleProbe for how a
// hook observes the rule's verdict, and ruleProbe.controlled for the
// superuser control that rules out a false green).
//
// What it cannot see: a rule that gates on a COLUMN rather than on the caller
// (`status = "published"`) is only tested against the seeded row's default
// values. Every rule today gates on @request.*, so the row does not matter.
//
// What it does NOT cover -- these need their own anonymous-access assertions:
//
//   - Anything in pb_hooks. HooksDir is an empty temp dir (newMigratedTestApp),
//     so no JS hook or JS-defined route is loaded, and a route added there is
//     not probed.
//   - Kindred's Go-registered routes and hooks, e.g. everything under
//     /api/custom/*. None is registered here; a custom route does not go
//     through a collection rule at all, so its own auth check is the only
//     guard and is tested next to it.
//   - The FastAPI service, which is a separate process.
//
// What it does cover is the collection rule layer, which PocketBase enforces
// on its own record routes (/api/collections/<name>/records) whatever any hook
// does or forgets. The users collection's OAuth2 create rule
// (`@request.context = "oauth2"`) is not reachable by a plain anonymous POST
// and is covered by rbac's users-guard tests.
func TestNoCollectionIsReachableAnonymously(t *testing.T) {
	p := newRuleProbe(t)

	var probed []string
	stillAllowed := make(map[string]bool, len(anonymousAccessAllowlist))
	for _, c := range p.collections {
		if _, ok := p.rowIDs[c.Name]; !ok {
			continue // a view with no row; newRuleProbe already failed the test
		}
		probed = append(probed, c.Name)

		for _, a := range []probeAction{probeList, probeView, probeCreate, probeUpdate, probeDelete} {
			if c.IsView() && a.method != http.MethodGet {
				continue // views are read-only
			}
			key := c.Name + "." + a.name
			in, ok := p.controlled(t, c, a, "", "")
			if !ok {
				continue
			}
			if _, allowed := anonymousAccessAllowlist[key]; allowed {
				stillAllowed[key] = in
				continue
			}
			if in {
				t.Errorf("%s: an anonymous %s got past the %sRule %s -- no sign-in needed; "+
					"use nil (superusers only) or a filter on @request.auth",
					key, a.method, a.name, ruleString(a.rule(c)))
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

	requireProbed(t, probed, "users", "persons", "attendees", "aid_change_log", "admin_audit_log")
}

// TestNoPersonalDataIsReadableByAnySignedInUser signs in as the plainest
// possible user -- a users record with every field at its default: not an
// admin, no cached permissions, no user_roles row -- and lists and views every
// collection. A collection that user can read is readable by EVERY signed-in
// user, whatever the rule's spelling: `@request.auth.id != ""` in either
// quote style, `@request.auth.email != ""`, an `||` branch any account
// satisfies. Asking PocketBase catches all of them; a string match would catch
// only the spellings someone thought to list.
//
// Each such collection must be classified non-personal (nonPersonalCollections)
// or be a known gap on the shrinking anyAuthReadGaps ratchet. Same limits as
// TestNoCollectionIsReachableAnonymously: a rule that gates on a column is
// tried against the seeded row only, and pb_hooks, Go custom routes and
// FastAPI are not covered.
func TestNoPersonalDataIsReadableByAnySignedInUser(t *testing.T) {
	p := newRuleProbe(t)
	token, userID := p.plainUser(t)
	p.requireSignedInControl(t, token, userID)

	readable := map[string]string{} // collection -> which rule let them in
	var probed []string
	for _, c := range p.collections {
		if _, ok := p.rowIDs[c.Name]; !ok {
			continue // a view with no row; newRuleProbe already failed the test
		}
		probed = append(probed, c.Name)
		var how []string
		for _, a := range []probeAction{probeList, probeView} {
			in, ok := p.controlled(t, c, a, token, userID)
			if ok && in {
				how = append(how, a.name+"Rule "+ruleString(a.rule(c)))
			}
		}
		if len(how) > 0 {
			readable[c.Name] = strings.Join(how, ", ")
		}
	}

	for _, problem := range anyAuthReadProblems(readable, probed, anyAuthReadGaps, nonPersonalCollections) {
		t.Error(problem)
	}
	requireProbed(t, probed, "users", "persons", "attendees", "bunk_requests", "lodging_assignments")
}

// plainUser seeds a second users record -- distinct from the probed row, so a
// self-only rule cannot pass as "anyone" -- and returns its auth token and id.
func (p *ruleProbe) plainUser(t *testing.T) (token, id string) {
	t.Helper()
	users, err := p.app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatalf("find users: %v", err)
	}
	u := core.NewRecord(users)
	u.SetEmail("rule-probe-member@example.com")
	u.SetRandomPassword()
	if err := p.app.SaveNoValidate(u); err != nil {
		t.Fatalf("seed the plain user: %v", err)
	}
	if token, err = u.NewAuthToken(); err != nil {
		t.Fatalf("plain user token: %v", err)
	}
	return token, u.Id
}

// requireSignedInControl proves the plain user's token is recognised as a
// sign-in at all. Without it, a token PocketBase ignored would make every
// probe look like an anonymous one, every collection would look locked, and
// the ratchet below would fail only on its stale entries -- or pass outright
// once the list is empty. A throwaway collection whose rule is exactly the
// "any signed-in user" rule must admit the plain user and refuse anonymity.
func (p *ruleProbe) requireSignedInControl(t *testing.T, token, userID string) {
	t.Helper()
	const anyAuth = `@request.auth.id != ""`
	control := core.NewBaseCollection("zz_rule_probe_signed_in_control")
	control.ListRule, control.ViewRule = new(anyAuth), new(anyAuth)
	if err := p.app.Save(control); err != nil {
		t.Fatalf("create the signed-in control collection: %v", err)
	}
	row := core.NewRecord(control)
	if err := p.app.SaveNoValidate(row); err != nil {
		t.Fatalf("seed the signed-in control collection: %v", err)
	}
	p.rowIDs[control.Name] = row.Id
	for _, a := range []probeAction{probeList, probeView} {
		if in, _ := p.send(control, a, token, userID); !in {
			t.Fatalf("control: the plain user was refused a %s on a %q collection -- "+
				"its token is not being read as a sign-in, so every probe would look anonymous", a.name, anyAuth)
		}
		if in, _ := p.send(control, a, "", ""); in {
			t.Fatalf("control: an anonymous %s got past %q -- the probe hooks are not observing rules", a.name, anyAuth)
		}
	}
}

// anyAuthReadProblems applies the ratchet. readable maps each collection every
// signed-in user can read to the rule(s) that let them in; probed is every
// collection the test looked at. Pure, so TestAnyAuthReadRatchet pins its
// verdicts without booting PocketBase.
func anyAuthReadProblems(readable map[string]string, probed, gaps []string, nonPersonal map[string]string) []string {
	var problems []string
	for name, how := range readable {
		if _, ok := nonPersonal[name]; ok || slices.Contains(gaps, name) {
			continue
		}
		problems = append(problems, fmt.Sprintf("%s: every signed-in user can read it (%s), and it is not "+
			"classified as non-personal -- gate the rule on a permission "+
			"(`@request.auth.is_admin = true || @request.auth.cached_permissions ~ \"...\"`), or, if it "+
			"really holds no personal data, add it to nonPersonalCollections with the reason", name, how))
	}
	for _, name := range gaps {
		if _, ok := nonPersonal[name]; ok {
			problems = append(problems, fmt.Sprintf("%s is in both anyAuthReadGaps and nonPersonalCollections -- "+
				"it holds personal data or it does not; remove one", name))
		}
		if _, still := readable[name]; still {
			continue
		}
		if !slices.Contains(probed, name) {
			problems = append(problems, fmt.Sprintf("anyAuthReadGaps names %s, which this test never probed "+
				"(renamed or dropped?) -- remove it", name))
			continue
		}
		problems = append(problems, fmt.Sprintf("%s is no longer readable by every signed-in user, so its gap "+
			"is closed -- delete it from anyAuthReadGaps so the list only shrinks", name))
	}
	for name := range nonPersonal {
		if !slices.Contains(probed, name) {
			problems = append(problems, fmt.Sprintf("nonPersonalCollections names %s, which this test never "+
				"probed (a typo, or a dropped collection) -- remove it", name))
		}
	}
	sort.Strings(problems)
	return problems
}

// TestAnyAuthReadRatchet pins anyAuthReadProblems' verdicts on fixtures, so
// the ratchet's two directions (new gap, stale gap) and its fail-closed
// classification are tested without depending on what the schema holds today.
func TestAnyAuthReadRatchet(t *testing.T) {
	probed := []string{"persons", "divisions", "households", "brand_new_table"}
	gaps := []string{"persons"}
	nonPersonal := map[string]string{"divisions": "reference data"}

	cases := []struct {
		name        string
		readable    map[string]string
		probed      []string
		gaps        []string
		nonPersonal map[string]string
		want        []string // one substring per expected problem, in order
	}{
		{
			name:     "a listed gap and a non-personal collection are both fine",
			readable: map[string]string{"persons": "listRule", "divisions": "listRule"},
			probed:   probed, gaps: gaps, nonPersonal: nonPersonal,
		},
		{
			name:     "an unlisted personal collection readable by anyone signed in fails",
			readable: map[string]string{"persons": "listRule", "households": "viewRule"},
			probed:   probed, gaps: gaps, nonPersonal: nonPersonal,
			want: []string{"households: every signed-in user can read it"},
		},
		{
			name:     "a new collection nobody classified fails closed",
			readable: map[string]string{"persons": "listRule", "brand_new_table": "listRule"},
			probed:   probed, gaps: gaps, nonPersonal: nonPersonal,
			want: []string{"brand_new_table: every signed-in user can read it"},
		},
		{
			name:     "a gap that has been closed must leave the list",
			readable: map[string]string{},
			probed:   probed, gaps: gaps, nonPersonal: nonPersonal,
			want: []string{"persons is no longer readable by every signed-in user"},
		},
		{
			name:     "a gap naming a collection that no longer exists must leave the list",
			readable: map[string]string{"persons": "listRule"},
			probed:   probed, gaps: []string{"persons", "ghost_table"}, nonPersonal: nonPersonal,
			want: []string{"anyAuthReadGaps names ghost_table, which this test never probed"},
		},
		{
			name:     "a non-personal entry naming no collection is a typo",
			readable: map[string]string{"persons": "listRule"},
			probed:   probed, gaps: gaps, nonPersonal: map[string]string{"divisons": "typo"},
			want: []string{"nonPersonalCollections names divisons, which this test never probed"},
		},
		{
			name:     "a collection cannot be both a gap and non-personal",
			readable: map[string]string{"persons": "listRule"},
			probed:   probed, gaps: gaps, nonPersonal: map[string]string{"persons": "wrong"},
			want: []string{"persons is in both anyAuthReadGaps and nonPersonalCollections"},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := anyAuthReadProblems(tc.readable, tc.probed, tc.gaps, tc.nonPersonal)
			if len(got) != len(tc.want) {
				t.Fatalf("got %d problems, want %d:\n%s", len(got), len(tc.want), strings.Join(got, "\n"))
			}
			for i, w := range tc.want {
				if !strings.Contains(got[i], w) {
					t.Errorf("problem %d = %q, want it to contain %q", i, got[i], w)
				}
			}
		})
	}
}

// requireProbed fails if any of want was not probed: without it, a loop over
// the collections could pass by looking at nothing.
func requireProbed(t *testing.T, probed []string, want ...string) {
	t.Helper()
	for _, w := range want {
		if !slices.Contains(probed, w) {
			t.Errorf("collection %s was not probed (probed %d collections)", w, len(probed))
		}
	}
}

func ruleString(r *string) string {
	if r == nil {
		return "<nil: superusers only>"
	}
	return "\"" + *r + "\""
}
