package rbac

import (
	"slices"
	"strings"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/hook"
)

// ViewAsHeader carries a real admin's preview persona: comma-separated
// permission codenames, or "none" for a persona holding no permissions.
//
// A persona downgrades; it never grants. It is honored only when the
// DB-loaded auth record is a users record with is_admin = true, and it always
// yields is_admin = false -- so no persona can reach anything the caller could
// not already reach, which is why there is no permission allow-list here.
// The FastAPI half is bunking/rbac/view_as.py; both are pinned by
// testdata/view_as_vectors.json.
const ViewAsHeader = "X-Kindred-View-As"

const viewAsNone = "none"

// authKind is what kind of caller a request carries, as the vectors name it.
type authKind string

const (
	authKindNone      authKind = "none"
	authKindSuperuser authKind = "superuser"
	authKindUser      authKind = "user"
)

// viewAsDecision is the effective access for one request.
type viewAsDecision struct {
	Applied     bool     `json:"applied"`
	IsAdmin     bool     `json:"is_admin"`
	Permissions []string `json:"permissions"`
}

// parseViewAs returns the persona's permissions (split, trimmed, blanks and the
// "none" sentinel dropped, deduplicated, sorted) and whether a persona was sent
// at all. A blank header is no persona.
func parseViewAs(header string) ([]string, bool) {
	trimmed := strings.TrimSpace(header)
	if trimmed == "" {
		return nil, false
	}
	perms := []string{}
	for _, p := range strings.Split(trimmed, ",") {
		p = strings.TrimSpace(p)
		if p == "" || p == viewAsNone || slices.Contains(perms, p) {
			continue
		}
		perms = append(perms, p)
	}
	slices.Sort(perms)
	return perms, true
}

// decideViewAs is the whole policy, pure so both servers can share vectors.
func decideViewAs(kind authKind, realIsAdmin bool, realPerms []string, header string) viewAsDecision {
	unchanged := viewAsDecision{IsAdmin: realIsAdmin, Permissions: realPerms}
	if kind != authKindUser || !realIsAdmin {
		return unchanged
	}
	perms, present := parseViewAs(header)
	if !present {
		return unchanged
	}
	return viewAsDecision{Applied: true, IsAdmin: false, Permissions: perms}
}

// viewAsMiddlewareID names the handler so it is identifiable in the router.
const viewAsMiddlewareID = "kindredViewAs"

// viewAsMiddleware applies a real admin's persona to e.Auth for this request.
//
// It runs right after PocketBase's loadAuthToken. guardConfigWrite and
// sync/api.go read e.Auth directly in Go, so swapping e.Auth downgrades both
// of them. It swaps in a CLONE: the stored record is never written.
//
// KNOWN GAP, verified against PocketBase v0.40.4 (not merely the traversal
// case the original design assumed): a collection rule's "@request.auth.X"
// resolves from this in-memory clone ONLY for a fixed system-field allowlist
// -- id, collectionId, collectionName, email, emailVisibility, verified
// (core/record_field_resolver_runner.go's plainRequestAuthFields). Every
// other field, including is_admin and cached_permissions -- the two fields
// this whole feature turns on -- is resolved by processRequestAuthField via a
// live SQL JOIN back to the real "users" row by e.Auth.Id (same file,
// ~line 211), which reads the REAL persisted values and never sees this
// clone. That holds for a single segment (@request.auth.is_admin) exactly as
// much as for a relation traversal (@request.auth.role.name) -- the
// traversal-only framing in view_as_schema_test.go is real but narrower than
// this. Concretely: a PocketBase list/view/create/update/delete rule written
// as "@request.auth.is_admin = true || @request.auth.cached_permissions ~
// \"X\"" (the shape of every rule pb_migrations/1500000077_rbac_simplify_rules.js
// and its siblings write) is UNAFFECTED by a preview. See
// view_as_router_test.go's "KNOWN GAP" scenarios and task-2-report.md for the
// verified evidence. This middleware still downgrades every Go-code reader of
// e.Auth (guardConfigWrite, sync/api.go) correctly.
//
// auth-* routes are skipped: auth-refresh returns e.Auth as the record the SDK
// stores, and a downgraded one would erase is_admin from the tab, hiding the
// switcher that is the only way back.
func viewAsMiddleware() *hook.Handler[*core.RequestEvent] {
	return &hook.Handler[*core.RequestEvent]{
		Id:       viewAsMiddlewareID,
		Priority: apis.DefaultLoadAuthTokenMiddlewarePriority + 1,
		Func: func(e *core.RequestEvent) error {
			if e.Auth == nil || isAuthRoute(e.Request.URL.Path) {
				return e.Next() //nolint:wrapcheck // standard PocketBase hook pattern
			}
			kind := authKindUser
			if e.Auth.IsSuperuser() {
				kind = authKindSuperuser
			} else if e.Auth.Collection().Name != "users" {
				return e.Next() //nolint:wrapcheck // standard PocketBase hook pattern
			}
			decision := decideViewAs(kind, e.Auth.GetBool(fieldIsAdmin),
				e.Auth.GetStringSlice(fieldCachedPermissions), e.Request.Header.Get(ViewAsHeader))
			if decision.Applied {
				clone := e.Auth.Clone()
				clone.Set(fieldIsAdmin, false)
				clone.Set(fieldCachedPermissions, decision.Permissions)
				e.Auth = clone
			}
			return e.Next() //nolint:wrapcheck // standard PocketBase hook pattern
		},
	}
}

// isAuthRoute matches /api/collections/{name or id}/auth-*.
func isAuthRoute(path string) bool {
	return strings.HasPrefix(path, "/api/collections/") && strings.Contains(path, "/auth-")
}
