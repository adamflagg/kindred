// Package audittest builds admin_audit_log in Go test apps and reads it back.
//
// A Go test cannot apply the JS migrations, so CreateCollection mirrors
// pb_migrations/1500000206_admin_audit_log.js field for field.
// rbac/admin_audit_log_booted_test.go compares the two on CI's booted schema,
// so the mirror cannot drift from the migration unnoticed.
package audittest

import (
	"encoding/json"
	"testing"

	"github.com/pocketbase/pocketbase/core"

	"github.com/camp/kindred/pocketbase/audit"
)

// ServiceEmail is the fictional service superuser every audit test configures.
const ServiceEmail = "kindred-service@kindred.invalid"

// Types and ActorKinds are the select values, in the migration's order.
var (
	Types      = []string{"access", "roles", "view_as", "settings", "pb_admin", "sign_in"}
	ActorKinds = []string{"user", "superuser", "system"}
)

// Collection returns the Go mirror of the migration's collection, unsaved.
func Collection() *core.Collection {
	c := core.NewBaseCollection(audit.CollectionName)
	c.ListRule, c.ViewRule, c.CreateRule, c.UpdateRule, c.DeleteRule = nil, nil, nil, nil, nil
	c.Fields.Add(
		&core.SelectField{Name: "type", Required: true, MaxSelect: 1, Values: Types},
		&core.TextField{Name: "action", Required: true, Min: 1, Max: 40},
		&core.SelectField{Name: "actor_kind", Required: true, MaxSelect: 1, Values: ActorKinds},
		&core.TextField{Name: "actor_id", Max: 50},
		&core.TextField{Name: "actor_email", Max: 320},
		&core.TextField{Name: "actor_name", Max: 255},
		&core.TextField{Name: "collection", Max: 100},
		&core.TextField{Name: "record_id", Max: 50},
		&core.TextField{Name: "target_label", Max: 255},
		&core.JSONField{Name: "before", MaxSize: 32768},
		&core.JSONField{Name: "after", MaxSize: 32768},
		&core.TextField{Name: "fields", Max: 2000},
		&core.TextField{Name: "session_id", Max: 64},
		&core.JSONField{Name: "detail", MaxSize: 8192},
		&core.TextField{Name: "ip", Max: 64},
		&core.AutodateField{Name: "created", OnCreate: true},
	)
	c.AddIndex("idx_admin_audit_log_created", false, "`created`", "")
	c.AddIndex("idx_admin_audit_log_type_created", false, "`type`, `created`", "")
	c.AddIndex("idx_admin_audit_log_actor_created", false, "`actor_email`, `created`", "")
	return c
}

// CreateCollection saves Collection() into app.
func CreateCollection(t testing.TB, app core.App) *core.Collection {
	t.Helper()
	c := Collection()
	if err := app.Save(c); err != nil {
		t.Fatalf("create %s: %v", audit.CollectionName, err)
	}
	return c
}

// Setup creates the collection and registers the audit log with ServiceEmail
// as Kindred's service account.
func Setup(t testing.TB, app core.App) {
	t.Helper()
	CreateCollection(t, app)
	audit.Register(app, audit.Config{ServiceEmail: ServiceEmail})
}

// Rows returns every entry, oldest first.
func Rows(t testing.TB, app core.App) []*core.Record {
	t.Helper()
	rows, err := app.FindRecordsByFilter(audit.CollectionName, "", "created", 0, 0)
	if err != nil {
		t.Fatalf("read %s: %v", audit.CollectionName, err)
	}
	return rows
}

// RowsOfType returns the entries of one type, oldest first.
func RowsOfType(t testing.TB, app core.App, entryType string) []*core.Record {
	t.Helper()
	var out []*core.Record
	for _, r := range Rows(t, app) {
		if r.GetString("type") == entryType {
			out = append(out, r)
		}
	}
	return out
}

// JSON decodes a json field into a map (nil when empty or null).
func JSON(t testing.TB, r *core.Record, field string) map[string]any {
	t.Helper()
	raw := r.GetString(field)
	if raw == "" || raw == "null" {
		return nil
	}
	var m map[string]any
	if err := json.Unmarshal([]byte(raw), &m); err != nil {
		t.Fatalf("%s.%s is not a JSON object: %v", audit.CollectionName, field, err)
	}
	return m
}

// Dump is the whole row as JSON text, for "this string must never appear" checks.
func Dump(t testing.TB, r *core.Record) string {
	t.Helper()
	raw, err := json.Marshal(r.FieldsData())
	if err != nil {
		t.Fatalf("marshal row: %v", err)
	}
	return string(raw)
}
