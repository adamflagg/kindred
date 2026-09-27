// Package audit writes Kindred's admin audit log (admin_audit_log): who changed
// access, roles, the Manage-menu settings or anything behind the app, and when.
//
// It is not a log of the business work done in the app. Bunking work, financial
// aid (which keeps its own aid_change_log), metrics, the CampMinder sync, reads,
// token refreshes and failed sign-ins are never logged, and neither is anything
// Kindred's own service account does (spec 2026-09-26-admin-audit-log-design §2).
//
// Three rules hold everywhere:
//   - A logged record, schema or settings write commits in ONE transaction with
//     its audit row. If the row cannot be written, the change is refused.
//   - Sign-ins, view-as events and the admin-group sync fail OPEN: they change no
//     data, and an audit bug must never lock anyone out. A failed write there is
//     an slog.Error and the request proceeds.
//   - The log is append-only: no API or Go write may change or delete a row.
package audit

import (
	"errors"
	"log/slog"
	"os"
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

// CollectionName is the audit log's PocketBase collection
// (pb_migrations/1500000206_admin_audit_log.js).
const CollectionName = "admin_audit_log"

// RealAuthKey is the request-store key rbac's viewAsMiddleware sets to the real
// admin before it points e.Auth at a view-as persona stand-in. PocketBase copies
// the store into every batch sub-request (apis/batch.go, processInternalRequest:
// event.SetAll(baseEvent.GetAll())), so a write inside a batch finds it too.
// Identity is never read from a header: a batch sub-request can override every
// header except Authorization.
const RealAuthKey = "kindred.realAuth"

// Collections and fields the package names more than once.
const (
	usersCollection = "users"
	fieldIsAdmin    = "is_admin"
)

// ServiceEmailEnv names Kindred's service superuser. The pocketbase container
// receives it from docker-compose.yml (email only, never the password).
const ServiceEmailEnv = "POCKETBASE_ADMIN_EMAIL"

// ViewAsEmailDomain marks a view-as persona stand-in user. It mirrors
// rbac.viewAsPersonaEmailDomain; rbac's TestViewAsStandInDomainMatchesAudit
// pins the two together (rbac imports this package, not the other way round).
const ViewAsEmailDomain = "view-as.invalid"

// UnidentifiedPreviewer is the actor name recorded when a view-as stand-in
// reaches a hook without the real admin in the request store. The middleware
// always sets it, so this is a tripwire, not a path (rbac's
// TestViewAsMiddlewareRecordsTheRealAdmin pins that).
const UnidentifiedPreviewer = "an admin previewing (unidentified)"

// Entry types, as the screen's filter buttons name them.
const (
	TypeAccess = "access"
	// TypeRoles is role DEFINITIONS only -- create/edit/delete a row in the
	// `roles` collection itself. Giving or taking a role FROM a person
	// (user_roles create/delete/update) is TypeAccess (owner ruling 2026-09-26).
	TypeRoles    = "roles"
	TypeViewAs   = "view_as"
	TypeSettings = "settings"
	TypePBAdmin  = "pb_admin"
	TypeSignIn   = "sign_in"
)

// Actions.
const (
	ActionCreate         = "create"
	ActionUpdate         = "update"
	ActionDelete         = "delete"
	ActionSignIn         = "sign_in"
	ActionViewAsStart    = "view_as_start"
	ActionViewAsStop     = "view_as_stop"
	ActionSyncRun        = "sync_run"
	ActionRollForward    = "roll_forward"
	ActionSchemaChange   = "schema_change"
	ActionSettingsChange = "settings_change"
	ActionAdminGranted   = "admin_granted"
	ActionAdminRemoved   = "admin_removed"
)

// Actor kinds.
const (
	ActorUser      = "user"
	ActorSuperuser = "superuser"
	ActorSystem    = "system"
)

// ErrAppendOnly is returned by every attempt to change or delete an audit row.
var ErrAppendOnly = errors.New("admin_audit_log is append-only: entries cannot be changed or deleted")

// ErrNotRegistered is returned by WriteAction when Register was never called on
// the app, so a fail-closed caller refuses its change rather than losing its row.
var ErrNotRegistered = errors.New("admin audit log is not registered on this app")

// Config is the audit log's one setting.
type Config struct {
	// ServiceEmail is Kindred's service superuser. Blank means no account is
	// treated as the service, so everything any superuser does is logged.
	ServiceEmail string
}

// ConfigFromEnv reads ServiceEmailEnv.
func ConfigFromEnv() Config {
	return Config{ServiceEmail: strings.TrimSpace(os.Getenv(ServiceEmailEnv))}
}

// isService reports whether record is Kindred's service superuser. Only a
// superuser can be the service; a users record with the same email is a person.
func (c Config) isService(record *core.Record) bool {
	return c.ServiceEmail != "" && record != nil && record.IsSuperuser() &&
		strings.EqualFold(strings.TrimSpace(record.Email()), c.ServiceEmail)
}

const configStoreKey = "kindred.audit.config"

// configFor returns the Config Register stored on app. The store is shared by
// every transaction clone of the app (core/db_tx.go createTxApp copies the
// pointer), so a handler's txApp finds it too.
func configFor(app core.App) (Config, bool) {
	cfg, ok := app.Store().Get(configStoreKey).(Config)
	return cfg, ok
}

// Register wires the whole audit log onto app: the record, schema and settings
// request hooks, the append-only guards, the sign-in hooks and the view-as
// routes. main.go calls it once, after rbac.RegisterHooks.
func Register(app core.App, cfg Config) {
	if cfg.ServiceEmail == "" {
		// Fail loud, not silent (spec §3): with no service account every
		// superuser action is logged, including the API's own writes.
		slog.Warn("admin audit log: " + ServiceEmailEnv + " is not set; no account is treated as " +
			"Kindred's service, so every superuser action will be logged")
	} else {
		slog.Info("admin audit log: Kindred's service account is excluded")
	}
	app.Store().Set(configStoreKey, cfg)
	bindAppendOnlyGuards(app)
	bindRecordRequestHooks(app)
	bindSchemaAndSettingsHooks(app)
}
