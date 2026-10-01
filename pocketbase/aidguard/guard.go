// Package aidguard makes a financial-aid write "only if unchanged" (campership G6).
//
// Each collection in Collections carries a `revision` number field (the
// *_aid_rules_revision.js migration). Every save of one of its records moves the
// revision on by one -- a FastAPI write, a PocketBase dashboard edit, a Go save,
// alike -- and a create starts it at 0. An update or delete request that sends
// `If-Match: "<n>"` commits only while the stored revision is still n; otherwise
// it fails with 412 Precondition Failed. FastAPI's commit_aid_writes sends every
// aid write as one /api/batch transaction, so the failed sub-request rolls back
// the record writes and aid_change_log rows beside it.
//
// The check reads the record inside the batch's transaction (PocketBase runs
// every transaction on its single non-concurrent connection), so nothing can
// save the record between the check and the write. Outside a batch the record
// is read before the write's own transaction begins, so an If-Match there is
// refused rather than honored without that guarantee.
package aidguard

import (
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

// FieldRevision is the number field every guarded collection carries.
const FieldRevision = "revision"

// HeaderIfMatch names the revision a write read, as a quoted strong entity tag ("7").
const HeaderIfMatch = "If-Match"

// Collections are the collections whose writes carry a revision. Pinned to the
// migration by TestGuardedCollectionsMatchTheMigration and, in Python, to
// bunking/financial_aid/change_log.py REVISIONED_COLLECTIONS.
var Collections = []string{"aid_rules"}

// RegisterHooks binds the guard to every collection in Collections. Binding
// looks nothing up, so it is safe before the app bootstraps.
func RegisterHooks(app core.App) {
	for _, name := range Collections {
		app.OnRecordCreate(name).BindFunc(startRevision)
		app.OnRecordUpdate(name).BindFunc(nextRevision)
		app.OnRecordUpdateRequest(name).BindFunc(func(e *core.RecordRequestEvent) error {
			if err := checkIfMatch(e); err != nil {
				return err
			}
			return e.Next()
		})
		app.OnRecordDeleteRequest(name).BindFunc(func(e *core.RecordRequestEvent) error {
			if err := checkIfMatch(e); err != nil {
				return err
			}
			return e.Next()
		})
	}
	slog.Info("aid write guard registered", "collections", strings.Join(Collections, ","))
}

// startRevision: a new record is at revision 0, whatever the request sent.
func startRevision(e *core.RecordEvent) error {
	e.Record.Set(FieldRevision, 0)
	return e.Next()
}

// nextRevision: every save moves the revision on by one, whatever the request
// sent, so no writer can hide a change from one that read the record earlier.
func nextRevision(e *core.RecordEvent) error {
	e.Record.Set(FieldRevision, e.Record.Original().GetInt(FieldRevision)+1)
	return e.Next()
}

// checkIfMatch refuses a write whose If-Match is not the stored revision. A
// write without If-Match passes: FastAPI requires one on its side for every
// guarded write, and the dashboard's own edits (no header) still move the
// revision on, so a FastAPI write that read before them is refused.
//
// A batch sub-request starts from a copy of the outer /api/batch request's
// headers and then sets its own, so an If-Match on the outer request would
// reach every sub-request. bunking/pocketbase_batch.py's send_batch never sends
// one there: a revision travels only in its own sub-request's headers.
func checkIfMatch(e *core.RecordRequestEvent) error {
	raw := strings.TrimSpace(e.Request.Header.Get(HeaderIfMatch))
	if raw == "" {
		return nil
	}
	if context, _ := e.Get(core.RequestEventKeyInfoContext).(string); context != core.RequestInfoContextBatch {
		return apis.NewBadRequestError(
			"If-Match is honored only inside /api/batch, where the check and the write share one transaction", nil)
	}
	want, err := parseRevision(raw)
	if err != nil {
		return apis.NewBadRequestError(err.Error(), nil)
	}
	stored := e.Record.Original().GetInt(FieldRevision)
	if stored != want {
		return apis.NewApiError(http.StatusPreconditionFailed, fmt.Sprintf(
			"%s %s changed since it was read (revision %d, not %d): reload and try again",
			e.Collection.Name, e.Record.Id, stored, want), nil)
	}
	return nil
}

// parseRevision reads `"7"` (the form FastAPI sends) as 7.
func parseRevision(raw string) (int, error) {
	bad := fmt.Errorf("If-Match must be a quoted revision such as \"3\", got %s", raw)
	if len(raw) < 3 || raw[0] != '"' || raw[len(raw)-1] != '"' {
		return 0, bad
	}
	n, err := strconv.Atoi(raw[1 : len(raw)-1])
	if err != nil || n < 0 {
		return 0, bad
	}
	return n, nil
}
