package sync

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"testing"
	"testing/synctest"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// The tests in this file pin epic #3207 PR 5 (decision 1): enrollments, people and sessions sync
// every hour for both synced seasons, beside the bunk assignments that already did. The 3 a.m.
// nightly stays each day's stored enrollment snapshot, so the hourly run never writes one. The
// hourly run yields to every queue that runs the same jobs (the nightly, a staff full run or
// replay, the Saturday all-seasons re-sync) and keeps out of the nightly's window.

// hourlyJobs is the hourly queue, in run order: sessions before attendees (an attendee row
// relates to its session), attendees before persons (persons gathers its people from attendees),
// and bunk_assignments last (it resolves persons and sessions).
var hourlyJobs = []string{"sessions", "attendees", "persons", "bunk_assignments"}

func TestHourlyQueueIsEnrollmentsPeopleSessionsAndAssignments(t *testing.T) {
	t.Parallel()
	if got := cadenceQueue(CadenceHourly); !slices.Equal(got, hourlyJobs) {
		t.Errorf("hourly queue = %v, want %v", got, hourlyJobs)
	}
	// None of the four is PrimaryOnly or global, so the N-1 pass runs all of them.
	if got := secondarySeasonQueue(CadenceHourly); !slices.Equal(got, hourlyJobs) {
		t.Errorf("hourly N-1 queue = %v, want %v", got, hourlyJobs)
	}
	daily := jobsWithCadence(CadenceDaily)
	for _, id := range hourlyJobs {
		if !slices.Contains(daily, id) {
			t.Errorf("%s must stay on the nightly as well as the hourly", id)
		}
		if GetPhaseForJob(id) != PhaseSource {
			t.Errorf("%s is not a source job: the hourly run fetches from CampMinder and derives nothing", id)
		}
	}
}

// TestHourlyNeverWritesAnEnrollmentSnapshot is decision 1's "the 3 a.m. run stays each day's
// stored snapshot point". enrollment_snapshots upserts one row per session per UTC day, so a
// mid-day run would overwrite the 3 a.m. point with a mid-day count. The hourly queue leaves it
// out; "now" is the live attendees rows the hourly run keeps fresh.
func TestHourlyNeverWritesAnEnrollmentSnapshot(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	withNow(t, afterRollover)
	client := newTestCampMinderClient(t, 2027)

	if slices.Contains(cadenceQueue(CadenceHourly), "enrollment_snapshots") {
		t.Fatal("enrollment_snapshots is on the hourly cadence")
	}
	runInBubble(t, func(t *testing.T) {
		o, rec := newRecordingOrchestrator(t, nil, client)
		if err := o.RunHourlySync(context.Background()); err != nil {
			t.Fatal(err)
		}
		for _, run := range rec.Runs() {
			if run.ID == "enrollment_snapshots" {
				t.Errorf("the hourly run wrote an enrollment snapshot for %d", run.Year)
			}
		}
	})
}

// TestHourlySyncRunsTheQueueForBothSeasons: the primary's four jobs in order, then N-1's.
func TestHourlySyncRunsTheQueueForBothSeasons(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	withNow(t, afterRollover)
	client := newTestCampMinderClient(t, 2027)

	runInBubble(t, func(t *testing.T) {
		o, rec := newRecordingOrchestrator(t, nil, client)
		if err := o.RunHourlySync(context.Background()); err != nil {
			t.Fatal(err)
		}
		want := make([]seasonRun, 0, 2*len(hourlyJobs))
		for _, year := range []int{2027, 2026} {
			for _, id := range hourlyJobs {
				want = append(want, seasonRun{ID: id, Year: year})
			}
		}
		if got := rec.Runs(); !slices.Equal(got, want) {
			t.Errorf("ran %v,\nwant %v", got, want)
		}
		for _, id := range hourlyJobs {
			if st := o.GetStatus(id); st == nil || st.Trigger != triggerHourly {
				t.Errorf("%s must be filed as an hourly run, got %+v", id, st)
			}
		}
	})
}

// TestHourlySyncKeepsGoingAfterAFailedJob: one job failing does not cost the rest of the hour,
// as on the nightly. The failure is still returned.
func TestHourlySyncKeepsGoingAfterAFailedJob(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	withNow(t, afterRollover)
	client := newTestCampMinderClient(t, 2027)

	runInBubble(t, func(t *testing.T) {
		o, rec := newRecordingOrchestrator(t, nil, client)
		rec.FailFor("sessions", 2027)
		if err := o.RunHourlySync(context.Background()); err == nil {
			t.Error("the failed sessions run must be reported")
		}
		for _, id := range hourlyJobs[1:] {
			if !rec.Ran(id, 2027) {
				t.Errorf("%s did not run for 2027 after sessions failed: %v", id, rec.Runs())
			}
		}
		if !rec.Ran("persons", 2026) {
			t.Errorf("the N-1 pass did not run after the primary's failure: %v", rec.Runs())
		}
	})
}

// TestHourlySyncYieldsToARunningQueue: while a queue that runs the same jobs is in flight, the
// hourly run starts nothing. The queue already syncs those jobs, and a collision on a job id
// would refuse one side with "sync already in progress".
func TestHourlySyncYieldsToARunningQueue(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	withNow(t, afterRollover)
	client := newTestCampMinderClient(t, 2027)

	cases := map[string]func(o *Orchestrator) (start func() error, blockAt seasonRun){
		"the nightly": func(o *Orchestrator) (func() error, seasonRun) {
			return func() error { return o.RunDailySync(context.Background()) }, seasonRun{"bunks", 2027}
		},
		"a staff run of the primary": func(o *Orchestrator) (func() error, seasonRun) {
			return func() error { return o.RunSyncWithOptions(context.Background(), Options{}) },
				seasonRun{"bunks", 2027}
		},
		"a staff run of N-1": func(o *Orchestrator) (func() error, seasonRun) {
			return func() error { return o.RunSyncWithOptions(context.Background(), Options{Year: 2026}) },
				seasonRun{"bunks", 2026}
		},
		"a historical replay": func(o *Orchestrator) (func() error, seasonRun) {
			return func() error { return o.RunSyncWithOptions(context.Background(), Options{Year: 2019}) },
				seasonRun{"bunks", 2019}
		},
		"the all-seasons re-sync": func(o *Orchestrator) (func() error, seasonRun) {
			return func() error { return o.RunAllSeasonsResync(context.Background()) },
				seasonRun{"attendees", 2024}
		},
	}
	for name, setup := range cases {
		t.Run(name, func(t *testing.T) {
			runInBubble(t, func(t *testing.T) {
				o, rec := newRecordingOrchestrator(t, nil, client)
				start, blockAt := setup(o)
				release := make(chan struct{})
				rec.blockDuring(blockAt.ID, blockAt.Year, release)
				done := make(chan error, 1)
				go func() { done <- start() }()
				rec.waitUntilBlocked(t)

				before := len(rec.Runs())
				if err := o.RunHourlySync(context.Background()); !errors.Is(err, errHourlySyncYielded) {
					t.Errorf("RunHourlySync = %v, want it to yield (errHourlySyncYielded)", err)
				}
				if got := rec.Runs()[before:]; len(got) != 0 {
					t.Errorf("the hourly run started %v while %s was running", got, name)
				}

				close(release)
				<-done
				if err := o.RunHourlySync(context.Background()); err != nil {
					t.Errorf("the hourly run after %s ended: %v", name, err)
				}
			})
		})
	}
}

// TestHourlySyncSkipsItsPriorSeasonPassWhenAQueueStarts: a queue that starts while the primary
// pass is running (the all-seasons re-sync, waiting its turn) is not made to wait for N-1 too.
func TestHourlySyncSkipsItsPriorSeasonPassWhenAQueueStarts(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	withNow(t, afterRollover)
	client := newTestCampMinderClient(t, 2027)

	runInBubble(t, func(t *testing.T) {
		o, rec := newRecordingOrchestrator(t, nil, client)
		release := make(chan struct{})
		rec.blockDuring("persons", 2027, release)
		done := make(chan error, 1)
		go func() { done <- o.RunHourlySync(context.Background()) }()
		rec.waitUntilBlocked(t)

		resync := make(chan error, 1)
		go func() { resync <- o.RunAllSeasonsResync(context.Background()) }()
		time.Sleep(time.Minute)
		synctest.Wait()
		for _, run := range rec.Runs() {
			if run.Year < 2026 {
				t.Fatalf("the re-sync started %v while the hourly run was running", run)
			}
		}

		close(release)
		if err := <-done; err != nil {
			t.Fatalf("RunHourlySync: %v", err)
		}
		if err := <-resync; err != nil {
			t.Fatalf("RunAllSeasonsResync: %v", err)
		}
		for _, id := range hourlyJobs {
			if rec.Ran(id, 2026) {
				t.Errorf("the hourly N-1 pass ran %s after the re-sync had started", id)
			}
		}
		if !rec.Ran("persons", 2017) {
			t.Error("the re-sync never ran after the hourly run ended")
		}
	})
}

// TestHourlySyncRefusesASecondRun: an hour that overruns into the next leaves the next to yield.
func TestHourlySyncRefusesASecondRun(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	withNow(t, afterRollover)
	client := newTestCampMinderClient(t, 2027)

	runInBubble(t, func(t *testing.T) {
		o, rec := newRecordingOrchestrator(t, nil, client)
		release := make(chan struct{})
		rec.blockDuring("attendees", 2027, release)
		done := make(chan error, 1)
		go func() { done <- o.RunHourlySync(context.Background()) }()
		rec.waitUntilBlocked(t)

		if !o.IsHourlySyncRunning() {
			t.Error("IsHourlySyncRunning = false while the hourly run is running")
		}
		if err := o.RunHourlySync(context.Background()); !errors.Is(err, errHourlySyncYielded) {
			t.Errorf("a second hourly run = %v, want errHourlySyncYielded", err)
		}
		close(release)
		if err := <-done; err != nil {
			t.Fatal(err)
		}
		if o.IsHourlySyncRunning() {
			t.Error("IsHourlySyncRunning = true after the hourly run ended")
		}
	})
}

// TestNightlyWindow: the hourly cron fires on the hour, so 03:00 and 04:00 are the ticks the
// window removes. 03:00 races the nightly's own start (two cron goroutines, no order between
// them), and 04:00 falls in its N-1 pass. Times are the container's zone, as the cron's are.
func TestNightlyWindow(t *testing.T) {
	t.Parallel()
	at := func(h, m int) time.Time { return time.Date(2026, time.October, 20, h, m, 0, 0, time.Local) }
	cases := []struct {
		at   time.Time
		want bool
	}{
		{at(2, 0), false},
		{at(2, 54), false},
		{at(2, 55), true},
		{at(3, 0), true},
		{at(4, 0), true},
		{at(4, 29), true},
		{at(4, 30), false},
		{at(5, 0), false},
		{at(15, 0), false},
	}
	for _, c := range cases {
		if got := inNightlyWindow(c.at); got != c.want {
			t.Errorf("inNightlyWindow(%s) = %v, want %v", c.at.Format("15:04"), got, c.want)
		}
	}
}

// TestScheduledHourlySkipsTheNightlyWindow: the cron's 03:00 tick runs nothing.
func TestScheduledHourlySkipsTheNightlyWindow(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	client := newTestCampMinderClient(t, 2027)

	runInBubble(t, func(t *testing.T) {
		withNow(t, time.Date(2026, time.October, 20, 3, 0, 0, 0, time.Local))
		o, rec := newRecordingOrchestrator(t, nil, client)
		s := &Scheduler{orchestrator: o}
		s.runHourlySync()
		if runs := rec.Runs(); len(runs) != 0 {
			t.Errorf("the 03:00 hourly tick ran %v", runs)
		}

		nowFn = func() time.Time { return time.Date(2026, time.October, 20, 11, 0, 0, 0, time.Local) }
		s.runHourlySync()
		if !rec.Ran("persons", 2027) || !rec.Ran("persons", 2026) {
			t.Errorf("the 11:00 hourly tick must run both seasons: %v", rec.Runs())
		}
	})
}

// TestScheduledHourlyRunsTheStaffQueueAfterwards: a staff press that arrived while the hourly run
// was running was queued (the admission checks below), so the hourly run starts it when it ends.
// Nothing else would: only an API-started run drains the queue.
func TestScheduledHourlyRunsTheStaffQueueAfterwards(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	client := newTestCampMinderClient(t, 2027)

	runInBubble(t, func(t *testing.T) {
		withNow(t, time.Date(2026, time.October, 20, 11, 0, 0, 0, time.Local))
		o, rec := newRecordingOrchestrator(t, nil, client)
		if _, err := o.EnqueueIndividualSync(2027, "bunks", nil, false, "staff@example.org"); err != nil {
			t.Fatal(err)
		}
		s := &Scheduler{orchestrator: o}
		s.runHourlySync()
		if !rec.Ran("bunks", 2027) {
			t.Errorf("the queued staff run never started: %v", rec.Runs())
		}
		if n := o.GetQueueLength(); n != 0 {
			t.Errorf("queue length = %d after the hourly run, want 0", n)
		}
	})
}

// TestEveryScheduledRunStartsTheStaffQueueAfterwards: a staff press during any scheduled queue is
// queued by the API's admission checks, and only an API-started run used to drain the queue, so
// a press during the nightly waited for the next staff run, however many hours away.
func TestEveryScheduledRunStartsTheStaffQueueAfterwards(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	client := newTestCampMinderClient(t, 2027)

	runs := map[string]func(s *Scheduler){
		"daily":         (*Scheduler).runDailySync,
		"weekly":        (*Scheduler).runWeeklySync,
		"custom values": (*Scheduler).runCustomValuesSync,
		"all seasons":   (*Scheduler).runAllSeasonsResync,
	}
	for name, run := range runs {
		t.Run(name, func(t *testing.T) {
			// The nightly prunes solver_runs through the scheduler's app first. Built outside the
			// bubble: its database goroutines would never let the bubble end.
			app, err := tests.NewTestApp()
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(app.Cleanup)
			runInBubble(t, func(t *testing.T) {
				withNow(t, time.Date(2026, time.October, 20, 11, 0, 0, 0, time.Local))
				o, rec := newRecordingOrchestrator(t, nil, client, "bunks", "person_custom_values",
					"household_custom_values", "person_tag_defs", "sessions")
				if _, err := o.EnqueueIndividualSync(2027, "bunks", nil, false, "staff@example.org"); err != nil {
					t.Fatal(err)
				}
				run(&Scheduler{app: app, orchestrator: o})
				want := 1 // the queued staff run
				if name == "daily" {
					want = 2 // and the nightly's own
				}
				if n := o.GetQueueLength(); n != 0 || rec.count("bunks", 2027) != want {
					t.Errorf("the staff run queued during the %s run never started (queue %d): %v", name, n, rec.Runs())
				}
			})
		})
	}
}

// TestStaffRunsQueueWhileTheHourlyRuns: between two of the hourly run's jobs nothing is running,
// so the job-level check alone would start a staff run into the hourly's next job id.
func TestStaffRunsQueueWhileTheHourlyRuns(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	withNow(t, afterRollover)
	client := newTestCampMinderClient(t, 2027)

	handlers := map[string]func(e *core.RequestEvent, s *Scheduler) error{
		"individual": func(e *core.RequestEvent, s *Scheduler) error { return handleIndividualSync(e, s, "bunks") },
		"unified":    handleUnifiedSync,
		"phase":      handleRunPhase,
	}
	targets := map[string]string{
		"individual": "/?year=2027",
		"unified":    "/?year=2027&service=bunks",
		"phase":      "/?year=2027&phase=source",
	}
	for name, handler := range handlers {
		t.Run(name, func(t *testing.T) {
			o, _ := newRecordingOrchestrator(t, nil, client)
			s := &Scheduler{orchestrator: o}
			o.mu.Lock()
			o.hourlySyncRunning = true // between two of its jobs: no job is running
			o.mu.Unlock()

			resp := callHandler(t, nil, targets[name], func(e *core.RequestEvent) error { return handler(e, s) })
			if resp.Code != http.StatusAccepted {
				t.Errorf("got %d, want 202 queued while the hourly run is running: %s", resp.Code, resp.Body.String())
			}
		})
	}
}
