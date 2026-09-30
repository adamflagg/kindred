package sync

import (
	"context"
	"log/slog"
	"net/http"
	"time"
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
