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

// buildLastLoginData returns a map with the current UTC time formatted for PocketBase.
func buildLastLoginData() map[string]any {
	return map[string]any{
		"last_login": time.Now().UTC().Format("2006-01-02 15:04:05.000Z"),
	}
}

// registerLastLoginHook registers a hook that sets last_login on every OAuth2 login.
// This is separate from the OIDC admin sync so it works regardless of ADMIN_GROUP_NAME.
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
			e.CreateData["last_login"] = buildLastLoginData()["last_login"]
		}

		// For existing users: explicit Save() required because PocketBase only
		// updates the external auth link during OAuth2 login, not the user record.
		if e.Record != nil && !e.IsNewRecord {
			e.Record.Set("last_login", buildLastLoginData()["last_login"])
			if err := e.App.Save(e.Record); err != nil {
				slog.Error("Failed to update last_login on login",
					"user_id", e.Record.Id,
					"error", err,
				)
			}
		}

		return e.Next()
	})

	slog.Info("Last login tracking hook registered")
}

// RegisterOIDCHooks registers the OAuth2 login hook that syncs is_admin
// from OIDC group claims. Reads ADMIN_GROUP_NAME env var at call time.
// Also registers the last_login tracking hook (always, regardless of admin group config).
func RegisterOIDCHooks(app *pocketbase.PocketBase) {
	// Always register last_login tracking — not gated on ADMIN_GROUP_NAME
	registerLastLoginHook(app)

	adminGroup := os.Getenv("ADMIN_GROUP_NAME")
	if adminGroup == "" {
		slog.Info("ADMIN_GROUP_NAME not set, skipping OIDC admin sync hook")
		return
	}

	slog.Info("OIDC admin sync hook registered", "admin_group", adminGroup)

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

		// For existing users: explicit Save() required because PocketBase only
		// updates the external auth link during OAuth2 login, not the user record.
		if e.Record != nil && !e.IsNewRecord {
			currentAdmin := e.Record.GetBool("is_admin")
			if currentAdmin != isAdmin {
				e.Record.Set("is_admin", isAdmin)
				if err := e.App.Save(e.Record); err != nil {
					slog.Error("Failed to sync is_admin from OIDC groups",
						"user_id", e.Record.Id,
						"error", err,
					)
				} else {
					slog.Info("OIDC admin sync updated",
						"user_id", e.Record.Id,
						"is_admin", isAdmin,
					)
				}
			}
		}

		return e.Next()
	})
}
