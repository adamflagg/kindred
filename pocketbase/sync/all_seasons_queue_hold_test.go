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
