package bunkrequests

import (
	"fmt"
	"log/slog"

	"github.com/pocketbase/pocketbase/core"
)

// BackfillAll iterates every distinct (year, session_id, request_type, A, B)
// tuple in bunk_requests and calls RecomputePairReciprocity for each.
// Idempotent — safe to re-run.
//
// Returns the total number of tuples processed. If any individual recompute
// fails, the loop continues but BackfillAll returns a non-nil error so the
// CLI exit status reflects the partial failure.
func BackfillAll(app core.App) (int, error) {
	type tuple struct {
		Year        int    `db:"year"`
		SessionID   int    `db:"session_id"`
		RequestType string `db:"request_type"`
		PersonA     int    `db:"a"`
		PersonB     int    `db:"b"`
	}
	var tuples []tuple
	err := app.DB().NewQuery(`
		SELECT DISTINCT
			year,
			session_id,
			request_type,
			MIN(requester_id, requestee_id) AS a,
			MAX(requester_id, requestee_id) AS b
		FROM bunk_requests
		WHERE request_type IN ('bunk_with', 'not_bunk_with')
		  AND requester_id > 0
		  AND requestee_id > 0
		  AND requester_id != requestee_id
	`).All(&tuples)
	if err != nil {
		return 0, fmt.Errorf("query distinct pair tuples: %w", err)
	}

	var failed int
	for _, t := range tuples {
		if err := RecomputePairReciprocity(
			app, t.Year, t.SessionID, t.PersonA, t.PersonB, t.RequestType,
		); err != nil {
			failed++
			slog.Warn("pair recompute failed",
				"year", t.Year, "session", t.SessionID,
				"a", t.PersonA, "b", t.PersonB, "type", t.RequestType,
				"error", err,
			)
		}
	}
	if failed > 0 {
		return len(tuples), fmt.Errorf("backfill incomplete: %d of %d pair recomputes failed", failed, len(tuples))
	}
	return len(tuples), nil
}
