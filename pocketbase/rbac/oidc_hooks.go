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

// RegisterOIDCHooks registers the OAuth2 login hook that syncs is_admin
// from OIDC group claims. Reads ADMIN_GROUP_NAME env var at call time.
func RegisterOIDCHooks(app *pocketbase.PocketBase) {
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
			// Set last_login for new users
			loginData := buildLastLoginData()
			for k, v := range loginData {
				e.CreateData[k] = v
			}
			slog.Info("OIDC new user admin sync",
				"is_admin", isAdmin,
			)
		}

		// Always update last_login for existing users.
		// Note: the existing code only saved when is_admin changed. We now always
		// save because last_login changes on every login. The admin sync log
		// message stays inside a success branch to avoid logging on save failure.
		if e.Record != nil && !e.IsNewRecord {
			e.Record.Set("last_login", buildLastLoginData()["last_login"])

			currentAdmin := e.Record.GetBool("is_admin")
			adminChanged := currentAdmin != isAdmin
			if adminChanged {
				e.Record.Set("is_admin", isAdmin)
			}

			if err := e.App.Save(e.Record); err != nil {
				slog.Error("Failed to update user on login",
					"user_id", e.Record.Id,
					"error", err,
				)
			} else if adminChanged {
				slog.Info("OIDC admin sync updated",
					"user_id", e.Record.Id,
					"is_admin", isAdmin,
				)
			}
		}

		return e.Next()
	})
}
