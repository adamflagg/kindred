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
	wireHooks(app)
	slog.Info("bunk_requests reciprocity hooks registered")
}

// wireHooks attaches all 4 reciprocity BindFunc calls to any core.App
// implementation. Extracted so that both RegisterHooks (production) and the
// test suite (which uses *tests.TestApp, not *pocketbase.PocketBase) share a
// single hook-binding implementation.
func wireHooks(app core.App) {
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

	// Read and clear the pre-update cache BEFORE invoking RecomputePairReciprocity.
	// RecomputePairReciprocity may save sibling rows (or even this same row again,
	// when multiple source_field siblings share these pair coords). Those saves
	// re-enter OnRecordUpdate → captureOldCoords, which would overwrite our
	// cache entry with post-mutation coords and cause us to miss the old-pair
	// recompute below.
	var oldCoords pairCoords
	hasOldCoords := false
	if r.Id != "" {
		if cached, ok := preUpdateCache.LoadAndDelete(r.Id); ok {
			if old, ok := cached.(pairCoords); ok {
				oldCoords = old
				hasOldCoords = true
			}
		}
	}

	if err := RecomputePairReciprocity(e.App, year, sessionID, requester, requestee, requestType); err != nil {
		slog.Error("RecomputePairReciprocity failed",
			"requester", requester,
			"requestee", requestee,
			"request_type", requestType,
			"error", err,
		)
	}

	if !hasOldCoords {
		return
	}

	pairUnchanged := oldCoords.Requester == requester &&
		oldCoords.Requestee == requestee &&
		oldCoords.Year == year &&
		oldCoords.SessionID == sessionID &&
		oldCoords.RequestType == requestType
	if pairUnchanged {
		return
	}
	if oldCoords.Requester == 0 || oldCoords.Requestee == 0 {
		return
	}

	if err := RecomputePairReciprocity(
		e.App, oldCoords.Year, oldCoords.SessionID, oldCoords.Requester, oldCoords.Requestee, oldCoords.RequestType,
	); err != nil {
		slog.Error("RecomputePairReciprocity failed (old pair)",
			"requester", oldCoords.Requester,
			"requestee", oldCoords.Requestee,
			"request_type", oldCoords.RequestType,
			"error", err,
		)
	}
}
