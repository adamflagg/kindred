package sync

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"
)

// financialAidIntakePath is FastAPI's campership intake rebuild (sub-project 5).
// It groups financial_aid_applications into one application per family and one
// request per program answer, so it must run after this mirror writes.
const financialAidIntakePath = "/api/internal/financial-aid/intake"

var financialAidIntakeClient = &http.Client{Timeout: 10 * time.Minute}

// TriggerFinancialAidIntake asks FastAPI to rebuild one season's intake. It is
// set as FinancialAidApplicationsSync.IntakeTrigger at every production
// construction site; tests leave the field nil.
func TriggerFinancialAidIntake(ctx context.Context, year int) error {
	return postFinancialAidIntake(ctx, getAPIURL(), year)
}

func postFinancialAidIntake(ctx context.Context, apiURL string, year int) error {
	body, err := json.Marshal(map[string]int{"year": year})
	if err != nil {
		return fmt.Errorf("marshaling intake request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, apiURL+financialAidIntakePath, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("building intake request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := financialAidIntakeClient.Do(req)
	if err != nil {
		return fmt.Errorf("calling financial-aid intake: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return fmt.Errorf("financial-aid intake returned %d: %s", resp.StatusCode, string(msg))
	}
	return nil
}

// runIntakeTrigger rebuilds intake after the mirror wrote. A failure does not
// fail the mirror, which did write, but it is counted and logged at ERROR so the
// sync run shows it rather than leaving intake silently stale.
func (s *FinancialAidApplicationsSync) runIntakeTrigger(ctx context.Context, year int) {
	if s.IntakeTrigger == nil {
		return
	}
	if err := s.IntakeTrigger(ctx, year); err != nil {
		s.Stats.Errors++
		slog.Error("Financial-aid intake rebuild failed after the FA mirror wrote", "year", year, "error", err)
	}
}
