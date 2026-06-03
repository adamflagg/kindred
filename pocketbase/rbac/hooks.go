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

// extractBusinessCategory extracts metadata.business_category from a raw value.
// PocketBase decodes JSON fields into map[string]any, so a direct assertion suffices.
func extractBusinessCategory(raw any) string {
	m, ok := raw.(map[string]any)
	if !ok {
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
// Non-admins need registration.manage AND may only touch registration-category
// configs — both on the existing record and in the incoming body (newCategory),
// the latter preventing category mutation. newCategory == "" means the body did
// not change the category.
func decideConfigWrite(
	isSuperuser, isAdmin, hasRegistrationManage bool,
	existingCategory, newCategory string,
) configWriteDecision {
	if isSuperuser || isAdmin {
		return configWriteAllow
	}
	if !hasRegistrationManage {
		return configWriteDenyMissingPermission
	}
	if !isRegistrationConfig(existingCategory) {
		return configWriteDenyWrongCategory
	}
	if newCategory != "" && !isRegistrationConfig(newCategory) {
		return configWriteDenyCategoryMutation
	}
	return configWriteAllow
}

// guardConfigWrite ensures non-admin users can only write registration-category configs.
// Superusers and admin users bypass this check (they can write any config).
// Non-admin users with registration.manage can only write configs where
// metadata.business_category is "registration" — both on the existing record
// AND in the incoming request body (to prevent category mutation).
func guardConfigWrite(e *core.RecordRequestEvent) error {
	if e.Auth == nil {
		return apis.NewUnauthorizedError("Authentication required", nil)
	}

	// Pull the incoming body's business_category (if any) to detect mutation.
	newCategory := ""
	if info, err := e.RequestInfo(); err == nil && info != nil && info.Body != nil {
		if newMeta, ok := info.Body["metadata"]; ok {
			newCategory = extractBusinessCategory(newMeta)
		}
	}

	switch decideConfigWrite(
		e.Auth.IsSuperuser(),
		e.Auth.GetBool("is_admin"),
		slices.Contains(e.Auth.GetStringSlice("cached_permissions"), permRegistrationManage),
		extractBusinessCategory(e.Record.Get("metadata")),
		newCategory,
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
	app.OnRecordCreateRequest("config").BindFunc(guardConfigWrite)
	app.OnRecordUpdateRequest("config").BindFunc(guardConfigWrite)

	// Invalidate FastAPI metrics cache when registration config changes
	registerConfigHooks(app)

	// Register OIDC admin group sync hook
	RegisterOIDCHooks(app)

	slog.Info("RBAC hooks registered (including OIDC admin sync)")
}
