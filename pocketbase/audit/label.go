package audit

import (
	"strconv"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// targetLabel is the human label an entry shows for a record ("Sam Patel",
// "Registrar", "Cabin 14", "solver.max_cabin_size"), plus any detail the
// sentence needs (a role assignment's role name). Resolved at write time, so a
// later rename or deletion never changes history. Unknown collections (PB Admin
// on business tables) get no label: the screen shows the collection and id.
//
// before is the pre-update raw field snapshot (hooks.go's own `before`, taken
// from record.Original() BEFORE e.Next() runs — reading it any later is
// unreliable, see bunk_requests/hooks.go's preUpdateCache doc), or nil on a
// create, delete, or any call outside the record-request hook. Only
// userRoleLabel reads it.
func targetLabel(app core.App, record *core.Record, before map[string]any) (label string, detail map[string]any) {
	switch record.Collection().Name {
	case usersCollection:
		return firstNonEmpty(record.GetString("name"), record.Email()), nil
	case core.CollectionNameSuperusers:
		return record.Email(), nil
	case "roles":
		return record.GetString("name"), nil
	case "permission_descriptions":
		return record.GetString("codename"), nil
	case "user_roles":
		return userRoleLabel(app, record, before)
	case "config":
		return joinNonEmpty(".", record.GetString("category"), record.GetString("subcategory"),
			record.GetString("config_key")), nil
	case "lodging_units", "lodging_areas":
		return firstNonEmpty(record.GetString("name"), record.GetString("code")), nil
	case "lodging_unit_aliases":
		return record.GetString("alias_string"), nil
	case "lodging_ingest_issues":
		return record.GetString("raw_value"), nil
	case "lodging_session_status":
		return sessionLabel(app, record.GetInt("session_cm_id"), record.GetInt("year")), nil
	}
	return "", nil
}

// userRoleLabel names the person, and puts the NEW role's name in detail.role
// (always — create, update and delete all read this). On an UPDATE where the
// role or user relation actually changed, it also names the OLD side:
// detail.role_before, and detail.user_before / detail.user (the frontend's
// generic Before/After path otherwise prints the raw PocketBase relation ids —
// kindred#2880 follow-up). Guarded by "changed", not by action: create passes
// before=nil, and delete's before equals the current record (nothing to
// diff), so neither ever adds the _before keys.
func userRoleLabel(app core.App, record *core.Record, before map[string]any) (label string, detail map[string]any) {
	userID := record.GetString("user")
	label = userID
	if user, err := app.FindRecordById(usersCollection, userID); err == nil {
		label = firstNonEmpty(user.GetString("name"), user.Email())
	}
	detail = map[string]any{}
	roleID := record.GetString("role")
	if role, err := app.FindRecordById("roles", roleID); err == nil {
		detail["role"] = role.GetString("name")
	}
	if before == nil {
		return label, detail
	}
	if oldRoleID, _ := before["role"].(string); oldRoleID != "" && oldRoleID != roleID {
		if oldRole, err := app.FindRecordById("roles", oldRoleID); err == nil {
			detail["role_before"] = oldRole.GetString("name")
		}
	}
	if oldUserID, _ := before["user"].(string); oldUserID != "" && oldUserID != userID {
		detail["user"] = label
		if oldUser, err := app.FindRecordById(usersCollection, oldUserID); err == nil {
			detail["user_before"] = firstNonEmpty(oldUser.GetString("name"), oldUser.Email())
		}
	}
	return label, detail
}

// sessionLabel names a weekend by its camp_sessions row, falling back to its id.
func sessionLabel(app core.App, cmID, year int) string {
	session, err := app.FindFirstRecordByFilter("camp_sessions", "cm_id = {:cm} && year = {:year}",
		dbx.Params{"cm": cmID, "year": year})
	if err == nil && session.GetString("name") != "" {
		return session.GetString("name")
	}
	return "session " + strconv.Itoa(cmID)
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func joinNonEmpty(sep string, parts ...string) string {
	kept := make([]string, 0, len(parts))
	for _, p := range parts {
		if strings.TrimSpace(p) != "" {
			kept = append(kept, p)
		}
	}
	return strings.Join(kept, sep)
}
