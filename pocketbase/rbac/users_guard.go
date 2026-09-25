package rbac

import (
	"fmt"

	"github.com/pocketbase/pocketbase/core"
)

const (
	fieldIsAdmin           = "is_admin"
	fieldCachedPermissions = "cached_permissions"
)

// registerUsersWriteGuard keeps is_admin and cached_permissions server-owned
// on every non-superuser write to users that arrives as an API request.
//
// The collection rules already refuse those writes (create only in the OAuth2
// sign-up context, update/delete superusers only -- migration 1500000181).
// This is the layer that holds if a rule is ever loosened, and it closes the
// one hole a rule cannot: OAuth2 sign-up lets the client send createData, and
// before this nothing overwrote a cached_permissions planted there.
//
// REQUEST hooks only. The model hooks (OnRecordCreate/Update/Validate) also fire
// on app.Save, which recomputeUserPermissions, the OIDC last-login save and
// migrations 1500000130/1500000154 all use to write these very fields.
//
// adminGroup is ADMIN_GROUP_NAME. When it is set, the OIDC admin-sync hook has
// already replaced any client-sent is_admin in createData with the IdP's
// answer, so an OAuth2 sign-up keeps is_admin; in every other case it is false.
func registerUsersWriteGuard(app core.App, adminGroup string) {
	app.OnRecordCreateRequest("users").BindFunc(func(e *core.RecordRequestEvent) error {
		if e.HasSuperuserAuth() {
			return e.Next() //nolint:wrapcheck // standard PocketBase hook pattern
		}

		// Access comes only from roles (user_roles -> recomputeUserPermissions).
		e.Record.Set(fieldCachedPermissions, []string{})

		info, err := e.RequestInfo()
		if err != nil {
			return fmt.Errorf("users create guard: read request info: %w", err)
		}
		if info.Context != core.RequestInfoContextOAuth2 || adminGroup == "" {
			e.Record.Set(fieldIsAdmin, false)
		}
		return e.Next() //nolint:wrapcheck // standard PocketBase hook pattern
	})

	app.OnRecordUpdateRequest("users").BindFunc(func(e *core.RecordRequestEvent) error {
		if e.HasSuperuserAuth() {
			return e.Next() //nolint:wrapcheck // standard PocketBase hook pattern
		}

		// e.Record already carries the request body; Original() is what is stored.
		stored := e.Record.Original()
		e.Record.Set(fieldIsAdmin, stored.Get(fieldIsAdmin))
		e.Record.Set(fieldCachedPermissions, stored.Get(fieldCachedPermissions))
		return e.Next() //nolint:wrapcheck // standard PocketBase hook pattern
	})
}
