package sync

import (
	"context"
	"fmt"
	"slices"
	"testing"
	"testing/synctest"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// The tests in this file pin the coordinator's ruling on epic #3207 PR 5: the orphan sweeps of
// sessions, attendees and persons run on the nightly only. A short but well-formed CampMinder
// feed passes every sweep guard, and the cascade behind a deleted attendees/persons/sessions row
// takes locked group members, original bunk requests and the season's placements with it, which
// are staff data. The Saturday all-seasons re-sync already switches sweeps off through
// setKeepOrphans; the hourly run uses the same mechanism.

// hourlySweepJobs are the hourly jobs whose sweeps cascade into staff data.
var hourlySweepJobs = []string{"sessions", "attendees", "persons"}

// shortFeedSweeper stands in for a sweeping job whose feed came back short: it processed one
// of its three rows and sweeps the rest, through the same BaseSyncService entry point the real
// jobs use.
type shortFeedSweeper struct {
	*BaseSyncService
	id string
	// gate, when non-nil, holds the run before its sweep until the test closes it.
	gate chan struct{}
	// keepCalls records every setKeepOrphans call, in order.
	keepCalls []bool
}

func (s *shortFeedSweeper) setKeepOrphans(keep bool) {
	s.keepCalls = append(s.keepCalls, keep)
	s.BaseSyncService.setKeepOrphans(keep)
}

func (s *shortFeedSweeper) Sync(context.Context) error {
	if s.gate != nil {
		<-s.gate
	}
	s.ProcessedKeys = map[string]bool{"w1": true}
	s.SyncSuccessful = true
	return s.DeleteOrphans("widgets",
		func(r *core.Record) (string, bool) { return r.GetString("name"), true },
		"widget", fmt.Sprintf("job = %q", s.id))
}
func (s *shortFeedSweeper) GetStats() Stats { return Stats{} }

func newSweepingOrchestrator(t *testing.T, app core.App) (o *Orchestrator, registered map[string]*shortFeedSweeper) {
	t.Helper()
	o, _ = newRecordingOrchestrator(t, nil, newTestCampMinderClient(t, 2027))
	registered = map[string]*shortFeedSweeper{}
	build := func() map[string]Service {
		out := map[string]Service{}
		for _, id := range hourlySweepJobs {
			out[id] = &shortFeedSweeper{BaseSyncService: &BaseSyncService{App: app}, id: id}
		}
		return out
	}
	for id, svc := range build() {
		o.RegisterService(id, svc)
		registered[id] = svc.(*shortFeedSweeper)
	}
	orig := o.yearServicesFn
	o.yearServicesFn = func(year int, dry bool) map[string]Service {
		m := orig(year, dry)
		for id, svc := range build() {
			m[id] = svc
		}
		return m
	}
	return o, registered
}

func seedSweepRows(t *testing.T, app core.App) {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("widgets")
	if err != nil {
		t.Fatal(err)
	}
	for _, job := range hourlySweepJobs {
		for i := 1; i <= 3; i++ {
			rec := core.NewRecord(col)
			rec.Set("name", fmt.Sprintf("w%d", i))
			rec.Set("job", job)
			rec.Set("year", 2027)
			if err := app.Save(rec); err != nil {
				t.Fatal(err)
			}
		}
	}
}

// TestHourlyRunSweepsNothing: a short feed on an hourly run deletes nothing for sessions,
// attendees or persons, in the primary season and in the prior one.
func TestHourlyRunSweepsNothing(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	withNow(t, afterRollover)
	app := newOrphanSweepTestApp(t, "widgets", "name", "job")
	seedSweepRows(t, app)

	runInBubble(t, func(t *testing.T) {
		o, registered := newSweepingOrchestrator(t, app)
		if err := o.RunHourlySync(context.Background()); err != nil {
			t.Fatal(err)
		}
		for _, job := range hourlySweepJobs {
			if n := countRows(t, app, "widgets", fmt.Sprintf("job = %q", job)); n != 3 {
				t.Errorf("hourly run swept %s: %d rows left, want 3", job, n)
			}
			if registered[job].keepOrphans {
				t.Errorf("%s: the registered instance still keeps orphans after the hourly run; a staff run would inherit it", job)
			}
		}
	})
}

// TestNightlyRunStillSweeps: the same short feed on a nightly pass deletes the rows it did not
// see, so the sweep is moved to the nightly, not removed.
func TestNightlyRunStillSweeps(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	withNow(t, afterRollover)
	app := newOrphanSweepTestApp(t, "widgets", "name", "job")
	seedSweepRows(t, app)

	runInBubble(t, func(t *testing.T) {
		o, _ := newSweepingOrchestrator(t, app)
		if err := o.runSeasonPass(context.Background(), 2027, hourlySweepJobs, triggerDaily, nil); err != nil {
			t.Fatal(err)
		}
		for _, job := range hourlySweepJobs {
			if n := countRows(t, app, "widgets", fmt.Sprintf("job = %q", job)); n != 1 {
				t.Errorf("nightly pass left %d %s rows, want 1 (only w1 was in the feed)", n, job)
			}
		}
	})
}

// TestHourlyKeepOrphansJobsAreKeepers: every job the hourly run switches sweeps off for really
// is an orphanKeeper in the production factory, or the switch would silently do nothing.
func TestHourlyKeepOrphansJobsAreKeepers(t *testing.T) {
	t.Parallel()
	for _, id := range hourlyKeepOrphanJobs {
		if !slices.Contains(cadenceQueue(CadenceHourly), id) {
			t.Errorf("%s is not an hourly job", id)
		}
	}
	if !slices.Equal(hourlyKeepOrphanJobs, hourlySweepJobs) {
		t.Errorf("hourlyKeepOrphanJobs = %v, want %v", hourlyKeepOrphanJobs, hourlySweepJobs)
	}
	svcs := NewOrchestrator(nil).yearServices(2027, false)
	for _, id := range hourlyKeepOrphanJobs {
		svc, ok := svcs[id]
		if !ok {
			t.Fatalf("no year-scoped %s service", id)
		}
		if _, ok := svc.(orphanKeeper); !ok {
			t.Errorf("%s does not implement orphanKeeper", id)
		}
	}
}

// TestHourlyRunKeepsOrphansWhenItStopsWaiting: the switch lives as long as the run, not as long
// as the hourly run waits for it. A run starts on its own context, so when the hourly run's
// context ends it stops waiting while the job goes on to its sweep, which must still keep the
// orphans.
func TestHourlyRunKeepsOrphansWhenItStopsWaiting(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	withNow(t, afterRollover)
	app := newOrphanSweepTestApp(t, "widgets", "name", "job")
	seedSweepRows(t, app)

	runInBubble(t, func(t *testing.T) {
		o, registered := newSweepingOrchestrator(t, app)
		gate := make(chan struct{})
		for _, svc := range registered {
			svc.gate = gate
		}
		ctx, cancel := context.WithCancel(context.Background())
		done := make(chan error, 1)
		go func() { done <- o.RunHourlySync(ctx) }()
		synctest.Wait() // sessions is running, held before its sweep
		cancel()
		<-done
		close(gate) // the runs the hourly run stopped waiting for reach their sweeps now
		synctest.Wait()

		for _, job := range hourlySweepJobs {
			if n := countRows(t, app, "widgets", fmt.Sprintf("job = %q", job)); n != 3 {
				t.Errorf("%s swept after the hourly run stopped waiting: %d rows left, want 3", job, n)
			}
			if registered[job].keepOrphans {
				t.Errorf("%s: the registered instance still keeps orphans after its run ended", job)
			}
		}
	})
}

// TestRefusedHourlyStartLeavesTheRunningInstanceAlone: when another run holds a job's slot, the
// hourly run's start is refused, and it must not touch the registered instance that run is
// executing: switching it on there would skip that run's sweep, and switching it off a
// switch it does not own.
func TestRefusedHourlyStartLeavesTheRunningInstanceAlone(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	withNow(t, afterRollover)
	app := newOrphanSweepTestApp(t, "widgets", "name", "job")
	seedSweepRows(t, app)

	runInBubble(t, func(t *testing.T) {
		o, registered := newSweepingOrchestrator(t, app)
		o.mu.Lock()
		o.runningJobs["attendees"] = &Status{Type: "attendees", Status: statusRunning, StartTime: time.Now()}
		o.mu.Unlock()

		_ = o.RunHourlySync(context.Background()) // attendees is refused: already in progress

		if calls := registered["attendees"].keepCalls; len(calls) != 0 {
			t.Errorf("refused hourly start switched the running attendees instance: %v, want no calls", calls)
		}
		if calls := registered["persons"].keepCalls; !slices.Equal(calls, []bool{true, false}) {
			t.Errorf("persons keepCalls = %v, want [true false]", calls)
		}
	})
}

// TestPersonsSweepKeepsOrphansWhenAsked: the real persons sweep (PersonsSync.deleteOrphans)
// honors the switch. The control shows the same short feed passes every guard and sweeps when
// the switch is off, which is why the hourly run turns it on.
func TestPersonsSweepKeepsOrphansWhenAsked(t *testing.T) {
	t.Parallel()
	for _, keep := range []bool{true, false} {
		t.Run(fmt.Sprintf("keep=%v", keep), func(t *testing.T) {
			t.Parallel()
			app := newOrphanSweepTestApp(t, "persons")
			col, err := app.FindCollectionByNameOrId("persons")
			if err != nil {
				t.Fatal(err)
			}
			col.Fields.Add(&core.NumberField{Name: "cm_id"})
			col.Fields.Add(&core.DateField{Name: retiredAtField})
			if err = app.Save(col); err != nil {
				t.Fatal(err)
			}
			for cmID := 9400301; cmID <= 9400303; cmID++ {
				rec := core.NewRecord(col)
				rec.Set("cm_id", cmID)
				rec.Set("year", 2027)
				if err = app.Save(rec); err != nil {
					t.Fatal(err)
				}
			}

			s := NewPersonsSync(app, nil)
			s.SyncSuccessful = true
			s.ProcessedKeys = map[string]bool{CompositeKey(9400301, 2027): true}
			s.setKeepOrphans(keep)
			if err := s.deleteOrphans(2027); err != nil {
				t.Fatal(err)
			}
			want := 1
			if keep {
				want = 3
			}
			if n := countRows(t, app, "persons", "year = 2027"); n != want {
				t.Errorf("%d persons left, want %d", n, want)
			}
		})
	}
}
