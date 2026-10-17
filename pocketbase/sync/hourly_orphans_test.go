package sync

import (
	"context"
	"fmt"
	"slices"
	"testing"

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
}

func (s *shortFeedSweeper) Sync(context.Context) error {
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
