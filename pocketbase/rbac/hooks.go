// Package rbac provides role-based access control hooks for PocketBase.
package rbac

import (
	"encoding/json"
	"log/slog"
	"sort"

	"github.com/pocketbase/pocketbase"
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
	sort.Strings(result)
	return result
}

// recomputeUserPermissions fetches all roles for a user and updates
// their cached_permissions field.
func recomputeUserPermissions(app *pocketbase.PocketBase, userID string) error {
	// Find all user_roles for this user
	userRoles, err := app.FindRecordsByFilter("user_roles", "user = {:userId}", "", 100, 0,
		map[string]any{"userId": userID})
	if err != nil {
		return err
	}

	// Collect permission arrays from each role
	var allPerms [][]string
	for _, ur := range userRoles {
		roleID := ur.GetString("role")
		role, err := app.FindRecordById("roles", roleID)
		if err != nil {
			slog.Warn("Failed to find role for user_role", "role_id", roleID, "error", err)
			continue
		}

		var perms []string
		raw := role.Get("permissions")
		if raw != nil {
			data, err := json.Marshal(raw)
			if err == nil {
				json.Unmarshal(data, &perms) //nolint:errcheck
			}
		}
		allPerms = append(allPerms, perms)
	}

	// Flatten, deduplicate, sort
	flattened := flattenPermissions(allPerms)

	// Update user record
	user, err := app.FindRecordById("_pb_users_auth_", userID)
	if err != nil {
		return err
	}
	user.Set("cached_permissions", flattened)
	return app.Save(user)
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

	slog.Info("RBAC hooks registered")
}
