package audit

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
