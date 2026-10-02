package audit

import (
	"slices"
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

// Actor is who an entry is recorded against, copied at write time so the entry
// survives the account's deletion.
type Actor struct {
	Kind  string
	ID    string
	Email string
	Name  string
}

func (a Actor) apply(row *Row) {
	row.ActorKind = a.Kind
	row.ActorID = a.ID
	row.ActorEmail = a.Email
	row.ActorName = a.Name
}

// resolveActor returns the real person behind a request, and false when the
// request must not be logged: nobody is signed in (a guest; the OAuth2 sign-up's
// own create is logged by the sign-in hook instead), or it is Kindred's service.
//
// Under view-as, e.Auth is the persona stand-in and the real admin is in the
// request store (RealAuthKey); the store wins.
func resolveActor(e *core.RequestEvent, cfg Config) (Actor, bool) {
	auth := e.Auth
	if realAdmin, ok := e.Get(RealAuthKey).(*core.Record); ok && realAdmin != nil {
		auth = realAdmin
	}
	if auth == nil || cfg.isService(auth) {
		return Actor{}, false
	}
	return actorFromRecord(auth), true
}

// actorFromRecord describes an auth record. A view-as stand-in is never
// recorded as itself: without the real admin it is "an admin previewing".
func actorFromRecord(record *core.Record) Actor {
	if record.IsSuperuser() {
		return Actor{Kind: ActorSuperuser, ID: record.Id, Email: record.Email()}
	}
	if isViewAsStandIn(record) {
		return Actor{Kind: ActorUser, Name: UnidentifiedPreviewer}
	}
	return Actor{Kind: ActorUser, ID: record.Id, Email: record.Email(), Name: record.GetString("name")}
}

func isViewAsStandIn(record *core.Record) bool {
	return strings.HasSuffix(strings.ToLower(record.Email()), "@"+ViewAsEmailDomain)
}

// accessCollections are checked BEFORE the superuser rule: adding a superuser or
// removing an account is Access whoever does it (spec §2 lists "superuser
// created or removed" under Access, which only a superuser can do; mockup v8
// shows "removed user" by a PB Admin as Access).
//
// user_roles is TypeAccess, not TypeRoles: giving or taking a role from a
// person is Access; TypeRoles is only the roles collection (definitions)
// (owner ruling 2026-09-26).
var accessCollections = map[string]string{
	usersCollection:               TypeAccess,
	core.CollectionNameSuperusers: TypeAccess,
	"roles":                       TypeRoles,
	"user_roles":                  TypeAccess,
	"permission_descriptions":     TypeRoles,
}

// managementAllowlist is every collection the Manage menu writes directly
// through PocketBase (spec §4.2 step 5): `config` from the Configuration and
// Registration tabs, and the lodging registry from Family Camp Lodging
// (frontend/src/services/lodgingCrud.ts). A Go constant on purpose: changing
// it takes a PR, never a GUI setting (owner preference). TestManagementAllowlist
// pins it; update both together.
var managementAllowlist = []string{
	"config",
	"lodging_areas",
	"lodging_ingest_issues",
	"lodging_session_status",
	"lodging_unit_aliases",
	"lodging_units",
}

// ManagementAllowlist returns a copy of the Settings collections.
func ManagementAllowlist() []string {
	return slices.Clone(managementAllowlist)
}

// classify decides a record write's entry type, and false when it is not logged
// (spec §4.2): the log itself, then the access set, then any superuser (PB
// Admin, any collection), then the management allowlist. Everything else is
// business work and is not logged.
func classify(collection string, actor Actor) (string, bool) {
	if collection == CollectionName {
		return "", false
	}
	if t, ok := accessCollections[collection]; ok {
		return t, true
	}
	if actor.Kind == ActorSuperuser {
		return TypePBAdmin, true
	}
	if slices.Contains(managementAllowlist, collection) {
		return TypeSettings, true
	}
	return "", false
}
