package sync

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	gosync "sync"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// The tests in this file pin plan Review Focus 1: after the Oct 15 rollover staff keep working
// the prior season N-1 (the October adult weekends, Jotform, Refresh Housing, bunk-request
// uploads). A sync a staff member starts while viewing N-1 must sync N-1, never silently the
// primary. Absent `year` still means the primary, exactly as before; a year outside the synced
// pair is a 400 on every staff route except the unified run, which keeps its historical replay.
//
// Every test runs at 2026-10-20, so the primary is 2027 and the synced pair is [2027, 2026].

var afterRollover = time.Date(2026, time.October, 20, 10, 0, 0, 0, time.UTC)

// callHandler runs one staff route against a recording orchestrator and returns the response.
func callHandler(
	t *testing.T, app core.App, target string, handler func(*core.RequestEvent) error,
) *httptest.ResponseRecorder {
	t.Helper()
	re := &core.RequestEvent{}
	re.App = app
	re.Request = httptest.NewRequest(http.MethodPost, target, http.NoBody)
	rec := httptest.NewRecorder()
	re.Response = rec
	if err := handler(re); err != nil {
		t.Fatalf("handler returned error: %v", err)
	}
	return rec
}

// waitForRuns polls (in real time) until the recorder has seen at least n runs.
func waitForRuns(t *testing.T, rec *seasonRecorder, n int) []seasonRun {
	t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		if runs := rec.Runs(); len(runs) >= n {
			return runs
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %d run(s), saw %v", n, rec.Runs())
	return nil
}

// ── Task 7: the individual-sync routes ─────────────────────────────────────────────────────

// TestIndividualSyncForThePriorSeasonRunsThatSeason is the Jotform tab's "Pull now" (and every
// Manage > Sync card) while viewing 2026: it must pull 2026's forms with a 2026 instance, and
// leave the registered (primary) instance alone.
func TestIndividualSyncForThePriorSeasonRunsThatSeason(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	withNow(t, afterRollover)
	client := newTestCampMinderClient(t, 2027)

	runInBubble(t, func(t *testing.T) {
		o, rec := newRecordingOrchestrator(t, nil, client, "jotform_submissions", "attendees")
		scheduler := &Scheduler{orchestrator: o}
		registeredJotform := o.GetService("jotform_submissions").(*yearRecorder)
		registeredAttendees := o.GetService("attendees")

		for _, job := range []string{"jotform_submissions", "attendees"} {
			resp := callHandler(t, nil, "/?year=2026", func(e *core.RequestEvent) error {
				return handleIndividualSync(e, scheduler, job)
			})
			if resp.Code != http.StatusOK {
				t.Fatalf("%s ?year=2026 got %d: %s", job, resp.Code, resp.Body.String())
			}
			time.Sleep(time.Minute)
		}

		for _, job := range []string{"jotform_submissions", "attendees"} {
			if !rec.Ran(job, 2026) {
				t.Errorf("%s must run for 2026 while staff view 2026, got %v", job, rec.Runs())
			}
			if rec.count(job, 2027) != 0 {
				t.Errorf("%s ran for the primary (2027) on a 2026 request", job)
			}
			if got := o.GetStatus(job); got == nil || got.Year != 2026 {
				t.Errorf("%s run must be filed under 2026, got %+v", job, got)
			}
		}
		if registeredJotform.year != 0 {
			t.Errorf("the registered Jotform instance was moved to %d; a 2026 pull must use its own", registeredJotform.year)
		}
		if o.GetService("attendees") != registeredAttendees {
			t.Error("a 2026 run swapped the registry's attendees instance")
		}
	})
}

// TestIndividualSyncWithoutAYearRunsThePrimary pins the unchanged half: no year (and the
// primary named explicitly) runs the registered instance for the primary.
func TestIndividualSyncWithoutAYearRunsThePrimary(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	withNow(t, afterRollover)
	client := newTestCampMinderClient(t, 2027)

	runInBubble(t, func(t *testing.T) {
		o, rec := newRecordingOrchestrator(t, nil, client, "jotform_submissions")
		scheduler := &Scheduler{orchestrator: o}
		for _, target := range []string{"/", "/?year=2027"} {
			resp := callHandler(t, nil, target, func(e *core.RequestEvent) error {
				return handleIndividualSync(e, scheduler, "jotform_submissions")
			})
			if resp.Code != http.StatusOK {
				t.Fatalf("%s got %d: %s", target, resp.Code, resp.Body.String())
			}
			time.Sleep(time.Minute)
		}
		if got := rec.count("jotform_submissions", 2027); got != 2 {
			t.Errorf("no year and ?year=2027 must both run the primary; got %v", rec.Runs())
		}
	})
}

// TestIndividualSyncRejectsASeasonOutsideTheSyncedPair: a year the scheduled runs do not cover
// (or not a year at all) is refused, never quietly run as the primary.
func TestIndividualSyncRejectsASeasonOutsideTheSyncedPair(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	withNow(t, afterRollover)
	client := newTestCampMinderClient(t, 2027)

	runInBubble(t, func(t *testing.T) {
		o, rec := newRecordingOrchestrator(t, nil, client, "jotform_submissions")
		scheduler := &Scheduler{orchestrator: o}
		for _, target := range []string{"/?year=2024", "/?year=2028", "/?year=abc"} {
			resp := callHandler(t, nil, target, func(e *core.RequestEvent) error {
				return handleIndividualSync(e, scheduler, "jotform_submissions")
			})
			if resp.Code != http.StatusBadRequest {
				t.Errorf("%s got %d, want 400: %s", target, resp.Code, resp.Body.String())
			}
		}
		time.Sleep(time.Minute)
		if runs := rec.Runs(); len(runs) != 0 {
			t.Errorf("a refused request still ran: %v", runs)
		}
	})
}

// TestQueuedIndividualSyncRemembersItsSeason: a 2026 request that arrives while another job is
// running is queued, and the queued run must still be 2026's when it is dequeued.
func TestQueuedIndividualSyncRemembersItsSeason(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	withNow(t, afterRollover)
	client := newTestCampMinderClient(t, 2027)

	runInBubble(t, func(t *testing.T) {
		o, rec := newRecordingOrchestrator(t, nil, client, "jotform_submissions", "attendees")
		scheduler := &Scheduler{orchestrator: o}
		if err := o.MarkSyncRunning("attendees"); err != nil {
			t.Fatal(err)
		}
		resp := callHandler(t, nil, "/?year=2026", func(e *core.RequestEvent) error {
			return handleIndividualSync(e, scheduler, "jotform_submissions")
		})
		if resp.Code != http.StatusAccepted {
			t.Fatalf("expected the busy orchestrator to queue the request, got %d: %s", resp.Code, resp.Body.String())
		}
		if q := o.GetQueuedSyncs(); len(q) != 1 || q[0].Year != 2026 {
			t.Fatalf("the queued item must remember 2026, got %+v", q)
		}
		o.FinalizeSyncStatus("attendees", Stats{}, nil)

		processQueuedSyncs(o)

		if !rec.Ran("jotform_submissions", 2026) || rec.count("jotform_submissions", 2027) != 0 {
			t.Errorf("the dequeued run must be 2026's, got %v", rec.Runs())
		}
		if got := o.GetService("jotform_submissions").(*yearRecorder).year; got != 0 {
			t.Errorf("the dequeued 2026 run configured the registered instance (year %d)", got)
		}
	})
}

// processorCapture is an httptest FastAPI that records the year each processor call names.
type processorCapture struct {
	mu    gosync.Mutex
	years []int
}

func (c *processorCapture) serve(t *testing.T) {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req apiProcessorRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err == nil && req.Year != 0 {
			c.mu.Lock()
			c.years = append(c.years, req.Year)
			c.mu.Unlock()
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"success": true}`))
	}))
	t.Cleanup(server.Close)
	t.Setenv("API_URL", server.URL)
}

func (c *processorCapture) waitFor(t *testing.T, n int) []int {
	t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		c.mu.Lock()
		got := slices.Clone(c.years)
		c.mu.Unlock()
		if len(got) >= n {
			return got
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %d processor call(s)", n)
	return nil
}

// waitForFinished polls until job has a completed status.
func waitForFinished(t *testing.T, o *Orchestrator, job string) *Status {
	t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		if !o.IsRunning(job) {
			o.mu.RLock()
			got := o.lastCompletedStatus[job]
			o.mu.RUnlock()
			if got != nil {
				return got
			}
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("%s never finished", job)
	return nil
}

// TestProcessRequestsRouteProcessesTheViewedSeason is Manage > Sync's Process Requests while
// viewing 2026.
func TestProcessRequestsRouteProcessesTheViewedSeason(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	withNow(t, afterRollover)
	client := newTestCampMinderClient(t, 2027)
	capture := &processorCapture{}
	capture.serve(t)

	o, _ := newRecordingOrchestrator(t, nil, client, "process_requests")
	// The handler runs process_requests on a real goroutine (capture.serve is a real HTTP
	// server, so no synctest bubble). Cleanups run last-in first-out, so this one waits that run
	// out before withNow's restores nowFn -- on the failure paths too, where waitForFinished is
	// never reached (CodeRabbit nitpick on #3211).
	t.Cleanup(func() {
		for deadline := time.Now().Add(30 * time.Second); o.IsRunning("process_requests") && time.Now().Before(deadline); {
			time.Sleep(20 * time.Millisecond)
		}
	})
	scheduler := &Scheduler{orchestrator: o}
	resp := callHandler(t, nil, "/?year=2026", func(e *core.RequestEvent) error {
		return handleProcessRequests(e, scheduler)
	})
	if resp.Code != http.StatusOK {
		t.Fatalf("?year=2026 got %d: %s", resp.Code, resp.Body.String())
	}
	if got := capture.waitFor(t, 1); !slices.Equal(got, []int{2026}) {
		t.Errorf("process_requests asked FastAPI for %v, want [2026]", got)
	}
	if got := waitForFinished(t, o, "process_requests"); got.Year != 2026 {
		t.Errorf("the run must be filed under 2026, got %d", got.Year)
	}

	resp = callHandler(t, nil, "/?year=2024", func(e *core.RequestEvent) error {
		return handleProcessRequests(e, scheduler)
	})
	if resp.Code != http.StatusBadRequest {
		t.Errorf("?year=2024 got %d, want 400", resp.Code)
	}
}

// ── Scan findings on #3211: Run Phase for the prior season ─────────────────────────────────

// TestRunPhaseForThePriorSeasonRunsThatSeason is Manage > Sync's Run Phase while viewing 2026.
// Client-backed jobs ignore SetYear, so running the registered instances would fetch the
// primary (2027) from CampMinder and file it under 2026. Each job must run 2026's own instance,
// and the registry must stay the primary's.
func TestRunPhaseForThePriorSeasonRunsThatSeason(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	withNow(t, afterRollover)
	client := newTestCampMinderClient(t, 2027)

	runInBubble(t, func(t *testing.T) {
		o, rec := newRecordingOrchestrator(t, nil, client, "attendees", "bunk_requests")
		scheduler := &Scheduler{orchestrator: o}
		registeredAttendees := o.GetService("attendees")
		registeredRequests := o.GetService("bunk_requests")

		for _, target := range []string{"/?year=2026&phase=source", "/?year=2026&phase=process"} {
			resp := callHandler(t, nil, target, func(e *core.RequestEvent) error {
				return handleRunPhase(e, scheduler)
			})
			if resp.Code != http.StatusOK {
				t.Fatalf("%s got %d: %s", target, resp.Code, resp.Body.String())
			}
			time.Sleep(time.Minute)
		}

		for _, job := range []string{"attendees", "bunk_requests"} {
			if !rec.Ran(job, 2026) {
				t.Errorf("%s must run for 2026 on a 2026 Run Phase, got %v", job, rec.Runs())
			}
			if rec.count(job, 2027) != 0 {
				t.Errorf("%s ran for the primary (2027) on a 2026 Run Phase", job)
			}
		}
		if o.GetService("attendees") != registeredAttendees || o.GetService("bunk_requests") != registeredRequests {
			t.Error("a 2026 Run Phase swapped a registered instance")
		}
	})
}

// TestRunPhaseForThePrimaryStillRunsTheRegisteredInstances pins the unchanged half.
func TestRunPhaseForThePrimaryStillRunsTheRegisteredInstances(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	withNow(t, afterRollover)
	client := newTestCampMinderClient(t, 2027)

	runInBubble(t, func(t *testing.T) {
		o, rec := newRecordingOrchestrator(t, nil, client, "attendees")
		scheduler := &Scheduler{orchestrator: o}
		resp := callHandler(t, nil, "/?year=2027&phase=source", func(e *core.RequestEvent) error {
			return handleRunPhase(e, scheduler)
		})
		if resp.Code != http.StatusOK {
			t.Fatalf("got %d: %s", resp.Code, resp.Body.String())
		}
		time.Sleep(time.Minute)
		if rec.count("attendees", 2027) != 1 || rec.count("attendees", 2026) != 0 {
			t.Errorf("a 2027 Run Phase must run the primary once, got %v", rec.Runs())
		}
	})
}

// TestQueuedRunPhaseForThePriorSeasonRunsThatSeason: the same press while another job runs is
// queued, and the dequeued phase must still run 2026's own instances.
func TestQueuedRunPhaseForThePriorSeasonRunsThatSeason(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	withNow(t, afterRollover)
	client := newTestCampMinderClient(t, 2027)

	runInBubble(t, func(t *testing.T) {
		o, rec := newRecordingOrchestrator(t, nil, client, "attendees", "bunks")
		scheduler := &Scheduler{orchestrator: o}
		if err := o.MarkSyncRunning("bunks"); err != nil {
			t.Fatal(err)
		}
		resp := callHandler(t, nil, "/?year=2026&phase=source", func(e *core.RequestEvent) error {
			return handleRunPhase(e, scheduler)
		})
		if resp.Code != http.StatusAccepted {
			t.Fatalf("expected the busy orchestrator to queue the phase, got %d: %s", resp.Code, resp.Body.String())
		}
		o.FinalizeSyncStatus("bunks", Stats{}, nil)

		processQueuedSyncs(o)

		if !rec.Ran("attendees", 2026) || rec.count("attendees", 2027) != 0 {
			t.Errorf("the dequeued 2026 phase must run 2026's attendees, got %v", rec.Runs())
		}
	})
}
