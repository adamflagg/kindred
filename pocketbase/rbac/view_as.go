package rbac

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"regexp"
	"slices"
	"strings"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/hook"
)

// ViewAsHeader carries a real admin's preview persona: comma-separated
// permission codenames, or "none" for a persona holding no permissions.
//
// A persona downgrades; it never grants. It is honored only when the
// DB-loaded auth record is a users record with is_admin = true, and it always
// yields is_admin = false -- so no persona can reach anything the caller could
// not already reach, which is why there is no permission allow-list here.
// The FastAPI half is bunking/rbac/view_as.py; both are pinned by
// testdata/view_as_vectors.json.
const ViewAsHeader = "X-Kindred-View-As"

const viewAsNone = "none"

// authKind is what kind of caller a request carries, as the vectors name it.
type authKind string

const (
	authKindNone      authKind = "none"
	authKindSuperuser authKind = "superuser"
	authKindUser      authKind = "user"
)

// viewAsDecision is the effective access for one request.
type viewAsDecision struct {
	Applied     bool     `json:"applied"`
	IsAdmin     bool     `json:"is_admin"`
	Permissions []string `json:"permissions"`
}

// parseViewAs returns the persona's permissions (split, trimmed, blanks and the
// "none" sentinel dropped, deduplicated, sorted) and whether a persona was sent
// at all. A blank header is no persona.
func parseViewAs(header string) ([]string, bool) {
	trimmed := strings.TrimSpace(header)
	if trimmed == "" {
		return nil, false
	}
	perms := []string{}
	for _, p := range strings.Split(trimmed, ",") {
		p = strings.TrimSpace(p)
		if p == "" || p == viewAsNone || slices.Contains(perms, p) {
			continue
		}
		perms = append(perms, p)
	}
	slices.Sort(perms)
	return perms, true
}

// decideViewAs is the whole policy, pure so both servers can share vectors.
func decideViewAs(kind authKind, realIsAdmin bool, realPerms []string, header string) viewAsDecision {
	unchanged := viewAsDecision{IsAdmin: realIsAdmin, Permissions: realPerms}
	if kind != authKindUser || !realIsAdmin {
		return unchanged
	}
	perms, present := parseViewAs(header)
	if !present {
		return unchanged
	}
	return viewAsDecision{Applied: true, IsAdmin: false, Permissions: perms}
}

// viewAsMiddlewareID names the handler so it is identifiable in the router.
const viewAsMiddlewareID = "kindredViewAs"

// viewAsPersonaEmailDomain marks a persona stand-in user. .invalid is reserved
// (RFC 2606), so no real address can collide; the frontend's
// isViewAsPersonaUser (frontend/src/auth/viewAs.ts) filters on the same string.
const viewAsPersonaEmailDomain = "view-as.invalid"

// viewAsPersonaIDPattern is the shape viewAsPersonaID always produces.
// registerUsersWriteGuard (users_guard.go) uses it to reserve the namespace
// against a client-chosen id at create time, and registerViewAsRoleGuard uses
// it to refuse assigning roles to a stand-in.
var viewAsPersonaIDPattern = regexp.MustCompile(`^va[0-9a-f]{13}$`)

// viewAsPersonaID derives a stand-in's record id from its permission set, so a
// persona always maps to the same row: "va" + 13 hex chars = the 15 [a-z0-9]
// chars PocketBase ids require. perms must already be sorted (parseViewAs does).
func viewAsPersonaID(perms []string) string {
	sum := sha256.Sum256([]byte(strings.Join(perms, ",")))
	return "va" + hex.EncodeToString(sum[:])[:13]
}

// viewAsPersonaMaxNameRunes keeps the stand-in's display name under the users
// collection's name field cap (255 chars). Truncating at 200 plus the
// ellipsis leaves headroom and never touches the short "No role" form.
const viewAsPersonaMaxNameRunes = 200

// viewAsPersonaName is the stand-in's display name. An admin previewing
// enough permissions could otherwise produce a name over the users.name
// field's 255-char cap, which would turn every future preview of that exact
// persona into a permanent 500 (the create/find would keep failing validation).
func viewAsPersonaName(perms []string) string {
	if len(perms) == 0 {
		return "View as: No role"
	}
	name := "View as: " + strings.Join(perms, " · ")
	if runes := []rune(name); len(runes) > viewAsPersonaMaxNameRunes {
		name = string(runes[:viewAsPersonaMaxNameRunes]) + "…"
	}
	return name
}

// verifyViewAsPersona confirms a users row found at a persona's deterministic
// id is actually the stand-in it claims to be, not a real account that
// squatted the id/email. registerUsersWriteGuard reserves the namespace going
// forward, but this is what protects a preview against a row that squatted it
// before that guard existed, or one a superuser created directly (the guard's
// namespace check only runs on the non-superuser path). Fails closed:
// ensureViewAsPersona never silently repairs or reuses a row that fails this.
func verifyViewAsPersona(app core.App, row *core.Record, perms []string) error {
	wantEmail := row.Id + "@" + viewAsPersonaEmailDomain
	if !strings.EqualFold(row.Email(), wantEmail) {
		return fmt.Errorf("view-as persona %s: email %q is not the stand-in's, want %q", row.Id, row.Email(), wantEmail)
	}
	if row.GetBool(fieldIsAdmin) {
		return fmt.Errorf("view-as persona %s: is_admin is true, not a stand-in", row.Id)
	}
	if !slices.Equal(row.GetStringSlice(fieldCachedPermissions), perms) {
		return fmt.Errorf("view-as persona %s: cached_permissions do not match the persona", row.Id)
	}
	externalAuths, err := app.FindAllExternalAuthsByRecord(row)
	if err != nil {
		return fmt.Errorf("view-as persona %s: check external auths: %w", row.Id, err)
	}
	if len(externalAuths) > 0 {
		return fmt.Errorf("view-as persona %s: has external auth links, not a stand-in", row.Id)
	}
	return nil
}

// ensureViewAsPersona returns the users row that stands in for a persona,
// creating it on first use. Collection rules read @request.auth.is_admin and
// cached_permissions by joining users on e.Auth.Id, so the persona has to be a
// real row: an in-memory clone reaches Go hooks but never a rule.
//
// A stand-in cannot be signed into (password auth on users is off, it has no
// OAuth link, and its password is random), has no user_roles so nothing
// recomputes it, and is shared by every admin who previews the same persona.
// Every row found at the deterministic id -- whether already there or raced
// into existence by a concurrent request -- is verified before being reused;
// see verifyViewAsPersona.
func ensureViewAsPersona(app core.App, perms []string) (*core.Record, error) {
	id := viewAsPersonaID(perms)
	if existing, err := app.FindRecordById("users", id); err == nil {
		if verifyErr := verifyViewAsPersona(app, existing, perms); verifyErr != nil {
			return nil, verifyErr
		}
		return existing, nil
	}
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		return nil, fmt.Errorf("find users collection: %w", err)
	}
	stand := core.NewRecord(users)
	stand.Id = id
	stand.SetEmail(id + "@" + viewAsPersonaEmailDomain)
	stand.SetEmailVisibility(true)
	stand.SetRandomPassword()
	stand.Set("name", viewAsPersonaName(perms))
	stand.Set(fieldIsAdmin, false)
	stand.Set(fieldCachedPermissions, perms)
	if err := app.Save(stand); err != nil {
		// A concurrent request for the same persona may have created it first.
		if existing, findErr := app.FindRecordById("users", id); findErr == nil {
			if verifyErr := verifyViewAsPersona(app, existing, perms); verifyErr != nil {
				return nil, verifyErr
			}
			return existing, nil
		}
		return nil, fmt.Errorf("create view-as persona %s: %w", id, err)
	}
	return stand, nil
}

// viewAsMiddleware makes a real admin's request act as their persona.
//
// It runs right after PocketBase's loadAuthToken and points e.Auth at the
// persona's stand-in users row (ensureViewAsPersona). Collection rules join
// users on e.Auth.Id for is_admin and cached_permissions, and guardConfigWrite
// and sync/api.go read e.Auth directly, so all of them see the persona. The
// real admin's stored record is never written. To PocketBase the request is
// made AS the stand-in: rules comparing @request.auth.id and any write it
// makes are attributed to the persona, which is the honest record of a preview.
//
// auth-* routes are skipped: auth-refresh returns e.Auth as the record the SDK
// stores, and a stand-in there would replace the admin in the tab, hiding the
// switcher that is the only way back.
func viewAsMiddleware() *hook.Handler[*core.RequestEvent] {
	return &hook.Handler[*core.RequestEvent]{
		Id:       viewAsMiddlewareID,
		Priority: apis.DefaultLoadAuthTokenMiddlewarePriority + 1,
		Func: func(e *core.RequestEvent) error {
			if e.Auth == nil || isAuthRoute(e.Request.URL.Path) {
				return e.Next() //nolint:wrapcheck // standard PocketBase hook pattern
			}
			kind := authKindUser
			if e.Auth.IsSuperuser() {
				kind = authKindSuperuser
			} else if e.Auth.Collection().Name != "users" {
				return e.Next() //nolint:wrapcheck // standard PocketBase hook pattern
			}
			decision := decideViewAs(kind, e.Auth.GetBool(fieldIsAdmin),
				e.Auth.GetStringSlice(fieldCachedPermissions), e.Request.Header.Get(ViewAsHeader))
			if decision.Applied {
				persona, err := ensureViewAsPersona(e.App, decision.Permissions)
				if err != nil {
					// Fail closed: never let a preview silently run as the real admin.
					return apis.NewInternalServerError("View-as persona unavailable", err)
				}
				e.Auth = persona
			}
			return e.Next() //nolint:wrapcheck // standard PocketBase hook pattern
		},
	}
}

// isAuthRoute matches /api/collections/{name or id}/auth-*.
func isAuthRoute(path string) bool {
	return strings.HasPrefix(path, "/api/collections/") && strings.Contains(path, "/auth-")
}

// registerViewAsRoleGuard refuses a non-superuser create or update on
// user_roles that targets a view-as persona stand-in. A users.manage holder
// could otherwise assign a role to a stand-in's id, or retarget an existing
// assignment at one; recomputeUserPermissions (hooks.go) would then overwrite
// its cached_permissions, and verifyViewAsPersona would fail every later
// preview of that persona closed with a 500.
func registerViewAsRoleGuard(app core.App) {
	guard := func(e *core.RecordRequestEvent) error {
		if e.HasSuperuserAuth() {
			return e.Next() //nolint:wrapcheck // standard PocketBase hook pattern
		}
		if viewAsPersonaIDPattern.MatchString(e.Record.GetString("user")) {
			return apis.NewBadRequestError("Cannot assign roles to a view-as persona stand-in", nil)
		}
		return e.Next() //nolint:wrapcheck // standard PocketBase hook pattern
	}
	app.OnRecordCreateRequest("user_roles").BindFunc(guard)
	app.OnRecordUpdateRequest("user_roles").BindFunc(guard)
}
