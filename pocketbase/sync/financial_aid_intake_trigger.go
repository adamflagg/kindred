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

// intakeReportCounts is the part of FastAPI's intake report the sync logs: counts only. The report names no
// person, and nothing here would log one if it did.
type intakeReportCounts struct {
	Households           int `json:"households"`
	RequestsCreated      int `json:"requests_created"`
	RequestsUpdated      int `json:"requests_updated"`
	RowsWithoutRequest   int `json:"rows_without_request"`
	RowsWithoutHousehold int `json:"rows_without_household"`
}

// TriggerFinancialAidIntake asks FastAPI to rebuild one season's intake. It is
// set as FinancialAidApplicationsSync.IntakeTrigger at every production
// construction site; tests leave the field nil.
//
// It logs how many aid form rows made no request, and how many carried no
// household. Intake counted both and nothing read them, so a form row that never
// became a request was invisible.
func TriggerFinancialAidIntake(ctx context.Context, year int) error {
	report, err := postFinancialAidIntake(ctx, getAPIURL(), year)
	if err != nil {
		return err
	}
	slog.Info("Financial-aid intake rebuilt",
		"year", year,
		"households", report.Households,
		"requests_created", report.RequestsCreated,
		"requests_updated", report.RequestsUpdated,
		"rows_without_request", report.RowsWithoutRequest,
		"rows_without_household", report.RowsWithoutHousehold,
	)
	return nil
}

// postFinancialAidIntake runs the rebuild and reads its counts. A 200 whose body cannot be read is still a
// rebuild that ran: it returns zero counts and a warning, never an error.
func postFinancialAidIntake(ctx context.Context, apiURL string, year int) (intakeReportCounts, error) {
	raw, err := postFinancialAidSeason(ctx, financialAidIntakeClient, apiURL+financialAidIntakePath, "intake", year)
	if err != nil {
		return intakeReportCounts{}, err
	}
	var report intakeReportCounts
	if err := json.Unmarshal(raw, &report); err != nil {
		slog.Warn("Financial-aid intake report could not be read", "year", year, "error", err)
		return intakeReportCounts{}, nil
	}
	return report, nil
}

// maxSeasonErrDetail caps the detail quoted from a refusal, in runes, so a warning stays one short line.
const maxSeasonErrDetail = 200

// maxSeasonReportBytes caps how much of a 200's body is read: a season report is a few hundred bytes.
const maxSeasonReportBytes = 1 << 16

// postFinancialAidSeason POSTs {"year": year} to one of FastAPI's campership season jobs (intake,
// the ledger tick) and treats anything but 200 as a failure, naming the job. Only a string
// "detail" (a service refusal) is quoted, truncated: FastAPI's own validation 422 carries a list,
// and a raw body is never echoed, since it could hold names. On a 200 it returns the body for the
// caller to read.
func postFinancialAidSeason(ctx context.Context, client *http.Client, url, what string, year int) ([]byte, error) {
	body, err := json.Marshal(map[string]int{"year": year})
	if err != nil {
		return nil, fmt.Errorf("marshaling %s request: %w", what, err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("building %s request: %w", what, err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("calling financial-aid %s: %w", what, err)
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
				if clipped := truncateRunes(d, maxSeasonErrDetail); clipped != d {
					d = clipped + "..."
				}
				detail = ": " + d
			}
		}
		return nil, fmt.Errorf("financial-aid %s returned %d%s", what, resp.StatusCode, detail)
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxSeasonReportBytes))
	if err != nil {
		return nil, fmt.Errorf("reading financial-aid %s response: %w", what, err)
	}
	return raw, nil
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
