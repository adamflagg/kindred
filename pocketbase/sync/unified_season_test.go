package sync

import (
	"net/http"
	"slices"
	"strconv"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// Audit Fix E: a manual run-all for a synced prior season is not a historical replay.
// Harness: api_viewed_season_test.go.

// ── Fix E: a manual run-all for N-1 is not a historical replay ──────────────────────────────

// TestUnifiedRunForThePriorSeasonIncludesSyncedSeasonsOnlyJobs: Manage > Sync > Run for 2026
// after the rollover runs every SyncedSeasonsOnly job a full run carries (the request import,
// request processing, lifecycle reconcile, the family-camp custom values), as the same run for
// the primary does. Only a year outside the synced pair is a replay that skips them. Jotform is
// SyncedSeasonsOnly too but never part of a full run for any season (its registry row carries
// no TriggerFullRun), so it is not expected here.
func TestUnifiedRunForThePriorSeasonIncludesSyncedSeasonsOnlyJobs(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	t.Setenv("JOTFORM_API_KEY", "test-key")
	t.Setenv("IS_DOCKER", "true")
	withNow(t, afterRollover)
	client := newTestCampMinderClient(t, 2027)

	for _, tc := range []struct {
		year    int
		include bool
	}{{2026, true}, {2025, false}} {
		runInBubble(t, func(t *testing.T) {
			o, rec := newRecordingOrchestrator(t, nil, client)
			scheduler := &Scheduler{orchestrator: o}
			target := "/?service=all&year=" + strconv.Itoa(tc.year)
			resp := callHandler(t, nil, target, func(e *core.RequestEvent) error {
				return handleUnifiedSync(e, scheduler)
			})
			if resp.Code != http.StatusOK {
				t.Fatalf("%s got %d: %s", target, resp.Code, resp.Body.String())
			}
			time.Sleep(time.Hour)
			if !rec.Ran("attendees", tc.year) {
				t.Fatalf("the %d run never ran: %v", tc.year, rec.Runs())
			}
			var syncedOnly []string
			for _, m := range syncJobMeta {
				if m.SyncedSeasonsOnly && m.Triggers&TriggerFullRun != 0 && (m.Gate == nil || m.Gate()) &&
					m.Phase != PhaseExpensive {
					syncedOnly = append(syncedOnly, m.ID)
				}
			}
			if !slices.Contains(syncedOnly, "process_requests") || !slices.Contains(syncedOnly, "bunk_requests") {
				t.Fatalf("premise: process_requests and bunk_requests are SyncedSeasonsOnly full-run jobs, got %v", syncedOnly)
			}
			for _, job := range syncedOnly {
				if got := rec.Ran(job, tc.year); got != tc.include {
					t.Errorf("year %d: %s ran = %v, want %v", tc.year, job, got, tc.include)
				}
			}
		})
	}
}
