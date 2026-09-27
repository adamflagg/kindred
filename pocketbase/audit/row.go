package audit

import (
	"fmt"
	"log/slog"
	"strings"
	"unicode/utf8"

	"github.com/pocketbase/pocketbase/core"
)

// Text caps, matching pb_migrations/1500000206_admin_audit_log.js.
const (
	maxFieldsChars = 2000
	maxLabelChars  = 255
)

// Row is one admin_audit_log entry before it is saved.
type Row struct {
	Type        string
	Action      string
	ActorKind   string
	ActorID     string
	ActorEmail  string
	ActorName   string
	Collection  string
	RecordID    string
	TargetLabel string
	Before      map[string]any
	After       map[string]any
	Fields      []string
	SessionID   string
	Detail      map[string]any
	IP          string
}

// write saves row through app: the caller's transaction app when the row must
// commit or roll back with a change.
func write(app core.App, row *Row) error {
	collection, err := app.FindCachedCollectionByNameOrId(CollectionName)
	if err != nil {
		return fmt.Errorf("admin audit log: find collection: %w", err)
	}
	record := core.NewRecord(collection)
	record.Set("type", row.Type)
	record.Set("action", row.Action)
	record.Set("actor_kind", row.ActorKind)
	record.Set("actor_id", row.ActorID)
	record.Set("actor_email", row.ActorEmail)
	record.Set("actor_name", clip(row.ActorName, maxLabelChars))
	record.Set("collection", row.Collection)
	record.Set("record_id", row.RecordID)
	record.Set("target_label", clip(row.TargetLabel, maxLabelChars))
	if row.Before != nil {
		record.Set("before", row.Before)
	}
	if row.After != nil {
		record.Set("after", row.After)
	}
	record.Set("fields", clip(strings.Join(row.Fields, " "), maxFieldsChars))
	record.Set("session_id", row.SessionID)
	if row.Detail != nil {
		record.Set("detail", row.Detail)
	}
	record.Set("ip", row.IP)
	if err := app.Save(record); err != nil {
		return fmt.Errorf("admin audit log: write %s/%s: %w", row.Type, row.Action, err)
	}
	return nil
}

// writeFailClosed is write for the request paths that must refuse the change
// they are recording when the row cannot be written (spec §4.1): the caller
// returns this straight from its transaction function, which rolls back
// whatever e.Next() already committed. One helper so every fail-closed call
// site does the same thing (Tasks 4 and 5 reuse it for schema and settings
// writes).
func writeFailClosed(txApp core.App, row *Row) error {
	if err := write(txApp, row); err != nil {
		return auditWriteFailed(err)
	}
	return nil
}

// writeFailOpen is write for the paths that change no data (sign-ins, view-as
// events, the admin-group sync): a failure is logged and swallowed. An app the
// audit log was never registered on has no log to write to.
func writeFailOpen(app core.App, row *Row) {
	if _, ok := configFor(app); !ok {
		return
	}
	if err := write(app, row); err != nil {
		slog.Error("admin audit log: could not record an event; the request proceeds",
			"type", row.Type, "action", row.Action, "error", err)
	}
}

// clip cuts s to at most n characters, on a rune boundary.
func clip(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n])
}
