package rbac

import (
	"log/slog"
	"os"

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

// RegisterOIDCHooks registers the OAuth2 login hook that syncs is_admin
// from OIDC group claims. Reads OIDC_ADMIN_GROUP env var at call time.
func RegisterOIDCHooks(app *pocketbase.PocketBase) {
	adminGroup := os.Getenv("OIDC_ADMIN_GROUP")
	if adminGroup == "" {
		slog.Info("OIDC_ADMIN_GROUP not set, skipping OIDC admin sync hook")
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
				"email", e.OAuth2User.Email,
				"is_admin", isAdmin,
			)
		}

		// For existing users: update record directly and save
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
