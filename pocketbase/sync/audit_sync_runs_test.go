package sync

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"regexp"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/hook"
	"github.com/pocketbase/pocketbase/tools/router"

	"github.com/camp/kindred/pocketbase/audit"
	"github.com/camp/kindred/pocketbase/audit/audittest"
)

// TestSyncAPIBindsTheAuditMiddleware is a source pin (controller ruling 1):
// InitializeSyncService must bind auditSyncRunMiddleware(), or every test
// below that calls the middleware directly would stay green even if the real
// wiring were deleted from api.go.
func TestSyncAPIBindsTheAuditMiddleware(t *testing.T) {
	t.Parallel()
	src, err := os.ReadFile("api.go")
	if err != nil {
		t.Fatalf("read api.go: %v", err)
	}
	if !strings.Contains(string(src), "e.Router.Bind(auditSyncRunMiddleware())") {
		t.Errorf("api.go must bind auditSyncRunMiddleware() inside InitializeSyncService")
	}
}

func TestSyncRunRoute(t *testing.T) {
	t.Parallel()
	cases := []struct {
		method, path, want string
		ok                 bool
	}{
		{http.MethodPost, "/api/custom/sync/run", "run", true},
		{http.MethodPost, "/api/custom/sync/bunk-assignments", "bunk-assignments", true},
		{http.MethodPost, "/api/custom/sync/custom-values", "custom-values", true},
		{http.MethodPost, "/api/custom/sync/process-requests", "", false},
		{http.MethodPost, "/api/custom/sync/bunk_requests_upload", "", false},
		{http.MethodPost, "/api/custom/sync/multi-workbook-export", "", false},
		{http.MethodGet, "/api/custom/sync/status", "", false},
		{http.MethodDelete, "/api/custom/sync/running", "", false},
		{http.MethodDelete, "/api/custom/sync/queue/abc", "", false},
		{http.MethodPost, "/api/custom/lodging/roll-forward", "", false},
	}
	for _, c := range cases {
		got, ok := syncRunRoute(c.method, c.path)
		if got != c.want || ok != c.ok {
			t.Errorf("syncRunRoute(%s %s) = (%q, %v), want (%q, %v)", c.method, c.path, got, ok, c.want, c.ok)
		}
	}
}

// TestSyncRunExclusionsAreRealRoutes: every excluded name is a POST route
// api.go really registers, so the list cannot rot into excluding nothing.
func TestSyncRunExclusionsAreRealRoutes(t *testing.T) {
	t.Parallel()
	src, err := os.ReadFile("api.go")
	if err != nil {
		t.Fatalf("read api.go: %v", err)
	}
	registered := map[string]bool{}
	routes := regexp.MustCompile(`e\.Router\.POST\("/api/custom/sync/([^"]+)"`)
	for _, m := range routes.FindAllStringSubmatch(string(src), -1) {
		registered[m[1]] = true
	}
	if len(registered) < 30 {
		t.Fatalf("found only %d POST sync routes in api.go; the pattern no longer matches", len(registered))
	}
	for name := range syncRunExclusions {
		if !registered[name] {
			t.Errorf("syncRunExclusions names %q, which api.go does not register", name)
		}
	}
}

func TestSyncRunDetail(t *testing.T) {
	t.Parallel()
	got := syncRunDetail("run", url.Values{"year": {"2026"}, "includeCustomValues": {"true"}})
	if got["service"] != "all" || got["year"] != 2026 || got["include_custom_values"] != true || got["route"] != "run" {
		t.Errorf("full run detail = %v", got)
	}
	got = syncRunDetail("run-phase", url.Values{"year": {"2026"}, "phase": {"source"}})
	if got["phase"] != "source" || got["year"] != 2026 {
		t.Errorf("phase detail = %v", got)
	}
	if got = syncRunDetail("hourly", url.Values{}); len(got) != 1 {
		t.Errorf("hourly detail = %v, want only the route", got)
	}
}

// runThroughMiddleware sends one request through auditSyncRunMiddleware with a
// handler that answers status, the way the router would.
func runThroughMiddleware(t *testing.T, app core.App, auth *core.Record, path string, status int) {
	t.Helper()
	e := &core.RequestEvent{App: app}
	e.Auth = auth
	e.Request = httptest.NewRequest(http.MethodPost, path, http.NoBody)
	e.Response = &router.ResponseWriter{ResponseWriter: httptest.NewRecorder()}
	chain := &hook.Hook[*core.RequestEvent]{}
	chain.Bind(auditSyncRunMiddleware())
	if err := chain.Trigger(e, func(e *core.RequestEvent) error {
		return e.JSON(status, map[string]string{"status": "started"})
	}); err != nil {
		t.Fatalf("middleware: %v", err)
	}
}

func TestAuditSyncRunMiddleware(t *testing.T) {
	t.Parallel()
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)
	audittest.Setup(t, app)
	superusers, err := app.FindCollectionByNameOrId(core.CollectionNameSuperusers)
	if err != nil {
		t.Fatalf("find superusers: %v", err)
	}
	newSuperuser := func(email string) *core.Record {
		su := core.NewRecord(superusers)
		su.SetEmail(email)
		su.SetPassword("correct-horse-battery-staple")
		if err := app.Save(su); err != nil {
			t.Fatalf("save superuser: %v", err)
		}
		return su
	}
	owner, service := newSuperuser("owner@example.com"), newSuperuser(audittest.ServiceEmail)

	runThroughMiddleware(t, app, owner, "/api/custom/sync/run?year=2026&includeCustomValues=true", http.StatusOK)
	runThroughMiddleware(t, app, owner, "/api/custom/sync/run?year=2026", http.StatusConflict)      // refused: not a run
	runThroughMiddleware(t, app, owner, "/api/custom/sync/process-requests", http.StatusOK)         // bunking work
	runThroughMiddleware(t, app, service, "/api/custom/sync/run?year=2026", http.StatusAccepted)    // the service
	runThroughMiddleware(t, app, nil, "/api/custom/sync/bunk-assignments", http.StatusUnauthorized) // no auth

	rows := audittest.Rows(t, app)
	if len(rows) != 1 {
		t.Fatalf("rows = %d, want only the owner's successful full run", len(rows))
	}
	detail := audittest.JSON(t, rows[0], "detail")
	if rows[0].GetString("type") != audit.TypeSettings || rows[0].GetString("action") != audit.ActionSyncRun ||
		detail["service"] != "all" || detail["year"] != 2026.0 || detail["include_custom_values"] != true {
		t.Errorf("row = %s", audittest.Dump(t, rows[0]))
	}
}
