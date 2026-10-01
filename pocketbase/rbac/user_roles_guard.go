package rbac

import (
	"encoding/json"
	"fmt"
	"slices"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

const permUsersManage = "users.manage"

// Refusal messages. Staff read these in the Users page's error toast.
const (
	msgUserRolesSelf        = "You can't change your own roles. Ask an admin."
	msgUserRolesAdminTarget = "Only an admin can change an admin's roles."
	msgUserRolesUsersManage = "Only an admin can grant or remove a role that carries users.manage."
	msgUserRolesUpdate      = "Role assignments can't be edited in place: remove the role and add the new one."
)

// registerUserRolesBoundsGuard bounds what a non-admin may do to user_roles.
//
// The collection rules admit any users.manage holder to create, update and
// delete assignments; the owner's ruling (2026-10-01) narrows that for a
// non-admin. A create or delete is refused when the assignment's user is the
// caller, or is an admin, or when its role carries users.manage -- only admins
// hand out, or take away, users.manage. Admins and superusers are unrestricted.
//
// Updates are refused to non-admins outright rather than checked on both the
// old and the new value: no Kindred client edits an assignment in place (the
// Users page and UserRolesPanel only create and delete), and no hook recomputes
// cached_permissions after an update (hooks.go binds create and delete only),
// so an in-place edit would leave both users' access stale anyway. Remove and
// re-add goes through the create and delete checks above.
//
// The caller is e.Auth, which during an admin's view-as preview is the
// persona's stand-in (view_as.go): a preview is bounded exactly like the
// persona it previews, as every other rule and guard sees it.
//
// REQUEST hooks only, like registerUsersWriteGuard: Go-side saves
// (recomputeUserPermissions, migrations, seeding) are not requests and stay
// unaffected. The audit log's request hooks wrap this one in a transaction, so
// a refusal rolls back and logs nothing.
func registerUserRolesBoundsGuard(app core.App) {
	app.OnRecordCreateRequest("user_roles").BindFunc(guardUserRoleLink)
	app.OnRecordDeleteRequest("user_roles").BindFunc(guardUserRoleLink)
	app.OnRecordUpdateRequest("user_roles").BindFunc(func(e *core.RecordRequestEvent) error {
		if isUnboundedRoleManager(e) {
			return e.Next() //nolint:wrapcheck // standard PocketBase hook pattern
		}
		return apis.NewForbiddenError(msgUserRolesUpdate, nil)
	})
}

// isUnboundedRoleManager: superusers and admins manage any assignment.
func isUnboundedRoleManager(e *core.RecordRequestEvent) bool {
	return e.HasSuperuserAuth() || (e.Auth != nil && e.Auth.GetBool(fieldIsAdmin))
}

// guardUserRoleLink checks one assignment being created or deleted. For a
// create e.Record carries the request body; for a delete it is the stored row.
func guardUserRoleLink(e *core.RecordRequestEvent) error {
	if isUnboundedRoleManager(e) {
		return e.Next() //nolint:wrapcheck // standard PocketBase hook pattern
	}
	if e.Auth == nil {
		return apis.NewUnauthorizedError("Authentication required", nil)
	}

	userID := e.Record.GetString("user")
	if userID == e.Auth.Id {
		return apis.NewForbiddenError(msgUserRolesSelf, nil)
	}
	target, err := e.App.FindRecordById("users", userID)
	if err != nil {
		return apis.NewBadRequestError("The user for this role assignment was not found.", err)
	}
	if target.GetBool(fieldIsAdmin) {
		return apis.NewForbiddenError(msgUserRolesAdminTarget, nil)
	}

	role, err := e.App.FindRecordById("roles", e.Record.GetString("role"))
	if err != nil {
		return apis.NewBadRequestError("The role for this assignment was not found.", err)
	}
	perms, err := rolePermissions(role.Get("permissions"))
	if err != nil {
		// Fail closed: a role whose permissions cannot be read might carry anything.
		return apis.NewForbiddenError(msgUserRolesUsersManage, err)
	}
	if slices.Contains(perms, permUsersManage) {
		return apis.NewForbiddenError(msgUserRolesUsersManage, nil)
	}
	return e.Next() //nolint:wrapcheck // standard PocketBase hook pattern
}

// rolePermissions reads a role's permissions field as a list of codenames.
// Record.Get on a json field returns types.JSONRaw; a nil or empty value is no
// permissions. Anything that is not a JSON list of strings is an error.
func rolePermissions(raw any) ([]string, error) {
	data, err := json.Marshal(raw)
	if err != nil {
		return nil, fmt.Errorf("marshal role permissions: %w", err)
	}
	var perms []string
	if err := json.Unmarshal(data, &perms); err != nil {
		return nil, fmt.Errorf("role permissions are not a list of codenames: %w", err)
	}
	return perms, nil
}
