// Package rbac provides role-based access control hooks for PocketBase.
package rbac

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"slices"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

// flattenPermissions takes permission arrays from multiple roles,
// deduplicates and sorts them.
func flattenPermissions(rolePermissions [][]string) []string {
	seen := make(map[string]bool)
	for _, perms := range rolePermissions {
		for _, p := range perms {
			seen[p] = true
		}
	}

	result := make([]string, 0, len(seen))
	for p := range seen {
		result = append(result, p)
	}
	slices.Sort(result)
	return result
}

// recomputeUserPermissions fetches all roles for a user and updates
// their cached_permissions field.
func recomputeUserPermissions(app *pocketbase.PocketBase, userID string) error {
	// Find all user_roles for this user
	userRoles, err := app.FindRecordsByFilter("user_roles", "user = {:userId}", "", 100, 0,
		map[string]any{"userId": userID})
	if err != nil {
		return fmt.Errorf("finding user_roles: %w", err)
	}

	// Collect permission arrays from each role
	var allPerms [][]string
	for _, ur := range userRoles {
		roleID := ur.GetString("role")
		role, roleErr := app.FindRecordById("roles", roleID)
		if roleErr != nil {
			slog.Warn("Failed to find role for user_role", "role_id", roleID, "error", roleErr)
			continue
		}

		var perms []string
		raw := role.Get("permissions")
		if raw != nil {
			data, marshalErr := json.Marshal(raw)
			if marshalErr == nil {
				if unmarshalErr := json.Unmarshal(data, &perms); unmarshalErr != nil {
					slog.Warn("Failed to unmarshal role permissions", "role_id", roleID, "error", unmarshalErr)
				}
			}
		}
		allPerms = append(allPerms, perms)
	}

	// Flatten, deduplicate, sort
	flattened := flattenPermissions(allPerms)

	// Update user record
	user, err := app.FindRecordById("_pb_users_auth_", userID)
	if err != nil {
		return fmt.Errorf("finding user: %w", err)
	}
	user.Set("cached_permissions", flattened)
	if saveErr := app.Save(user); saveErr != nil {
		return fmt.Errorf("saving user: %w", saveErr)
	}
	return nil
}

const permRegistrationManage = "registration.manage"

// extractBusinessCategory reads metadata.business_category from a raw config
// metadata value. The representation differs by source: Record.Get on a json
// field returns a types.JSONRaw ([]byte), while a parsed request body yields a
// map[string]any — handle both. Returns "" if the value is absent, unparseable,
// or has no business_category key.
func extractBusinessCategory(raw any) string {
	var m map[string]any
	switch v := raw.(type) {
	case map[string]any:
		m = v
	case types.JSONRaw:
		if len(v) == 0 {
			return ""
		}
		if err := json.Unmarshal(v, &m); err != nil {
			return ""
		}
	case []byte:
		if len(v) == 0 {
			return ""
		}
		if err := json.Unmarshal(v, &m); err != nil {
			return ""
		}
	default:
		return ""
	}
	cat, _ := m["business_category"].(string)
	return cat
}

// configWriteDecision is the authorization outcome for a config write, extracted
// as a pure value so the policy can be unit-tested without a request harness.
type configWriteDecision int

const (
	configWriteAllow configWriteDecision = iota
	configWriteDenyMissingPermission
	configWriteDenyWrongCategory
	configWriteDenyCategoryMutation
)

// decideConfigWrite is the pure authorization policy for a config write.
//
// Superusers (PocketBase _/ admin dashboard) and admins bypass every check.
// A non-admin needs registration.manage AND may only write registration-category
// configs, enforced on two categories:
//   - originalCategory — the STORED value. For updates it must be "registration",
//     so a non-admin can't edit a solver config (or relabel one to "registration"
//     in the same write to gain access). Empty/ignored for creates.
//   - resultCategory — the value that will be SAVED (post-body). It must be
//     "registration" in all cases, so the config can't be moved out of the
//     registration bucket by setting another category, blanking it, or dropping
//     the metadata key.
func decideConfigWrite(
	isSuperuser, isAdmin, hasRegistrationManage bool,
	originalCategory, resultCategory string,
	isCreate bool,
) configWriteDecision {
	if isSuperuser || isAdmin {
		return configWriteAllow
	}
	if !hasRegistrationManage {
		return configWriteDenyMissingPermission
	}
	// Eligibility (updates only): the stored row must already be a registration
	// config. Creates have no stored row, so this is governed by the result check.
	if !isCreate && !isRegistrationConfig(originalCategory) {
		return configWriteDenyWrongCategory
	}
	// The resulting row must remain (or, for creates, be) a registration config.
	if !isRegistrationConfig(resultCategory) {
		if isCreate {
			return configWriteDenyWrongCategory
		}
		return configWriteDenyCategoryMutation
	}
	return configWriteAllow
}

// guardConfigWrite ensures non-admin users can only write registration-category
// configs. Superusers and admin users bypass this check (they can write any
// config). Non-admin users with registration.manage can only write configs whose
// metadata.business_category is "registration" — evaluated on the stored record
// (eligibility) and on the resulting post-body record (to prevent category
// mutation). isCreate is true for OnRecordCreateRequest, where there is no stored
// record yet.
//
// e.Record already has the request body applied (PocketBase's form.Load runs
// before this request hook), so e.Record.Get reads the resulting state that will
// be saved, and e.Record.Original() reads the untouched stored state.
func guardConfigWrite(e *core.RecordRequestEvent, isCreate bool) error {
	if e.Auth == nil {
		return apis.NewUnauthorizedError("Authentication required", nil)
	}

	originalCategory := ""
	if !isCreate {
		originalCategory = extractBusinessCategory(e.Record.Original().Get("metadata"))
	}
	resultCategory := extractBusinessCategory(e.Record.Get("metadata"))

	switch decideConfigWrite(
		e.Auth.IsSuperuser(),
		e.Auth.GetBool("is_admin"),
		slices.Contains(e.Auth.GetStringSlice("cached_permissions"), permRegistrationManage),
		originalCategory,
		resultCategory,
		isCreate,
	) {
	case configWriteDenyMissingPermission:
		return apis.NewForbiddenError("Missing registration.manage permission", nil)
	case configWriteDenyWrongCategory:
		return apis.NewForbiddenError("Admin access required for this config category", nil)
	case configWriteDenyCategoryMutation:
		return apis.NewForbiddenError("Cannot change config category", nil)
	case configWriteAllow:
		return e.Next() //nolint:wrapcheck // standard PocketBase hook pattern
	}

	// Unreachable: decideConfigWrite returns one of the cases above. Required by
	// the compiler because the switch deliberately has no default.
	return e.Next() //nolint:wrapcheck // standard PocketBase hook pattern
}

// RegisterHooks registers RBAC-related hooks on the PocketBase app.
func RegisterHooks(app *pocketbase.PocketBase) {
	// On user_roles create: recompute affected user's permissions
	app.OnRecordAfterCreateSuccess("user_roles").BindFunc(func(e *core.RecordEvent) error {
		userID := e.Record.GetString("user")
		if err := recomputeUserPermissions(app, userID); err != nil {
			slog.Error("Failed to recompute permissions after role assignment", "user_id", userID, "error", err)
		}
		return e.Next()
	})

	// On user_roles delete: recompute affected user's permissions
	app.OnRecordAfterDeleteSuccess("user_roles").BindFunc(func(e *core.RecordEvent) error {
		userID := e.Record.GetString("user")
		if err := recomputeUserPermissions(app, userID); err != nil {
			slog.Error("Failed to recompute permissions after role removal", "user_id", userID, "error", err)
		}
		return e.Next()
	})

	// On roles update: recompute all users with this role
	app.OnRecordAfterUpdateSuccess("roles").BindFunc(func(e *core.RecordEvent) error {
		roleID := e.Record.Id
		userRoles, err := app.FindRecordsByFilter("user_roles", "role = {:roleId}", "", 1000, 0,
			map[string]any{"roleId": roleID})
		if err != nil {
			slog.Error("Failed to find user_roles for updated role", "role_id", roleID, "error", err)
			return e.Next()
		}
		for _, ur := range userRoles {
			userID := ur.GetString("user")
			if err := recomputeUserPermissions(app, userID); err != nil {
				slog.Error("Failed to recompute permissions for user", "user_id", userID, "error", err)
			}
		}
		return e.Next()
	})

	// Guard config writes: non-admin users with registration.manage can only
	// write to configs with business_category = "registration"
	app.OnRecordCreateRequest("config").BindFunc(func(e *core.RecordRequestEvent) error {
		return guardConfigWrite(e, true)
	})
	app.OnRecordUpdateRequest("config").BindFunc(func(e *core.RecordRequestEvent) error {
		return guardConfigWrite(e, false)
	})

	// Invalidate FastAPI metrics cache when registration config changes
	registerConfigHooks(app)

	// Register OIDC admin group sync hook
	RegisterOIDCHooks(app)

	slog.Info("RBAC hooks registered (including OIDC admin sync)")
}
