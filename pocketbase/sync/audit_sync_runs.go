package sync

import (
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/hook"

	"github.com/camp/kindred/pocketbase/audit"
)

// syncRoutePrefix is where every manual sync trigger lives.
const syncRoutePrefix = "/api/custom/sync/"

// syncRunExclusions are the POST /api/custom/sync/* routes that are NOT a sync
// run, so the admin audit log skips them (spec §2: bunking work and exports are
// not logged). Every other POST under the prefix is a manual run, so a new sync
// job's route is logged without anyone remembering to add it.
// TestSyncRunExclusionsAreRealRoutes keeps this list honest.
var syncRunExclusions = map[string]bool{
	"bunk_requests_upload":  true, // CSV upload of bunk requests: bunking work
	"process-requests":      true, // the request-processing pipeline: bunking work
	"multi-workbook-export": true, // a Sheets export
}

// syncRunRoute returns the route name of a manual sync run, and false for
// anything else.
func syncRunRoute(method, path string) (string, bool) {
	if method != http.MethodPost {
		return "", false
	}
	name, ok := strings.CutPrefix(path, syncRoutePrefix)
	if !ok || name == "" || strings.Contains(name, "/") || syncRunExclusions[name] {
		return "", false
	}
	return name, true
}

// syncRunDetail is what the screen needs to say "ran a full sync for 2026 (with
// custom values)": the route, the service or phase, the year and the flags.
func syncRunDetail(route string, q url.Values) map[string]any {
	detail := map[string]any{"route": route}
	switch route {
	case "run":
		service := q.Get("service")
		if service == "" {
			service = DefaultService
		}
		detail["service"] = service
	case "run-phase":
		detail["phase"] = q.Get("phase")
	}
	if year, err := strconv.Atoi(q.Get("year")); err == nil {
		detail["year"] = year
	}
	for param, key := range map[string]string{"includeCustomValues": "include_custom_values", "dry_run": "dry_run"} {
		if v := q.Get(param); v == boolTrueStr || v == "1" {
			detail[key] = true
		}
	}
	return detail
}

// auditSyncRunMiddleware records one Settings row per manual sync run: the one
// shared place for every /api/custom/sync/* trigger (spec §4.6). It runs after
// the handler and only for a 2xx answer, so a refused, conflicting or queued-
// behind-an-error request writes nothing. Scheduled runs never pass through the
// router, and the service account is excluded by audit.WriteAction.
//
// A sync run has no transaction to share: once started it cannot be taken
// back, so a failed audit write is logged, not turned into an error.
func auditSyncRunMiddleware() *hook.Handler[*core.RequestEvent] {
	return &hook.Handler[*core.RequestEvent]{
		Id:       "kindredAuditSyncRun",
		Priority: apis.DefaultLoadAuthTokenMiddlewarePriority + 2, // after auth and view-as
		Func: func(e *core.RequestEvent) error {
			route, ok := syncRunRoute(e.Request.Method, e.Request.URL.Path)
			if !ok {
				return e.Next() //nolint:wrapcheck // standard PocketBase hook pattern
			}
			if err := e.Next(); err != nil {
				return err //nolint:wrapcheck // the handler's own error
			}
			if status := e.Status(); status < 200 || status > 299 {
				return nil
			}
			if err := audit.WriteAction(e.App, e, audit.ActionSyncRun, syncRunDetail(route, e.Request.URL.Query())); err != nil {
				slog.Error("admin audit log: could not record a manual sync run", "route", route, "error", err)
			}
			return nil
		},
	}
}
