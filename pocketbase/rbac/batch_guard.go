package rbac

import (
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

// registerBatchSuperusersGuard refuses record create/update/delete on the
// _superusers collection when the request is an /api/batch sub-request.
//
// Which gate this preserves: Caddy restricts the superuser collection's API to
// ADMIN_ALLOWLIST IPs, but only on the direct paths
// (/api/collections/_superusers* and the id spelling) -- @superuser_api_blocked
// in docker/Caddyfile. /api/batch is routed to PocketBase WITHOUT that gate
// (the Users page saves roles through it), and PocketBase runs each
// sub-request through the ordinary record actions, so a superuser token could
// otherwise do _superusers CRUD from outside the allowlist by wrapping it in a
// batch. Superuser account management stays on the allowlisted direct path.
//
// Why it resolves the collection instead of matching the URL: PocketBase
// matches the {collection} segment with strings.EqualFold, i.e. Unicode case
// folding, so "_ſuperusers" (long s, U+017F) reaches the real collection while
// no lowercase/substring check on the URL sees "_superusers". The request-event
// hooks below are bound to the resolved collection (by name; PocketBase
// matches tags against both name and id), so every spelling that resolves to
// _superusers is caught and no spelling that resolves elsewhere is. The
// percent-encoded "%5Fsuperusers" is NOT decoded by PocketBase: it resolves to
// no collection and 404s on its own.
func registerBatchSuperusersGuard(app core.App) {
	refuseInBatch := func(e *core.RecordRequestEvent) error {
		if info, err := e.RequestInfo(); err == nil && info.Context == core.RequestInfoContextBatch {
			return apis.NewForbiddenError("Superuser accounts can't be changed through a batch request.", nil)
		}
		return e.Next() //nolint:wrapcheck // standard PocketBase hook pattern
	}
	app.OnRecordCreateRequest(core.CollectionNameSuperusers).BindFunc(refuseInBatch)
	app.OnRecordUpdateRequest(core.CollectionNameSuperusers).BindFunc(refuseInBatch)
	app.OnRecordDeleteRequest(core.CollectionNameSuperusers).BindFunc(refuseInBatch)
}
