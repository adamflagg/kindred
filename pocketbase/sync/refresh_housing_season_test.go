package sync

import (
	"net/http"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// Audit Fix F: Refresh Housing and the on-demand custom-values runs follow the season being
// viewed (Plan Review Focus 1). Harness: api_viewed_season_test.go.

// ── Fix F: Refresh Housing and the on-demand custom-values runs ─────────────────────────────

// TestRefreshFamilyCampForPriorSeasonRunsTheWholeChainInThatSeason is Refresh Housing on a 2026
// weekend after the rollover: the weekend is resolved in 2026 (CampMinder reuses session ids
// across years, so checking it against 2027 is wrong both ways), and all six jobs run for 2026.
func TestRefreshFamilyCampForPriorSeasonRunsTheWholeChainInThatSeason(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	withNow(t, afterRollover)
	client := newTestCampMinderClient(t, 2027)
	app, weekend := scopeSessionFixture(t, 2026)
	chain := GetRefreshFamilyCampJobs()

	o, rec := newRecordingOrchestrator(t, nil, client, chain...)
	o.SetJobSpacing(0)
	scheduler := &Scheduler{orchestrator: o}

	resp := callHandler(t, app, "/?session=1001&year=2026", func(e *core.RequestEvent) error {
		return handleRefreshFamilyCamp(e, scheduler)
	})
	if resp.Code != http.StatusOK {
		t.Fatalf("session=%d&year=2026 (a 2026 family weekend) got %d: %s", weekend, resp.Code, resp.Body.String())
	}
	waitForRuns(t, rec, len(chain))
	for _, job := range chain {
		if !rec.Ran(job, 2026) {
			t.Errorf("%s must run for 2026, got %v", job, rec.Runs())
		}
		if rec.count(job, 2027) != 0 {
			t.Errorf("%s ran for the primary on a 2026 refresh", job)
		}
		if got := o.GetStatus(job); got == nil || got.Year != 2026 || got.Session != "1001" {
			t.Errorf("%s must be filed under 2026 / weekend 1001, got %+v", job, got)
		}
	}

	t.Run("a season outside the synced pair is refused", func(t *testing.T) {
		resp := callHandler(t, app, "/?session=1001&year=2024", func(e *core.RequestEvent) error {
			return handleRefreshFamilyCamp(e, scheduler)
		})
		if resp.Code != http.StatusBadRequest {
			t.Errorf("year=2024 got %d, want 400: %s", resp.Code, resp.Body.String())
		}
	})
}

// TestRefreshFamilyCampSeasonOverridesScopeTheWeekend: the N-1 chain is built from the season's
// own instances, and the two custom-values jobs are still narrowed to the weekend on screen
// (kindred#2601), exactly as the primary's overrides are.
func TestRefreshFamilyCampSeasonOverridesScopeTheWeekend(t *testing.T) {
	t.Parallel()
	o := NewOrchestrator(nil)
	overrides, err := refreshFamilyCampSeasonOverrides(o.servicesForYear(2026, false), "1001")
	if err != nil {
		t.Fatal(err)
	}
	for _, job := range GetRefreshFamilyCampJobs() {
		if overrides[job] == nil {
			t.Errorf("no 2026 instance for %s; it would run the primary's", job)
		}
	}
	person, ok := overrides[scopedID(serviceNamePersonCustomValues, ScopeFamilyCamp)].(*PersonCustomFieldValuesSync)
	if !ok || person.Session != "1001" || person.Scope != ScopeFamilyCamp {
		t.Errorf("person custom values override = %+v, want weekend 1001, family-camp scope", person)
	}
	householdID := scopedID(serviceNameHouseholdCustomValues, ScopeFamilyCamp)
	household, ok := overrides[householdID].(*HouseholdCustomFieldValuesSync)
	if !ok || household.Session != "1001" || household.Scope != ScopeFamilyCamp {
		t.Errorf("household custom values override = %+v, want weekend 1001, family-camp scope", household)
	}
	if _, err := refreshFamilyCampSeasonOverrides(map[string]Service{}, "1001"); err == nil {
		t.Error("a season with no instance for a chain job must be refused, not run on the primary's")
	}
}

// TestPersonCustomValuesOnDemandHonoursYear is Manage > Sync's on-demand custom-values cards while
// viewing 2026: both read CampMinder for 2026 and file the run under 2026.
func TestPersonCustomValuesOnDemandHonoursYear(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	withNow(t, afterRollover)
	client := newTestCampMinderClient(t, 2027)

	handlers := map[string]func(*core.RequestEvent, *Scheduler) error{
		serviceNamePersonCustomValues:    handlePersonCustomFieldValuesSync,
		serviceNameHouseholdCustomValues: handleHouseholdCustomFieldValuesSync,
	}
	for job, handler := range handlers {
		runInBubble(t, func(t *testing.T) {
			o, rec := newRecordingOrchestrator(t, nil, client, job)
			scheduler := &Scheduler{orchestrator: o}
			resp := callHandler(t, nil, "/?year=2026", func(e *core.RequestEvent) error {
				return handler(e, scheduler)
			})
			if resp.Code != http.StatusOK {
				t.Fatalf("%s ?year=2026 got %d: %s", job, resp.Code, resp.Body.String())
			}
			time.Sleep(time.Minute)
			if !rec.Ran(job, 2026) || rec.count(job, 2027) != 0 {
				t.Errorf("%s must read CampMinder for 2026, got %v", job, rec.Runs())
			}
			if got := o.GetStatus(job); got == nil || got.Year != 2026 {
				t.Errorf("%s must be filed under 2026, got %+v", job, got)
			}

			resp = callHandler(t, nil, "/?year=2024", func(e *core.RequestEvent) error {
				return handler(e, scheduler)
			})
			if resp.Code != http.StatusBadRequest {
				t.Errorf("%s ?year=2024 got %d, want 400", job, resp.Code)
			}
			time.Sleep(time.Minute)
			if runs := rec.Runs(); len(runs) != 1 {
				t.Errorf("a refused %s request still started a run: %v", job, runs)
			}
			if got := o.GetStatus(job); got == nil || got.Status != statusSuccess || got.Year != 2026 {
				t.Errorf("a refused %s request disturbed the finished 2026 run: %+v", job, got)
			}
		})
	}
}
