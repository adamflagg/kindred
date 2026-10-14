package sync

import (
	"context"
	"errors"
	"slices"
	"sync/atomic"
	"testing"
	"testing/synctest"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// The tests in this file pin what Manage > Sync shows once the scheduled runs cover two seasons
// (spec §5): each season keeps its own last run, the primary's cards do not flip back to
// pending while the prior season's pass runs, a manual run of the prior synced season is a
// season run rather than a historical replay, and a waiter always sees its own run finish.

// TestTwoSeasonDailyRunKeepsEachSeasonsLastRunApart: the nightly run syncs 2027 and then
// 2026. The primary's card must still show the 2027 run afterwards, and 2026's run must be
// readable on its own.
func TestTwoSeasonDailyRunKeepsEachSeasonsLastRunApart(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	withNow(t, time.Date(2026, time.October, 20, 10, 0, 0, 0, time.UTC)) // primary 2027
	client := newTestCampMinderClient(t, 2027)

	runInBubble(t, func(t *testing.T) {
		o, rec := newRecordingOrchestrator(t, nil, client)
		rec.FailFor("attendees", 2026) // so the two seasons' results differ
		if err := o.RunDailySync(context.Background()); err != nil {
			t.Fatal(err)
		}

		primary := o.GetStatusForSeason("attendees", 2027, 2027)
		if primary == nil || primary.Status != statusSuccess || primary.Year != 0 || primary.Trigger != triggerDaily {
			t.Errorf("the primary's attendees card must show the 2027 daily run, got %+v", primary)
		}
		prior := o.GetStatusForSeason("attendees", 2026, 2027)
		if prior == nil || prior.Status != statusFailed || prior.Year != 2026 {
			t.Errorf("2026's attendees run must be readable on its own as a failure, got %+v", prior)
		}
	})
}

// TestPrimaryCardsStayFinishedDuringThePriorSeasonPass: while the nightly N-1 pass runs, a job
// the primary pass already finished must keep showing the primary's run, not flip back to
// "pending" because 2026's run of the same job is now the latest completion.
func TestPrimaryCardsStayFinishedDuringThePriorSeasonPass(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	withNow(t, time.Date(2026, time.October, 20, 10, 0, 0, 0, time.UTC)) // primary 2027
	client := newTestCampMinderClient(t, 2027)

	runInBubble(t, func(t *testing.T) {
		o, rec := newRecordingOrchestrator(t, nil, client)
		release := make(chan struct{})
		rec.blockDuring("attendees", 2026, release) // pause mid N-1 pass
		done := make(chan error, 1)
		go func() { done <- o.RunDailySync(context.Background()) }()
		rec.waitUntilBlocked(t)

		// A job both passes have finished by now: the first one the N-1 pass ran.
		runs := rec.Runs()
		first := slices.IndexFunc(runs, func(r seasonRun) bool { return r.Year == 2026 })
		if first < 0 || runs[first].ID == "attendees" {
			t.Fatalf("expected a finished 2026 run before attendees, got %+v", runs)
		}
		job := runs[first].ID

		if st := o.GetStatus(job); st == nil || st.Status != statusSuccess || st.Year != 0 {
			t.Errorf("%s finished in the primary pass and must not read as pending during the N-1 pass, got %+v",
				job, st)
		}
		if st := o.GetStatusForSeason(job, 2027, 2027); st == nil || st.Status != statusSuccess || st.Year != 0 {
			t.Errorf("the primary's %s card must show the primary pass's run during the N-1 pass, got %+v", job, st)
		}

		close(release)
		select {
		case <-done:
		case <-time.After(time.Hour):
			t.Fatal("the daily run never finished")
		}
	})
}

// TestManualRunOfThePriorSyncedSeasonIsNotHistorical: a Run Sync (all) for 2026 while 2027 is
// the primary is a run of a season the scheduled runs sync, so it is not called a historical
// replay. A season outside the synced pair still is.
func TestManualRunOfThePriorSyncedSeasonIsNotHistorical(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	withNow(t, time.Date(2026, time.October, 20, 10, 0, 0, 0, time.UTC)) // primary 2027
	client := newTestCampMinderClient(t, 2027)

	t.Run("the prior synced season", func(t *testing.T) {
		runInBubble(t, func(t *testing.T) {
			o, rec := newRecordingOrchestrator(t, nil, client)
			release := make(chan struct{})
			rec.blockDuring("attendees", 2026, release)
			done := make(chan error, 1)
			go func() { done <- o.RunSyncWithOptions(context.Background(), Options{Year: 2026}) }()
			rec.waitUntilBlocked(t)

			if o.IsHistoricalSyncRunning() {
				t.Error("a manual 2026 run must not report a historical sync running")
			}
			if !o.IsDailySyncRunning() {
				t.Error("a manual 2026 run must report a season run in progress, so the client keeps polling")
			}
			if runType, _, _, _ := o.GetCurrentRunProgress(); runType != runTypeDaily {
				t.Errorf("progress run type = %q, want %q", runType, runTypeDaily)
			}
			if st := o.GetStatus("attendees"); st == nil || st.Trigger != triggerManual || st.Year != 2026 {
				t.Errorf("the manual 2026 run must be filed as a manual run of 2026, got %+v", st)
			}

			close(release)
			if err := <-done; err != nil {
				t.Fatalf("RunSyncWithOptions: %v", err)
			}
		})
	})

	t.Run("a season outside the synced pair", func(t *testing.T) {
		runInBubble(t, func(t *testing.T) {
			o, rec := newRecordingOrchestrator(t, nil, client)
			release := make(chan struct{})
			rec.blockDuring("attendees", 2019, release)
			done := make(chan error, 1)
			go func() { done <- o.RunSyncWithOptions(context.Background(), Options{Year: 2019}) }()
			rec.waitUntilBlocked(t)

			if !o.IsHistoricalSyncRunning() || o.GetHistoricalSyncYear() != 2019 {
				t.Errorf("a 2019 replay must report a historical sync of 2019, got running=%v year=%d",
					o.IsHistoricalSyncRunning(), o.GetHistoricalSyncYear())
			}
			if runType, _, _, _ := o.GetCurrentRunProgress(); runType != runTypeHistorical {
				t.Errorf("progress run type = %q, want %q", runType, runTypeHistorical)
			}
			if st := o.GetStatus("attendees"); st == nil || st.Trigger != triggerHistorical || st.Year != 2019 {
				t.Errorf("the 2019 replay must be filed as historical, got %+v", st)
			}

			close(release)
			if err := <-done; err != nil {
				t.Fatalf("RunSyncWithOptions: %v", err)
			}
		})
	})
}

// gatedOnceService blocks its first run until release is closed; every later run returns at
// once.
type gatedOnceService struct {
	release chan struct{}
	calls   atomic.Int32
}

func (g *gatedOnceService) Sync(ctx context.Context) error {
	if g.calls.Add(1) == 1 {
		select {
		case <-g.release:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return nil
}
func (g *gatedOnceService) GetStats() Stats { return Stats{Updated: 1} }

// TestWaiterSeesItsOwnRunWhenAnotherRunFinishesInThePollGap: the waiter polls every 500ms. If
// its run finishes and another run of the same job starts and finishes before the next poll,
// the waiter must still see its own run's completion. It used to read only the job's single
// last completion, find the other run's token there, and wait forever, so the nightly run
// that started it never ended.
func TestWaiterSeesItsOwnRunWhenAnotherRunFinishesInThePollGap(t *testing.T) {
	t.Parallel()
	synctest.Test(t, func(t *testing.T) {
		o := NewOrchestrator(nil)
		svc := &gatedOnceService{release: make(chan struct{})}
		o.RegisterService("test", svc)

		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		errCh := make(chan error, 1)
		go func() { errCh <- o.runSyncAndWait(ctx, "test", newBatch(triggerManual)) }()
		synctest.Wait() // the waiter's run is blocked in Sync; the waiter sleeps on its ticker

		close(svc.release)
		synctest.Wait() // its run finishes and publishes; no fake time has passed, so no poll yet

		if err := o.RunSingleSync(context.Background(), "test"); err != nil {
			t.Fatalf("second run: %v", err)
		}
		synctest.Wait() // the second run finishes too, still inside the same poll gap

		if err := <-errCh; err != nil {
			if errors.Is(err, context.DeadlineExceeded) {
				t.Fatal("the waiter never saw its own run finish")
			}
			t.Fatalf("waiter: %v", err)
		}
	})
}

// TestStatusYearParam pins which seasons the sync-status endpoint answers for: none named is the
// any-season payload every surface has always read; a named year must be one of the two synced
// seasons.
func TestStatusYearParam(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		raw      string
		want     int
		wantOK   bool
		describe string
	}{
		{"", 0, true, "no year: the any-season payload"},
		{"2027", 2027, true, "the primary"},
		{"2026", 2026, true, "the prior synced season"},
		{"2025", 0, false, "a season outside the synced pair"},
		{"2028", 0, false, "a season after the primary"},
		{"abc", 0, false, "not a number"},
	} {
		got, err := statusYearParam(tc.raw, 2027)
		if (err == nil) != tc.wantOK || got != tc.want {
			t.Errorf("%s: statusYearParam(%q) = %d, %v; want %d, ok=%v", tc.describe, tc.raw, got, err, tc.want, tc.wantOK)
		}
	}
}

// TestServiceStatusesForTheViewedSeason: the payload for a named season carries that season's
// own last run for each job, never the other season's.
func TestServiceStatusesForTheViewedSeason(t *testing.T) {
	t.Parallel()
	o := NewOrchestrator(nil)
	end := time.Now()
	primaryRun := &Status{Type: "attendees", Status: statusSuccess, Year: 0, EndTime: &end, Summary: Stats{Updated: 27}}
	priorRun := &Status{Type: "attendees", Status: statusFailed, Year: 2026, EndTime: &end, Summary: Stats{Updated: 26}}
	o.mu.Lock()
	o.publishCompletedLocked(primaryRun)
	o.publishCompletedLocked(priorRun) // the nightly order: the primary, then N-1
	o.mu.Unlock()

	for _, tc := range []struct {
		year    int
		updated int
	}{{2027, 27}, {2026, 26}} {
		got, ok := resolveServiceStatusesForSeason(o, []string{"attendees"}, tc.year, 2027)["attendees"].(*Status)
		if !ok || got.Summary.Updated != tc.updated {
			t.Errorf("season %d: attendees = %+v, want that season's run (updated %d)", tc.year, got, tc.updated)
		}
	}
	if got := resolveServiceStatuses(o, []string{"attendees"})["attendees"].(*Status); got.Summary.Updated != 26 {
		t.Errorf("no year: attendees = %+v, want the latest run of any season, as before", got)
	}
}

// TestLastRecordedRunsForASeasonReadsOnlyThatSeason: after a restart the per-season payload
// falls back to sync_runs, and must read that season's rows only.
func TestLastRecordedRunsForASeasonReadsOnlyThatSeason(t *testing.T) {
	t.Parallel()
	app := newSyncRunsApp(t)
	col, err := app.FindCollectionByNameOrId(syncRunsCollection)
	if err != nil {
		t.Fatalf("find collection: %v", err)
	}
	older := time.Now().Add(-3 * time.Hour) // the primary's run
	newer := time.Now().Add(-1 * time.Hour) // then N-1's
	for _, row := range []struct {
		year int
		at   time.Time
	}{{2027, older}, {2026, newer}} {
		rec := core.NewRecord(col)
		rec.Set("service", "attendees")
		rec.Set("year", row.year)
		rec.Set("status", statusSuccess)
		rec.Set("trigger", triggerDaily)
		rec.Set("batch_id", "b")
		rec.Set("started", row.at)
		rec.Set("ended", row.at)
		if err := app.Save(rec); err != nil {
			t.Fatalf("save %d row: %v", row.year, err)
		}
	}
	o := NewOrchestrator(app)
	for _, year := range []int{2027, 2026} {
		got := o.LastRecordedRunsForSeason(year)["attendees"]
		if got == nil || got.Year != year {
			t.Errorf("season %d: got %+v, want that season's row", year, got)
		}
	}
	if got := o.LastRecordedRuns()["attendees"]; got == nil || got.Year != 2026 {
		t.Errorf("no season: got %+v, want the newest row of any season, as before", got)
	}
}

// TestAwaitedRunsHoldOnlyRunsInFlight bounds awaitedRuns: a waiter's entry goes when it has
// read its run's completion and when it gives up, and a run nobody waits on never adds one.
func TestAwaitedRunsHoldOnlyRunsInFlight(t *testing.T) {
	t.Parallel()
	synctest.Test(t, func(t *testing.T) {
		o := NewOrchestrator(nil)
		svc := &gatedOnceService{release: make(chan struct{})}
		o.RegisterService("test", svc)
		size := func() int {
			o.mu.RLock()
			defer o.mu.RUnlock()
			return len(o.awaitedRuns)
		}

		// A waiter that gives up while its run is still going.
		ctx, cancel := context.WithCancel(context.Background())
		errCh := make(chan error, 1)
		go func() { errCh <- o.runSyncAndWait(ctx, "test", newBatch(triggerManual)) }()
		synctest.Wait()
		if got := size(); got != 1 {
			t.Fatalf("a waiter in flight holds one entry, got %d", got)
		}
		cancel()
		if err := <-errCh; !errors.Is(err, context.Canceled) {
			t.Fatalf("waiter: %v", err)
		}
		close(svc.release) // its run finishes after the waiter left
		synctest.Wait()
		if got := size(); got != 0 {
			t.Errorf("a waiter that gave up must leave nothing behind, got %d entries", got)
		}

		// A waiter that sees its run finish, and a run nobody waits on.
		if err := o.runSyncAndWait(context.Background(), "test", newBatch(triggerManual)); err != nil {
			t.Fatalf("waiter: %v", err)
		}
		if err := o.RunSingleSync(context.Background(), "test"); err != nil {
			t.Fatalf("unawaited run: %v", err)
		}
		synctest.Wait()
		if got := size(); got != 0 {
			t.Errorf("finished runs must leave nothing behind, got %d entries", got)
		}
	})
}
