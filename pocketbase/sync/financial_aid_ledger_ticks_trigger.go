package sync

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/pocketbase/dbx"
)

// financialAidLedgerTicksPath is FastAPI's automatic Posted tick (campership sub-project 10b, D78).
// It ticks Posted where CampMinder holds camp aid on a request beyond what its posted rounds lock.
// The lock is the calculator's decided amount, which only FastAPI prices, and each tick is a logged
// aid_decisions write through sub-project 4a's helper, so the tick runs there and this sync only
// asks for it, after the ledger it reads is written.
const financialAidLedgerTicksPath = "/api/internal/financial-aid/ledger-ticks"

var financialAidLedgerTicksClient = &http.Client{Timeout: 10 * time.Minute}

// TriggerFinancialAidLedgerTicks asks FastAPI to run one season's automatic Posted tick. It is set
// as AidPostingsSync.LedgerTickTrigger at every production construction site; tests leave it nil.
func TriggerFinancialAidLedgerTicks(ctx context.Context, year int) error {
	return postFinancialAidLedgerTicks(ctx, getAPIURL(), year)
}

func postFinancialAidLedgerTicks(ctx context.Context, apiURL string, year int) error {
	return postFinancialAidSeason(ctx, financialAidLedgerTicksClient, apiURL+financialAidLedgerTicksPath,
		"ledger tick", year)
}

// runLedgerTickTrigger ticks each season the ledger wrote. A failure does not fail the ledger, which
// did write: it is logged at ERROR and counted in AidLedgerWarnings, which reaches sync_runs.
func (s *AidPostingsSync) runLedgerTickTrigger(ctx context.Context, years []int) {
	// A cancelled run asks for nothing: each call would fail on the dead context and count a warning,
	// and the next night's run re-derives every tick from the ledger anyway.
	if s.LedgerTickTrigger == nil || s.DryRun || ctx.Err() != nil {
		return
	}
	for _, year := range years {
		if ctx.Err() != nil {
			return // cancelled, or out of time, partway: the same holds for every season left
		}
		if err := s.LedgerTickTrigger(ctx, year); err != nil {
			// A warning, not an error: an error marks the ledger run failed, and a failed run doesn't
			// move "the last successful ledger sync", so every tick would read "awaiting tonight's
			// sync". No retry: the next night's run re-derives every tick from the ledger.
			s.Stats.AidLedgerWarnings++
			slog.Error("Campership ledger tick failed after the aid ledger wrote", "year", year, "error", err)
		}
	}
}

// scheduledRunTriggers are the sync_runs triggers of a current-season queue: each such run spans
// seasons N-1..N+1 but is recorded under the configured season N. Mirrors _SCHEDULED_TRIGGERS in
// api/services/financial_aid_decisions_repository.py.
var scheduledRunTriggers = map[string]bool{triggerHourly: true, triggerDaily: true, triggerWeekly: true}

// ledgerRunCovers is confirmation's coverage rule (ledger_run_covers in
// financial_aid_decisions_repository.py): a scheduled run covers the seasons within a year of the
// one it recorded; any other run (manual, pinned) covers only its own. Change one, change both.
func ledgerRunCovers(trigger string, recordedYear, season int) bool {
	if scheduledRunTriggers[trigger] {
		return recordedYear >= season-1 && recordedYear <= season+1
	}
	return recordedYear == season
}

// ledgerRunPage bounds the runs read per season, as confirmation's _RUN_PAGE does.
const ledgerRunPage = 100

// seasonInputStale reports whether the newest financial_transactions run covering `season` did not
// succeed and, if so, the end of the newest successful covering run ("" if none of the page). No
// covering run on record, or a failed query, is not stale: like staleInputAsOf, this check never
// holds a tick back over its own telemetry.
func (s *AidPostingsSync) seasonInputStale(season int) (stale bool, lastGood string) {
	runs, err := s.App.FindRecordsByFilter(syncRunsCollection,
		"service = {:svc} && year >= {:lo} && year <= {:hi}", "-started,-id", ledgerRunPage, 0,
		dbx.Params{"svc": serviceNameFinancialTransactions, "lo": season - 1, "hi": season + 1})
	if err != nil {
		return false, ""
	}
	newest := true
	for _, run := range runs {
		if !ledgerRunCovers(run.GetString("trigger"), run.GetInt("year"), season) {
			continue
		}
		success := run.GetString("status") == statusSuccess
		if newest {
			if success {
				return false, ""
			}
			newest = false
			continue
		}
		if success {
			return true, run.GetString("ended")
		}
	}
	return !newest, ""
}

// tickFreshSeasons asks for the tick of each season the ledger wrote whose transactions input is
// fresh (owner rulings 2026-09-30). A season whose newest covering financial_transactions run did
// not succeed is skipped: aid_postings rebuilt it from older rows, and confirmation reads that night
// as no sync for the season (SP10b Decision 12: the last ledger sync is the older of the two
// services' last successful covering runs), so a tick would disagree with it. The next night with
// fresh transactions ticks instead. Each skip is a warning, never an error, so the run is not red;
// silent when no tick would have been asked for anyway.
func (s *AidPostingsSync) tickFreshSeasons(ctx context.Context, years []int) {
	if s.LedgerTickTrigger == nil || s.DryRun || ctx.Err() != nil {
		return
	}
	fresh := make([]int, 0, len(years))
	for _, year := range years {
		if stale, lastGood := s.seasonInputStale(year); stale {
			s.Stats.AidLedgerWarnings++
			slog.Warn("Skipping the campership ledger tick: aid_postings input may be stale",
				"year", year, "last_successful_transactions_sync", lastGood)
			continue
		}
		fresh = append(fresh, year)
	}
	s.runLedgerTickTrigger(ctx, fresh)
}
