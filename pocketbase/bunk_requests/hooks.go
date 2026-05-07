package bunkrequests

import (
	"log/slog"
	"sync"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

// pairCoords identifies a (year, session, requester, requestee, type) tuple.
type pairCoords struct {
	Year        int
	SessionID   int
	Requester   int
	Requestee   int
	RequestType string
}

// preUpdateCache stashes the pre-mutation DB state of each row about to be
// updated, keyed by record ID. The post-success handler reads it to detect
// pair-coord changes that orphan the old partner's is_reciprocal.
//
// PocketBase's Record.Original() refreshes mid-save and is unreliable inside
// AfterUpdateSuccess, so we capture coords ourselves before the mutation
// lands and read them out after.
var preUpdateCache sync.Map // map[string]pairCoords

// RegisterHooks wires reciprocity-recompute hooks onto the bunk_requests
// collection. Errors are logged via slog and never block the underlying write.
func RegisterHooks(app *pocketbase.PocketBase) {
	app.OnRecordUpdate("bunk_requests").BindFunc(func(e *core.RecordEvent) error {
		captureOldCoords(e)
		err := e.Next()
		if err != nil && e.Record != nil && e.Record.Id != "" {
			// AfterUpdateSuccess won't fire, so cleanup the cache entry
			// captureOldCoords just stored — otherwise it leaks.
			preUpdateCache.Delete(e.Record.Id)
		}
		return err
	})
	app.OnRecordAfterCreateSuccess("bunk_requests").BindFunc(func(e *core.RecordEvent) error {
		runRecompute(e)
		return e.Next()
	})
	app.OnRecordAfterUpdateSuccess("bunk_requests").BindFunc(func(e *core.RecordEvent) error {
		runRecompute(e)
		return e.Next()
	})
	app.OnRecordAfterDeleteSuccess("bunk_requests").BindFunc(func(e *core.RecordEvent) error {
		runRecompute(e)
		return e.Next()
	})

	slog.Info("bunk_requests reciprocity hooks registered")
}

// captureOldCoords reads the pre-mutation pair coords directly from the DB
// (since the in-memory e.Record already holds the user's mutations) and
// stashes them keyed by record ID. The corresponding AfterUpdateSuccess
// reads and clears the entry.
func captureOldCoords(e *core.RecordEvent) {
	r := e.Record
	if r == nil || r.Id == "" {
		return
	}
	old, err := e.App.FindRecordById("bunk_requests", r.Id)
	if err != nil {
		// Best-effort: a failed read here means the post-update recompute
		// won't see the OLD pair coords, so an ID-mutating update could
		// orphan a stale partner row. Log so drift is at least traceable.
		slog.Warn("captureOldCoords: pre-update read failed",
			"record_id", r.Id,
			"error", err,
		)
		return
	}
	if old == nil {
		return
	}
	preUpdateCache.Store(r.Id, pairCoords{
		Year:        old.GetInt("year"),
		SessionID:   old.GetInt("session_id"),
		Requester:   old.GetInt("requester_id"),
		Requestee:   old.GetInt("requestee_id"),
		RequestType: old.GetString("request_type"),
	})
}

// runRecompute extracts pair coords from the event record and invokes the
// helper. Errors are logged but never propagated — best-effort correctness.
//
// If a previous UpdateExecute captured pre-mutation coords for this record
// and they differ from the current coords, the OLD pair is also recomputed
// so the previous partner's is_reciprocal doesn't get orphaned.
func runRecompute(e *core.RecordEvent) {
	r := e.Record
	if r == nil {
		return
	}
	year := r.GetInt("year")
	sessionID := r.GetInt("session_id")
	requester := r.GetInt("requester_id")
	requestee := r.GetInt("requestee_id")
	requestType := r.GetString("request_type")

	if err := RecomputePairReciprocity(e.App, year, sessionID, requester, requestee, requestType); err != nil {
		slog.Error("RecomputePairReciprocity failed",
			"requester", requester,
			"requestee", requestee,
			"request_type", requestType,
			"error", err,
		)
	}

	if r.Id == "" {
		return
	}
	cached, ok := preUpdateCache.LoadAndDelete(r.Id)
	if !ok {
		return
	}
	old, ok := cached.(pairCoords)
	if !ok {
		return
	}

	pairUnchanged := old.Requester == requester &&
		old.Requestee == requestee &&
		old.Year == year &&
		old.SessionID == sessionID &&
		old.RequestType == requestType
	if pairUnchanged {
		return
	}
	if old.Requester == 0 || old.Requestee == 0 {
		return
	}

	if err := RecomputePairReciprocity(
		e.App, old.Year, old.SessionID, old.Requester, old.Requestee, old.RequestType,
	); err != nil {
		slog.Error("RecomputePairReciprocity failed (old pair)",
			"requester", old.Requester,
			"requestee", old.Requestee,
			"request_type", old.RequestType,
			"error", err,
		)
	}
}
