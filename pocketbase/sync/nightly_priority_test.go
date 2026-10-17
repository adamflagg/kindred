package sync

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"testing/synctest"
	"time"
)

// The nightly outranks the hourly run: a 02:00 hourly run that 429 waits stretched past 03:00
// must finish before the nightly starts, or the two collide on a job id ("sync already in
// progress") and share one CampMinder rate-limit window. The weekly custom-values pass (Sunday
// 04:00) likewise waits for the nightly's N-1 pass.

func setHourlyRunning(o *Orchestrator, v bool) {
	o.mu.Lock()
	o.hourlySyncRunning = v
	o.mu.Unlock()
}

func TestRunDailySync_WaitsForInFlightHourlyRun(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	withNow(t, afterRollover)
	client := newTestCampMinderClient(t, 2027)

	runInBubble(t, func(t *testing.T) {
		o, rec := newRecordingOrchestrator(t, nil, client)
		setHourlyRunning(o, true)
		done := make(chan error, 1)
		go func() { done <- o.RunDailySync(context.Background()) }()

		time.Sleep(dailyWaitForHourlyPoll * 3)
		synctest.Wait()
		if len(rec.Runs()) != 0 || o.IsDailySyncRunning() {
			t.Fatalf("the nightly started beside an in-flight hourly run: %v", rec.Runs())
		}
		select {
		case err := <-done:
			t.Fatalf("the nightly returned while the hourly run was in flight: %v", err)
		default:
		}

		setHourlyRunning(o, false)
		if err := <-done; err != nil {
			t.Fatal(err)
		}
		if !rec.Ran("sessions", 2027) {
			t.Errorf("the nightly did not run once the hourly run ended: %v", rec.Runs())
		}
	})
}

func TestRunDailySync_HourlyWaitIsBoundedAndCtxAware(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	withNow(t, afterRollover)
	client := newTestCampMinderClient(t, 2027)

	t.Run("gives up after the bound and runs anyway", func(t *testing.T) {
		runInBubble(t, func(t *testing.T) {
			o, rec := newRecordingOrchestrator(t, nil, client)
			setHourlyRunning(o, true) // never clears
			done := make(chan error, 1)
			go func() { done <- o.RunDailySync(context.Background()) }()

			time.Sleep(dailyWaitForHourlyMax - dailyWaitForHourlyPoll)
			synctest.Wait()
			if len(rec.Runs()) != 0 {
				t.Fatal("the nightly gave up before the bound")
			}
			if err := <-done; err != nil {
				t.Fatal(err)
			}
			if !rec.Ran("sessions", 2027) {
				t.Errorf("the nightly never ran after the wait was bounded: %v", rec.Runs())
			}
		})
	})

	t.Run("a cancelled context ends the wait", func(t *testing.T) {
		runInBubble(t, func(t *testing.T) {
			o, rec := newRecordingOrchestrator(t, nil, client)
			setHourlyRunning(o, true)
			ctx, cancel := context.WithCancel(context.Background())
			done := make(chan error, 1)
			go func() { done <- o.RunDailySync(ctx) }()

			time.Sleep(dailyWaitForHourlyPoll * 2)
			cancel()
			if err := <-done; !errors.Is(err, context.Canceled) {
				t.Errorf("err = %v, want context.Canceled", err)
			}
			if len(rec.Runs()) != 0 {
				t.Errorf("a cancelled nightly ran jobs: %v", rec.Runs())
			}
		})
	})
}

func TestRunCustomValuesSync_WaitsWhileNightlyRuns(t *testing.T) {
	t.Parallel()
	synctest.Test(t, func(t *testing.T) {
		s := NewScheduler(nil)
		mock := &MockService{name: "person_custom_values"}
		s.orchestrator.RegisterService("person_custom_values", mock)
		s.orchestrator.mu.Lock()
		s.orchestrator.dailySyncRunning = true
		s.orchestrator.mu.Unlock()

		done := make(chan struct{})
		go func() { s.runCustomValuesSync(); close(done) }()

		time.Sleep(customValuesWaitForNightlyPoll * 3)
		synctest.Wait()
		if got := mock.callCount.Load(); got != 0 {
			t.Fatalf("custom values ran %d times beside the nightly", got)
		}

		s.orchestrator.mu.Lock()
		s.orchestrator.dailySyncRunning = false
		s.orchestrator.mu.Unlock()
		<-done
		if got := mock.callCount.Load(); got != 1 {
			t.Errorf("custom values ran %d times after the nightly ended, want 1", got)
		}
	})
}

// overlapService records how many custom-values jobs run at once.
type overlapService struct {
	delay             time.Duration
	active, maxActive *atomic.Int32
	calls             atomic.Int32
}

func (s *overlapService) Sync(ctx context.Context) error {
	s.calls.Add(1)
	n := s.active.Add(1)
	defer s.active.Add(-1)
	for {
		m := s.maxActive.Load()
		if n <= m || s.maxActive.CompareAndSwap(m, n) {
			break
		}
	}
	select {
	case <-time.After(s.delay):
	case <-ctx.Done():
		return ctx.Err()
	}
	return nil
}

func (s *overlapService) GetStats() Stats { return Stats{} }

// The wait for the nightly does not come out of the pass's own hour: a nightly that ends 44
// minutes in still leaves the custom-values jobs room to run one after another, as the
// sequential pass exists to (two at once double the CampMinder rate-limit pressure).
func TestRunCustomValuesSync_WaitDoesNotEatThePassBudget(t *testing.T) {
	t.Parallel()
	synctest.Test(t, func(t *testing.T) {
		s := NewScheduler(nil)
		var active, maxActive atomic.Int32
		jobs := GetCustomValuesSyncJobs()
		if len(jobs) < 2 {
			t.Fatalf("want at least two custom-values jobs to observe overlap, got %v", jobs)
		}
		svcs := make([]*overlapService, len(jobs))
		for i, job := range jobs {
			svcs[i] = &overlapService{delay: 20 * time.Minute, active: &active, maxActive: &maxActive}
			s.orchestrator.RegisterService(job, svcs[i])
		}
		s.orchestrator.mu.Lock()
		s.orchestrator.dailySyncRunning = true
		s.orchestrator.mu.Unlock()

		done := make(chan struct{})
		go func() { s.runCustomValuesSync(); close(done) }()

		time.Sleep(44 * time.Minute)
		synctest.Wait()
		s.orchestrator.mu.Lock()
		s.orchestrator.dailySyncRunning = false
		s.orchestrator.mu.Unlock()
		<-done
		// Let any job the pass stopped waiting on finish, so the counts below are final.
		time.Sleep(2 * time.Hour)
		synctest.Wait()

		if got := maxActive.Load(); got != 1 {
			t.Errorf("%d custom-values jobs ran at once after the wait, want 1 (sequential)", got)
		}
		for i, job := range jobs {
			if got := svcs[i].calls.Load(); got != 1 {
				t.Errorf("%s ran %d times, want 1", job, got)
			}
		}
	})
}
