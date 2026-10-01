package rbac

import (
	"net/url"
	"strings"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

// superusersCollectionID is the fixed id PocketBase gives _superusers; the
// Caddyfiles gate both spellings (docker/Caddyfile @superuser_api_blocked).
const superusersCollectionID = "pbc_3142635823"

// registerBatchSuperusersGuard refuses any /api/batch sub-request that targets
// the _superusers collection, by name or by id.
//
// Why it exists: Caddy gates the superuser collection's API behind
// ADMIN_ALLOWLIST, but only on the direct paths
// (/api/collections/_superusers* and the id spelling) -- @superuser_api_blocked
// in docker/Caddyfile. /api/batch is routed to PocketBase WITHOUT that gate
// (the Users page saves roles through it), and PocketBase runs each
// sub-request through the ordinary record create/update/delete actions, so a
// holder of a superuser token could otherwise do _superusers record CRUD from
// outside the allowlist by wrapping it in a batch. This preserves the gate:
// superuser account management stays on the allowlisted direct path (or
// internal callers going straight to pocketbase:8090, which never use batch
// for _superusers). Nothing else about a batch is touched.
func registerBatchSuperusersGuard(app core.App) {
	app.OnBatchRequest().BindFunc(func(e *core.BatchRequestEvent) error {
		for _, sub := range e.Batch {
			if sub != nil && targetsSuperusers(sub.URL) {
				return apis.NewForbiddenError("Superuser accounts can't be changed through a batch request.", nil)
			}
		}
		return e.Next() //nolint:wrapcheck // standard PocketBase hook pattern
	})
}

// targetsSuperusers reports whether a sub-request URL names the _superusers
// collection. PocketBase resolves {collection} by name or id and ignores case,
// so compare lowercased, and percent-decode first so an escaped spelling can
// never slip past a check on the raw string.
func targetsSuperusers(rawURL string) bool {
	decoded, err := url.PathUnescape(rawURL)
	if err != nil {
		decoded = rawURL
	}
	lower := strings.ToLower(decoded)
	for _, name := range []string{core.CollectionNameSuperusers, superusersCollectionID} {
		if strings.Contains(lower, "/collections/"+name) {
			return true
		}
	}
	return false
}
