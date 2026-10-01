package rbac

import (
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"

	"github.com/camp/kindred/pocketbase/audit"
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

// registerLastLoginHook registers a hook that sets last_login, last_seen and
// emailVisibility on every OAuth2 sign-in. A new account gets them through
// CreateData; an existing one gets them as a column-only UPDATE (stampSignIn),
// because PocketBase only updates the external-auth link on a sign-in, not the
// user record.
func registerLastLoginHook(app core.App) {
	app.OnRecordAuthWithOAuth2Request("users").BindFunc(func(e *core.RecordAuthWithOAuth2RequestEvent) error {
		if e.OAuth2User == nil {
			return e.Next()
		}

		// For new users: set last_login and emailVisibility in CreateData
		if e.IsNewRecord {
			if e.CreateData == nil {
				e.CreateData = map[string]any{}
			}
			e.CreateData["last_login"] = buildLastLoginTimestamp()
			e.CreateData["last_seen"] = buildLastLoginTimestamp()
			e.CreateData["emailVisibility"] = true
		}

		if e.Record != nil && !e.IsNewRecord {
			stampSignIn(e.App, e.Record, buildLastLoginTimestamp())
		}

		return e.Next()
	})

	slog.Info("Last login tracking hook registered")
}

// stampSignIn writes rec's sign-in stamps. rec was loaded when the request
// started, so a full Save would write every other column back from that
// snapshot -- including cached_permissions, undoing a role recompute or an admin
// edit that landed in between, which would leave a removed permission in effect
// until the next recompute. These are plain stamps that no record hook needs
// (a save inside an auth hook was never audited, and spec §3.5 wants it that
// way), so they are a column-only UPDATE, like stampLastSeen. is_admin is not here: the admin-sync hook saves it.
func stampSignIn(app core.App, rec *core.Record, stamp string) {
	if _, err := app.DB().Update(rec.TableName(), dbx.Params{
		"last_login":      stamp,
		"last_seen":       stamp,
		"emailVisibility": true,
	}, dbx.HashExp{"id": rec.Id}).Execute(); err != nil {
		slog.Error("Failed to update user on login", "user_id", rec.Id, "error", err)
		return
	}
	rec.Set("last_login", stamp)
	rec.Set("last_seen", stamp)
	rec.Set("emailVisibility", true)
}

// registerAdminSyncHook registers a hook that syncs is_admin from OIDC group claims.
// A new account gets it through CreateData. An existing one whose admin status
// changed is saved here, through app.Save so validation and any record hooks
// still run -- but from a copy re-read just before the save, not the e.Record
// PocketBase loaded at request start, whose other columns (cached_permissions
// above all) may be stale by then (saveAdminChange).
//
// When the group grants or removes admin, it records an Access entry in the
// admin audit log once the sign-in has succeeded (spec 2026-09-26 §4.5): a new
// account that arrives as an admin is a grant too. The entry is written only if
// the stored is_admin really changed, since saveAdminChange only logs its
// own failure. Fail open, like every sign-in path.
func registerAdminSyncHook(app core.App, adminGroup string) {
	app.OnRecordAuthWithOAuth2Request("users").BindFunc(func(e *core.RecordAuthWithOAuth2RequestEvent) error {
		if e.OAuth2User == nil {
			return e.Next()
		}

		isAdmin := hasGroup(e.OAuth2User.RawUser, adminGroup)
		changed := false

		// For new users: set in CreateData so the record is created with is_admin
		if e.IsNewRecord {
			if e.CreateData == nil {
				e.CreateData = map[string]any{}
			}
			e.CreateData["is_admin"] = isAdmin
			changed = isAdmin
			slog.Info("OIDC new user admin sync",
				"is_admin", isAdmin,
			)
		}

		// For existing users: persist a change from a fresh copy, and mirror it
		// on the in-memory record so the sign-in response carries it.
		if e.Record != nil && !e.IsNewRecord {
			currentAdmin := e.Record.GetBool("is_admin")
			if currentAdmin != isAdmin {
				e.Record.Set("is_admin", isAdmin)
				changed = true
				saveAdminChange(e.App, e.Record.Id, isAdmin)
				slog.Info("OIDC admin sync updated",
					"user_id", e.Record.Id,
					"is_admin", isAdmin,
				)
			}
		}

		if err := e.Next(); err != nil {
			return err
		}
		if changed && e.Record != nil {
			switch stored, err := e.App.FindRecordById("users", e.Record.Id); {
			case err != nil:
				slog.Error("admin audit log: could not reload the user after the admin group sync",
					"user_id", e.Record.Id, "error", err)
			case stored.GetBool("is_admin") == isAdmin:
				audit.WriteAdminGroupChange(e.App, e.RequestEvent, stored, isAdmin)
			}
		}
		return nil
	})
}

// saveAdminChange persists an is_admin change from the admin group. The record
// is re-read immediately before the save, so the save carries the current
// cached_permissions and every other column rather than the request-start
// snapshot. The audit entry is written separately, after the sign-in succeeds,
// once the stored value is confirmed. Fail open, like every sign-in path.
func saveAdminChange(app core.App, userID string, isAdmin bool) {
	fresh, err := app.FindRecordById("users", userID)
	if err != nil {
		slog.Error("Failed to reload user for the admin group sync", "user_id", userID, "error", err)
		return
	}
	fresh.Set("is_admin", isAdmin)
	if err := app.Save(fresh); err != nil {
		slog.Error("Failed to save the admin group sync", "user_id", userID, "error", err)
	}
}

// RegisterOIDCHooks registers OAuth2 login hooks:
//   - Admin sync (optional, gated on ADMIN_GROUP_NAME) — saves an is_admin change
//   - Last login tracking (always) — stamps last_login, last_seen, emailVisibility
//
// Each hook writes only its own fields, so neither depends on the other's order.
func RegisterOIDCHooks(app core.App) {
	adminGroup := os.Getenv("ADMIN_GROUP_NAME")
	if adminGroup != "" {
		registerAdminSyncHook(app, adminGroup)
		slog.Info("OIDC admin sync hook registered", "admin_group", adminGroup)
	} else {
		slog.Info("ADMIN_GROUP_NAME not set, skipping OIDC admin sync hook")
	}

	// Always register sign-in stamps (column-only, see stampSignIn)
	registerLastLoginHook(app)

	// Session refreshes stamp last_seen (hourly at most)
	registerLastSeenHook(app)
}

// lastSeenEvery is how stale last_seen may get before a session refresh
// re-stamps it (spec 2026-10-01-users-page-uplift-design §3.5): fine enough for
// "today", at most one small write per person per hour.
const lastSeenEvery = time.Hour

// shouldStampLastSeen reports whether a refresh at now should re-stamp prev.
func shouldStampLastSeen(prev types.DateTime, now time.Time) bool {
	return prev.IsZero() || now.Sub(prev.Time()) > lastSeenEvery
}

// registerLastSeenHook stamps users.last_seen when a session is refreshed —
// which AuthContext does on every app load — because last_login only moves on
// a full Pocket ID sign-in. A save inside an auth hook is not a record-update
// request, so the audit log never sees it (and diff.go drops the field anyway).
// View-as stand-ins are skipped: their refresh is an admin previewing.
func registerLastSeenHook(app core.App) {
	app.OnRecordAuthRefreshRequest("users").BindFunc(func(e *core.RecordAuthRefreshRequestEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		if e.Record == nil || strings.HasSuffix(strings.ToLower(e.Record.Email()), "@"+viewAsPersonaEmailDomain) {
			return nil
		}
		stampLastSeen(e.App, e.Record, time.Now().UTC())
		return nil
	})
}

// stampLastSeen re-stamps rec's last_seen when the loaded value is stale. The
// record was loaded when the request started, so a full Save would write every
// other column back from that snapshot — including cached_permissions, undoing
// a role recompute that landed in between. The stamp is therefore one column.
func stampLastSeen(app core.App, rec *core.Record, now time.Time) {
	if !shouldStampLastSeen(rec.GetDateTime("last_seen"), now) {
		return
	}
	stamp, err := types.ParseDateTime(now)
	if err != nil {
		slog.Error("Failed to stamp last_seen", "user_id", rec.Id, "error", err)
		return
	}
	// Raw UPDATE: fires no record hooks, so it stays out of the audit log.
	if _, err := app.DB().NewQuery("UPDATE users SET last_seen = {:ts} WHERE id = {:id}").
		Bind(dbx.Params{"ts": stamp.String(), "id": rec.Id}).Execute(); err != nil {
		slog.Error("Failed to stamp last_seen", "user_id", rec.Id, "error", err)
		return
	}
	rec.Set("last_seen", stamp)
}
