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
func targetLabel(app core.App, record *core.Record) (label string, detail map[string]any) {
	switch record.Collection().Name {
	case usersCollection:
		return firstNonEmpty(record.GetString("name"), record.Email()), nil
	case core.CollectionNameSuperusers:
		return record.Email(), nil
	case "roles":
		return record.GetString("name"), nil
	case "user_roles":
		return userRoleLabel(app, record)
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

// userRoleLabel names the person, and puts the role's name in detail.role.
func userRoleLabel(app core.App, record *core.Record) (label string, detail map[string]any) {
	label = record.GetString("user")
	if user, err := app.FindRecordById(usersCollection, label); err == nil {
		label = firstNonEmpty(user.GetString("name"), user.Email())
	}
	detail = map[string]any{}
	if role, err := app.FindRecordById("roles", record.GetString("role")); err == nil {
		detail["role"] = role.GetString("name")
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
