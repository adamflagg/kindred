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
	return postFinancialAidSeason(ctx, financialAidIntakeClient, apiURL+financialAidIntakePath, "intake", year)
}

// maxSeasonErrDetail caps the detail quoted from a refusal, so a warning stays one short line.
const maxSeasonErrDetail = 200

// postFinancialAidSeason POSTs {"year": year} to one of FastAPI's campership season jobs (intake,
// the ledger tick) and treats anything but 200 as a failure, naming the job. Only a string
// "detail" (a service refusal) is quoted, truncated: FastAPI's own validation 422 carries a list,
// and a raw body is never echoed, since it could hold names.
func postFinancialAidSeason(ctx context.Context, client *http.Client, url, what string, year int) error {
	body, err := json.Marshal(map[string]int{"year": year})
	if err != nil {
		return fmt.Errorf("marshaling %s request: %w", what, err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("building %s request: %w", what, err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("calling financial-aid %s: %w", what, err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		var parsed struct {
			Detail any `json:"detail"`
		}
		detail := ""
		if json.Unmarshal(raw, &parsed) == nil {
			if d, ok := parsed.Detail.(string); ok {
				if len(d) > maxSeasonErrDetail {
					d = d[:maxSeasonErrDetail] + "..."
				}
				detail = ": " + d
			}
		}
		return fmt.Errorf("financial-aid %s returned %d%s", what, resp.StatusCode, detail)
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
