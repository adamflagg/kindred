package bunkrequests

import (
	"log/slog"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

// RegisterHooks wires reciprocity-recompute hooks onto the bunk_requests
// collection. Errors are logged via slog and never block the underlying write.
func RegisterHooks(app *pocketbase.PocketBase) {
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

// runRecompute extracts pair coords from the event record and invokes the
// helper. Errors are logged but never propagated — best-effort correctness.
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
}
