package audit

import (
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/hook"
)

// hookPriority runs the audit hooks before every other request hook, so the
// transaction they open wraps the rbac and lodging guards and the save itself.
// A guard that refuses returns an error through e.Next(), the transaction rolls
// back, and nothing is logged.
const hookPriority = -1000

// guardPriority runs the append-only refusals before even the audit hooks.
const guardPriority = hookPriority - 1

const appendOnlyMessage = "The admin audit log is append-only: its entries and schema cannot be changed or deleted."

// auditWriteFailed is the error a fail-closed path returns when its row could
// not be written. The change is rolled back with it.
func auditWriteFailed(err error) error {
	return apis.NewInternalServerError("The change was not saved: the admin audit log could not record it.", err)
}

// inTransaction runs next inside one transaction on e's app, pointing the
// event's App at the transaction for everything the chain does, then restores
// it. This is PocketBase's documented request-hook pattern. Inside a batch the
// event's App is already the batch's transaction, and RunInTransaction joins it
// (core/db_tx.go runInTransaction: an existing *dbx.Tx runs fn directly).
//
// Regular record, collection and settings routes write their response through
// execAfterSuccessTx(true, ...) (apis/record_helpers.go), so the response is
// held until the transaction commits: a rolled-back change never answers 200.
func inTransaction(e *core.RequestEvent, fn func(txApp core.App) error) error {
	original := e.App
	defer func() { e.App = original }()
	return original.RunInTransaction(func(txApp core.App) error { //nolint:wrapcheck // the hook's own error
		e.App = txApp
		return fn(txApp)
	})
}

// ---------------------------------------------------------------------------
// Record create, update and delete requests (spec §4.1, §4.2)
// ---------------------------------------------------------------------------

func bindRecordRequestHooks(app core.App) {
	bind := func(action string) *hook.Handler[*core.RecordRequestEvent] {
		return &hook.Handler[*core.RecordRequestEvent]{
			Id:       "kindredAuditRecord_" + action,
			Priority: hookPriority,
			Func:     func(e *core.RecordRequestEvent) error { return auditRecordRequest(e, action) },
		}
	}
	app.OnRecordCreateRequest().Bind(bind(ActionCreate))
	app.OnRecordUpdateRequest().Bind(bind(ActionUpdate))
	app.OnRecordDeleteRequest().Bind(bind(ActionDelete))
}

func auditRecordRequest(e *core.RecordRequestEvent, action string) error {
	cfg, registered := configFor(e.App)
	if !registered {
		return e.Next() //nolint:wrapcheck // standard PocketBase hook pattern
	}
	actor, ok := resolveActor(e.RequestEvent, cfg)
	if !ok {
		return e.Next() //nolint:wrapcheck // standard PocketBase hook pattern
	}
	entryType, ok := classify(e.Collection.Name, actor)
	if !ok {
		return e.Next() //nolint:wrapcheck // standard PocketBase hook pattern
	}
	// e.Record already carries the request body; Original() is what is stored.
	var before map[string]any
	if action != ActionCreate {
		before = snapshot(e.Record.Original())
	}
	return inTransaction(e.RequestEvent, func(txApp core.App) error {
		if err := e.Next(); err != nil {
			return err //nolint:wrapcheck // a refusal from the chain, returned as is
		}
		var after map[string]any
		if action != ActionDelete {
			after = snapshot(e.Record)
		}
		row := Row{Type: entryType, Action: action, Collection: e.Collection.Name, RecordID: e.Record.Id, IP: e.RealIP()}
		row.Before, row.After, row.Fields = changes(e.Collection.Name, before, after)
		if action == ActionUpdate && len(row.Fields) == 0 {
			return nil // a save that changed nothing is not an event
		}
		actor.apply(&row)
		row.TargetLabel, row.Detail = targetLabel(txApp, e.Record, before)
		return writeFailClosed(txApp, &row)
	})
}

// ---------------------------------------------------------------------------
// Append-only (spec §5)
// ---------------------------------------------------------------------------

func bindAppendOnlyGuards(app core.App) {
	// Model level: refuses API calls AND Go app.Save / app.Delete, including a
	// collection truncate (core.TruncateCollection deletes record by record).
	refuse := func(*core.RecordEvent) error { return ErrAppendOnly }
	app.OnRecordUpdate(CollectionName).BindFunc(refuse)
	app.OnRecordDelete(CollectionName).BindFunc(refuse)

	// Request level: nobody, the service included, creates, edits or deletes an
	// entry through the API. Entries are written only by this package, in Go.
	refuseRequest := &hook.Handler[*core.RecordRequestEvent]{
		Id:       "kindredAuditAppendOnlyRecord",
		Priority: guardPriority,
		Func: func(*core.RecordRequestEvent) error {
			return apis.NewForbiddenError(appendOnlyMessage, nil)
		},
	}
	app.OnRecordCreateRequest(CollectionName).Bind(refuseRequest)
	app.OnRecordUpdateRequest(CollectionName).Bind(refuseRequest)
	app.OnRecordDeleteRequest(CollectionName).Bind(refuseRequest)
}
