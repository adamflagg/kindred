package audit

import (
	"net/http"
	"regexp"
	"slices"
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

// WriteAction records a Settings action a Go route handler performed: a manual
// sync run or a lodging roll-forward (spec §4.6). Pass the handler's transaction
// app when it has one, so the row commits or rolls back with the change, and
// act on the error: it is the caller's to refuse on (roll-forward) or log
// (a sync run, which has already started and cannot be taken back).
//
// A request from Kindred's service, or with nobody signed in, writes nothing
// and returns nil: scheduled and service-triggered runs are not logged.
func WriteAction(app core.App, e *core.RequestEvent, action string, detail map[string]any) error {
	cfg, registered := configFor(app)
	if !registered {
		return ErrNotRegistered
	}
	actor, ok := resolveActor(e, cfg)
	if !ok {
		return nil
	}
	row := Row{Type: TypeSettings, Action: action, Detail: detail, IP: e.RealIP()}
	actor.apply(&row)
	return write(app, &row)
}

// WriteAdminGroupChange records the OIDC hook changing is_admin from the Pocket
// ID admin group at sign-in (spec §4.5). The actor is the system; the person
// is both who signed in and the target. Fail open, like every sign-in path.
func WriteAdminGroupChange(app core.App, e *core.RequestEvent, user *core.Record, isAdmin bool) {
	action := ActionAdminRemoved
	if isAdmin {
		action = ActionAdminGranted
	}
	label, _ := targetLabel(app, user)
	row := Row{
		Type: TypeAccess, Action: action, ActorKind: ActorSystem, ActorID: user.Id, ActorEmail: user.Email(),
		ActorName: user.GetString("name"), Collection: usersCollection, RecordID: user.Id, TargetLabel: label,
		Before: map[string]any{fieldIsAdmin: !isAdmin}, After: map[string]any{fieldIsAdmin: isAdmin},
		Fields: []string{fieldIsAdmin}, Detail: map[string]any{"via": "pocket_id_admin_group"}, IP: e.RealIP(),
	}
	writeFailOpen(app, &row)
}

// ---------------------------------------------------------------------------
// View-as sessions (spec §4.4)
// ---------------------------------------------------------------------------

// ViewAsStartPath and ViewAsStopPath are under /api/custom/ because Caddy routes
// only that prefix (with /api/collections, /api/files, ...) to PocketBase;
// anything else under /api/ goes to FastAPI (docker/Caddyfile @pocketbase).
const (
	ViewAsStartPath = "/api/custom/view-as/start"
	ViewAsStopPath  = "/api/custom/view-as/stop"
)

// sessionIDPattern accepts a crypto.randomUUID() and nothing surprising.
var sessionIDPattern = regexp.MustCompile(`^[A-Za-z0-9-]{8,64}$`)

const (
	maxPersonaChars   = 100
	maxPersonaPerms   = 60
	maxPermissionChar = 64
)

type viewAsEvent struct {
	SessionID   string   `json:"session_id"`
	Persona     string   `json:"persona"`
	Permissions []string `json:"permissions"`
}

func registerViewAsRoutes(se *core.ServeEvent) {
	se.Router.POST(ViewAsStartPath, func(e *core.RequestEvent) error { return handleViewAs(e, ActionViewAsStart) })
	se.Router.POST(ViewAsStopPath, func(e *core.RequestEvent) error { return handleViewAs(e, ActionViewAsStop) })
}

// handleViewAs records one end of a preview. The switcher sends it WITHOUT the
// view-as header, so e.Auth is the real admin; a request that still carries a
// persona is refused rather than recorded against the stand-in. The write fails
// open: a preview is never blocked by the audit log.
func handleViewAs(e *core.RequestEvent, action string) error {
	if e.Get(RealAuthKey) != nil {
		return e.BadRequestError("Send view-as events without the view-as header.", nil)
	}
	if e.Auth == nil || e.Auth.IsSuperuser() || e.Auth.Collection().Name != usersCollection ||
		!e.Auth.GetBool(fieldIsAdmin) {
		return e.ForbiddenError("Only an admin can preview as another role.", nil)
	}
	var body viewAsEvent
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("Invalid view-as event.", err)
	}
	if !sessionIDPattern.MatchString(body.SessionID) {
		return e.BadRequestError("The session id must be 8 to 64 letters, digits or dashes.", nil)
	}
	row := Row{Type: TypeViewAs, Action: action, SessionID: body.SessionID, IP: e.RealIP()}
	if action == ActionViewAsStart {
		row.Detail = map[string]any{
			"persona":     clip(strings.TrimSpace(body.Persona), maxPersonaChars),
			"permissions": cleanPermissions(body.Permissions),
		}
	}
	actorFromRecord(e.Auth).apply(&row)
	writeFailOpen(e.App, &row)
	return e.NoContent(http.StatusNoContent)
}

func cleanPermissions(perms []string) []string {
	out := []string{}
	for _, p := range perms {
		p = clip(strings.TrimSpace(p), maxPermissionChar)
		if p != "" && !slices.Contains(out, p) {
			out = append(out, p)
		}
	}
	slices.Sort(out)
	if len(out) > maxPersonaPerms {
		out = out[:maxPersonaPerms]
	}
	return out
}
