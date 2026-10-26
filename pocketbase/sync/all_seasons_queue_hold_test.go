package sync

import (
	"context"
	"slices"
	"testing"
	"testing/synctest"
)

// The tests in this file pin the all-seasons re-sync's hold on the sync queues (PM-7 = A, the
// CodeRabbit Major on #3240). The pass used to wait for quiet and then start, with nothing to
// stop another queue starting in a gap between its jobs: a staff run that landed there collided
// on a job id, one side was refused with "sync already in progress", and the season finished
// half-refreshed. Now the pass takes the hold under the same lock as its quiet check, and every
// queue that claims a running flag waits while the hold is taken.

// allSeasonsPassRuns is every run the pass makes for the primary 2027: 2025 back to 2017, each
// season's four jobs in order.
func allSeasonsPassRuns() []seasonRun {
	var want []seasonRun
	for year := 2025; year >= 2017; year-- {
		for _, id := range allSeasonsResyncJobs {
			want = append(want, seasonRun{ID: id, Year: year})
		}
	}
	return want
}

// TestAllSeasonsResyncHoldsTheQueuesUntilItEnds: a queue started while the pass is running does
// not start a single job until the pass has finished, and the pass loses none of its own runs to
// a refusal. Each starter is one that claims a queue flag: a staff full run of the primary, a
// staff run of N-1, the nightly, the weekly globals and the custom-values queue.
func TestAllSeasonsResyncHoldsTheQueuesUntilItEnds(t *testing.T) {
	starters := map[string]func(ctx context.Context, o *Orchestrator) error{
		"staff full run": func(ctx context.Context, o *Orchestrator) error {
			return o.RunSyncWithOptions(ctx, Options{Services: []string{"session_groups", "sessions", "persons"}})
		},
		"staff run of N-1": func(ctx context.Context, o *Orchestrator) error {
			return o.RunSyncWithOptions(ctx, Options{Year: 2026, Services: []string{"session_groups", "sessions"}})
		},
		"nightly":        func(ctx context.Context, o *Orchestrator) error { return o.RunDailySync(ctx) },
		"weekly globals": func(ctx context.Context, o *Orchestrator) error { return o.RunWeeklySync(ctx) },
		"custom values":  func(ctx context.Context, o *Orchestrator) error { return o.RunCustomValuesSync(ctx) },
	}
	for name, start := range starters {
		t.Run(name, func(t *testing.T) {
			runInBubble(t, func(t *testing.T) {
				o, rec, _ := newAllSeasonsOrchestrator(t)
				release := make(chan struct{})
				rec.blockDuring("session_groups", 2025, release)

				passDone := make(chan error, 1)
				go func() { passDone <- o.RunAllSeasonsResync(context.Background()) }()
				rec.waitUntilBlocked(t)

				otherDone := make(chan error, 1)
				go func() { otherDone <- start(context.Background(), o) }()
				synctest.Wait()

				if got, want := rec.Runs(), []seasonRun{{ID: "session_groups", Year: 2025}}; !slices.Equal(got, want) {
					t.Errorf("while the pass held the queues, ran %v; want only the pass's own %v", got, want)
				}

				close(release)
				if err := <-passDone; err != nil {
					t.Fatalf("pass: %v", err)
				}
				<-otherDone // its own outcome is not under test; it must only have waited

				want := allSeasonsPassRuns()
				runs := rec.Runs()
				if len(runs) < len(want) || !slices.Equal(runs[:len(want)], want) {
					t.Fatalf("the pass's runs were interleaved or refused:\ngot  %v\nwant %v first", runs, want)
				}
				if len(runs) == len(want) {
					t.Errorf("%s never ran after the pass released the queues", name)
				}
			})
		})
	}
}

// TestAllSeasonsHoldCountsAsBusyForTheAPI: the API's admission check queues a staff press while
// the pass holds the queues, gaps between its jobs included, rather than starting one under it.
// It is released when the pass ends.
func TestAllSeasonsHoldCountsAsBusyForTheAPI(t *testing.T) {
	runInBubble(t, func(t *testing.T) {
		o, _, _ := newAllSeasonsOrchestrator(t)
		if o.IsAnyQueueBusy() {
			t.Fatal("an idle orchestrator reads as busy")
		}

		release, err := o.holdQueuesForAllSeasons(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		if o.IsAnyJobRunning() {
			t.Fatal("no job should be running: this is the gap between two of the pass's jobs")
		}
		if !o.IsAnyQueueBusy() {
			t.Error("the pass holds the queues, but the API's admission check reads idle")
		}

		release()
		if o.IsAnyQueueBusy() {
			t.Error("the hold was released, but the API's admission check still reads busy")
		}
	})
}

// TestAllSeasonsHoldWaitsForAQueueThatClaimedFirst: the hold is taken only when no queue is
// running, so a staff run that claimed its flag first is never run under.
func TestAllSeasonsHoldWaitsForAQueueThatClaimedFirst(t *testing.T) {
	runInBubble(t, func(t *testing.T) {
		o, _, _ := newAllSeasonsOrchestrator(t)
		o.mu.Lock()
		o.historicalSyncRunning = true
		o.mu.Unlock()

		held := make(chan func(), 1)
		go func() {
			release, err := o.holdQueuesForAllSeasons(context.Background())
			if err != nil {
				t.Error(err)
				close(held)
				return
			}
			held <- release
		}()
		synctest.Wait()
		select {
		case <-held:
			t.Fatal("the hold was taken while a staff run of another season was running")
		default:
		}

		o.mu.Lock()
		o.historicalSyncRunning = false
		o.mu.Unlock()
		release := <-held
		if release == nil {
			t.Fatal("no hold")
		}
		release()
	})
}

// TestPhaseRunAndAllSeasonsHoldExcludeEachOther: a phase run (Run Phase, or one dequeued) starts
// its jobs one at a time with no job running in between, so it holds a queue slot of its own for
// its whole length. The pass waits for that slot, and a phase run waits for the pass's hold
// (CodeRabbit on #3303).
func TestPhaseRunAndAllSeasonsHoldExcludeEachOther(t *testing.T) {
	runInBubble(t, func(t *testing.T) {
		o, _, _ := newAllSeasonsOrchestrator(t)

		// A phase run first: the API reads busy between its jobs, and the pass waits.
		releasePhase, err := o.claimPhaseRun(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		if !o.IsAnyQueueBusy() {
			t.Error("a phase run is in flight, but the API's admission check reads idle")
		}
		held := make(chan func(), 1)
		go func() {
			release, holdErr := o.holdQueuesForAllSeasons(context.Background())
			if holdErr != nil {
				t.Error(holdErr)
			}
			held <- release
		}()
		synctest.Wait()
		select {
		case <-held:
			t.Fatal("the pass took the hold while a phase run was between two jobs")
		default:
		}
		releasePhase()
		releaseHold := <-held

		// Then the pass holds: a phase run waits for it to let go.
		claimed := make(chan func(), 1)
		go func() {
			release, claimErr := o.claimPhaseRun(context.Background())
			if claimErr != nil {
				t.Error(claimErr)
			}
			claimed <- release
		}()
		synctest.Wait()
		select {
		case <-claimed:
			t.Fatal("a phase run started while the pass held the queues")
		default:
		}
		releaseHold()
		(<-claimed)()
		if o.IsAnyQueueBusy() {
			t.Error("everything was released, but the API still reads busy")
		}
	})
}

// TestIndividualRunAdmissionAndAllSeasonsHoldExcludeEachOther: a job a staff member runs on its
// own is admitted in the same critical section as the busy check, so the pass cannot take its
// hold between the API's check and the job starting. While the job is admitted the pass waits;
// while the pass holds, the job is refused admission and the API queues it (CodeRabbit on #3303).
func TestIndividualRunAdmissionAndAllSeasonsHoldExcludeEachOther(t *testing.T) {
	runInBubble(t, func(t *testing.T) {
		o, _, _ := newAllSeasonsOrchestrator(t)

		releaseRun, admitted := o.admitIndividualRun()
		if !admitted {
			t.Fatal("an idle orchestrator refused an individual run")
		}
		if again, ok := o.admitIndividualRun(); ok {
			again()
			t.Error("a second individual run was admitted while the first had not started its job")
		}
		held := make(chan func(), 1)
		go func() {
			release, holdErr := o.holdQueuesForAllSeasons(context.Background())
			if holdErr != nil {
				t.Error(holdErr)
			}
			held <- release
		}()
		synctest.Wait()
		select {
		case <-held:
			t.Fatal("the pass took the hold between an individual run's admission and its job")
		default:
		}
		releaseRun()
		releaseRun() // idempotent: a deferred release after an explicit one is a no-op
		releaseHold := <-held

		if release, ok := o.admitIndividualRun(); ok {
			release()
			t.Error("an individual run was admitted while the pass held the queues")
		}
		releaseHold()
		release, ok := o.admitIndividualRun()
		if !ok {
			t.Fatal("the hold was released, but an individual run is still refused")
		}
		release()
		if o.IsAnyQueueBusy() {
			t.Error("everything was released, but the API still reads busy")
		}
	})
}

// TestQueuedIndividualRunWaitsForTheAllSeasonsHold: a staff press queued while something ran is
// drained by processQueuedSyncs, and when the pass holds the queues by then the job waits for
// the hold to be let go instead of starting under the pass.
func TestQueuedIndividualRunWaitsForTheAllSeasonsHold(t *testing.T) {
	runInBubble(t, func(t *testing.T) {
		o, rec, _ := newAllSeasonsOrchestrator(t)
		releaseHold, err := o.holdQueuesForAllSeasons(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		if _, err := o.EnqueueIndividualSync(2027, "sessions", nil, false, "staff@example.com"); err != nil {
			t.Fatal(err)
		}

		drained := make(chan struct{})
		go func() {
			processQueuedSyncs(o)
			close(drained)
		}()
		synctest.Wait()
		if runs := rec.Runs(); len(runs) != 0 {
			t.Errorf("while the pass held the queues, the queued individual run ran %v", runs)
		}

		releaseHold()
		<-drained
		if runs, want := rec.Runs(), []seasonRun{{ID: "sessions", Year: 2027}}; !slices.Equal(runs, want) {
			t.Errorf("after the hold was let go, ran %v; want %v", runs, want)
		}
	})
}
