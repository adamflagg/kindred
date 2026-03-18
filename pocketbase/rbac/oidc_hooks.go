package rbac

import (
	"log/slog"
	"os"
	"time"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

// hasGroup checks if a specific group name is present in the OIDC RawUser claims.
// Returns false if groups claim is missing, nil, non-slice, or group name is empty.
func hasGroup(rawUser map[string]any, group string) bool {
	if group == "" || rawUser == nil {
		return false
	}

	groupsRaw, ok := rawUser["groups"]
	if !ok || groupsRaw == nil {
		return false
	}

	groups, ok := groupsRaw.([]any)
	if !ok {
		return false
	}

	for _, g := range groups {
		if s, ok := g.(string); ok && s == group {
			return true
		}
	}
	return false
}

// buildLastLoginTimestamp returns the current UTC time formatted for PocketBase date fields.
func buildLastLoginTimestamp() string {
	return time.Now().UTC().Format("2006-01-02 15:04:05.000Z")
}

// registerLastLoginHook registers a hook that sets last_login on every OAuth2 login.
// This runs after any admin-sync hook (which only sets fields), so a single Save()
// persists both last_login and any is_admin changes together.
func registerLastLoginHook(app *pocketbase.PocketBase) {
	app.OnRecordAuthWithOAuth2Request("users").BindFunc(func(e *core.RecordAuthWithOAuth2RequestEvent) error {
		if e.OAuth2User == nil {
			return e.Next()
		}

		// For new users: set last_login in CreateData
		if e.IsNewRecord {
			if e.CreateData == nil {
				e.CreateData = map[string]any{}
			}
			e.CreateData["last_login"] = buildLastLoginTimestamp()
		}

		// For existing users: explicit Save() required because PocketBase only
		// updates the external auth link during OAuth2 login, not the user record.
		// This is the single Save() for all login-time field updates (last_login,
		// is_admin) — the admin-sync hook sets fields but does not save.
		if e.Record != nil && !e.IsNewRecord {
			e.Record.Set("last_login", buildLastLoginTimestamp())
			if err := e.App.Save(e.Record); err != nil {
				slog.Error("Failed to update user on login",
					"user_id", e.Record.Id,
					"error", err,
				)
			}
		}

		return e.Next()
	})

	slog.Info("Last login tracking hook registered")
}

// registerAdminSyncHook registers a hook that syncs is_admin from OIDC group claims.
// It only sets fields on the record — Save() is handled by the last-login hook which
// runs after this one (hooks fire in registration order).
func registerAdminSyncHook(app *pocketbase.PocketBase, adminGroup string) {
	app.OnRecordAuthWithOAuth2Request("users").BindFunc(func(e *core.RecordAuthWithOAuth2RequestEvent) error {
		if e.OAuth2User == nil {
			return e.Next()
		}

		isAdmin := hasGroup(e.OAuth2User.RawUser, adminGroup)

		// For new users: set in CreateData so the record is created with is_admin
		if e.IsNewRecord {
			if e.CreateData == nil {
				e.CreateData = map[string]any{}
			}
			e.CreateData["is_admin"] = isAdmin
			slog.Info("OIDC new user admin sync",
				"is_admin", isAdmin,
			)
		}

		// For existing users: set is_admin on the in-memory record if changed.
		// The last-login hook's Save() will persist this change.
		if e.Record != nil && !e.IsNewRecord {
			currentAdmin := e.Record.GetBool("is_admin")
			if currentAdmin != isAdmin {
				e.Record.Set("is_admin", isAdmin)
				slog.Info("OIDC admin sync updated",
					"user_id", e.Record.Id,
					"is_admin", isAdmin,
				)
			}
		}

		return e.Next()
	})
}

// RegisterOIDCHooks registers OAuth2 login hooks:
//   - Admin sync (optional, gated on ADMIN_GROUP_NAME) — sets is_admin field only
//   - Last login tracking (always) — sets last_login and saves the record
//
// Registration order matters: admin sync runs first (field-setter), then last-login
// saves everything in a single write.
func RegisterOIDCHooks(app *pocketbase.PocketBase) {
	adminGroup := os.Getenv("ADMIN_GROUP_NAME")
	if adminGroup != "" {
		// Register admin sync first so it sets fields before the save
		registerAdminSyncHook(app, adminGroup)
		slog.Info("OIDC admin sync hook registered", "admin_group", adminGroup)
	} else {
		slog.Info("ADMIN_GROUP_NAME not set, skipping OIDC admin sync hook")
	}

	// Always register last_login tracking — saves the record with all field updates
	registerLastLoginHook(app)
}
