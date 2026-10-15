package sync

import (
	"context"
	"fmt"
	"slices"
	"testing"
	"testing/synctest"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/robfig/cron/v3"
)

// The tests in this file pin the weekly all-seasons re-sync (epic #3207 PR 16): every season
// the scheduled runs no longer cover (2017 through N-2) re-fetches its sessions, attendees and
// persons from CampMinder, upserting what changed, and deletes nothing but a stale enrollment.

// TestHistoricalSeasonsIsEveryOlderSeasonNewestFirst: N and N-1 belong to the scheduled runs, so
// the all-seasons pass starts at N-2 and walks back to the first season Kindred holds.
func TestHistoricalSeasonsIsEveryOlderSeasonNewestFirst(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")

	got, err := HistoricalSeasons(time.Date(2026, time.October, 20, 10, 0, 0, 0, time.UTC)) // primary 2027
	if err != nil {
		t.Fatal(err)
	}
	if want := []int{2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017}; !slices.Equal(got, want) {
		t.Errorf("after the rollover: got %v, want %v", got, want)
	}

	got, err = HistoricalSeasons(time.Date(2026, time.October, 1, 10, 0, 0, 0, time.UTC)) // primary 2026
	if err != nil {
		t.Fatal(err)
	}
	if want := []int{2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017}; !slices.Equal(got, want) {
		t.Errorf("before the rollover: got %v, want %v", got, want)
	}
}

// TestKeepOrphansStopsEveryBaseSweep: a service told to keep orphans deletes nothing through any
// of BaseSyncService's three sweep entry points, however short its computed set.
func TestKeepOrphansStopsEveryBaseSweep(t *testing.T) {
	t.Parallel()

	seed := func(t *testing.T) (core.App, map[any]*core.Record) {
		t.Helper()
		app := newOrphanSweepTestApp(t, "widgets", "name")
		col, err := app.FindCollectionByNameOrId("widgets")
		if err != nil {
			t.Fatalf("find widgets: %v", err)
		}
		preloaded := map[any]*core.Record{}
		for i := 1; i <= 3; i++ {
			rec := core.NewRecord(col)
			rec.Id = orphanTestID(i)
			rec.Set("name", fmt.Sprintf("widget-%d", i))
			rec.Set("year", 2021)
			if saveErr := app.Save(rec); saveErr != nil {
				t.Fatalf("seed widget %d: %v", i, saveErr)
			}
			preloaded[rec.Id] = rec
		}
		return app, preloaded
	}
	keyOf := func(r *core.Record) (string, bool) { return r.GetString("name"), true }
	keeping := func(app core.App) *BaseSyncService {
		b := &BaseSyncService{App: app, ProcessedKeys: map[string]bool{"widget-1": true}, SyncSuccessful: true}
		b.setKeepOrphans(true)
		return b
	}

	t.Run("DeleteOrphans", func(t *testing.T) {
		t.Parallel()
		app, _ := seed(t)
		if err := keeping(app).DeleteOrphans("widgets", keyOf, "widget", "year = 2021"); err != nil {
			t.Fatal(err)
		}
		if n := countRows(t, app, "widgets", "year = 2021"); n != 3 {
			t.Errorf("%d rows left, want 3", n)
		}
	})
	t.Run("DeleteOrphansGuarded", func(t *testing.T) {
		t.Parallel()
		app, _ := seed(t)
		err := keeping(app).DeleteOrphansGuarded("widgets", keyOf, "widget", "year = 2021",
			OrphanSweepGuard{Entity: "widgets", Year: 2021, Computed: 1})
		if err != nil {
			t.Fatal(err)
		}
		if n := countRows(t, app, "widgets", "year = 2021"); n != 3 {
			t.Errorf("%d rows left, want 3", n)
		}
	})
	t.Run("DeleteOrphansFromPreloaded", func(t *testing.T) {
		t.Parallel()
		app, preloaded := seed(t)
		if err := keeping(app).DeleteOrphansFromPreloaded(preloaded, "widget"); err != nil {
			t.Fatal(err)
		}
		if n := countRows(t, app, "widgets", "year = 2021"); n != 3 {
			t.Errorf("%d rows left, want 3", n)
		}
	})
}

// TestPersonsHouseholdSweepKeepsOrphansWhenAsked: the household sweep is persons' own, outside
// BaseSyncService, so it must honor the switch itself. A household delete cascades into that
// season's family_camp_registrations and household_demographics, which an older season never
// rebuilds.
func TestPersonsHouseholdSweepKeepsOrphansWhenAsked(t *testing.T) {
	t.Parallel()
	app := newOrphanSweepTestApp(t, "households")
	col, err := app.FindCollectionByNameOrId("households")
	if err != nil {
		t.Fatal(err)
	}
	col.Fields.Add(&core.NumberField{Name: "cm_id"})
	if err = app.Save(col); err != nil {
		t.Fatal(err)
	}
	rec := core.NewRecord(col)
	rec.Set("cm_id", 9400201)
	rec.Set("year", 2021)
	if err = app.Save(rec); err != nil {
		t.Fatal(err)
	}

	s := NewPersonsSync(app, nil)
	s.setKeepOrphans(true)
	if err := s.deleteHouseholdOrphans(2021, map[int]bool{}); err != nil {
		t.Fatal(err)
	}
	if n := countRows(t, app, "households", "year = 2021"); n != 1 {
		t.Errorf("%d households left, want 1: the all-seasons pass must not sweep households", n)
	}
}

// keeperRecorder is a clientRecorder that also records whether it was told to keep orphans.
type keeperRecorder struct {
	clientRecorder
	keep bool
}

func (k *keeperRecorder) setKeepOrphans(keep bool) { k.keep = keep }

// newAllSeasonsOrchestrator is a recording orchestrator (primary 2027) whose season instances
// are keeperRecorders, returned per (job, season) so a test can read each one's switch.
func newAllSeasonsOrchestrator(t *testing.T) (*Orchestrator, *seasonRecorder, map[seasonRun]*keeperRecorder) {
	t.Helper()
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	withNow(t, time.Date(2026, time.October, 20, 10, 0, 0, 0, time.UTC)) // primary 2027
	client := newTestCampMinderClient(t, 2027)
	o, rec := newRecordingOrchestrator(t, nil, client)
	built := map[seasonRun]*keeperRecorder{}
	factory := o.yearServicesFn
	o.yearServicesFn = func(year int, debug bool) map[string]Service {
		out := map[string]Service{}
		for id := range factory(year, debug) {
			k := &keeperRecorder{clientRecorder: clientRecorder{
				id: id, client: o.BaseClient().CloneWithYear(year), rec: rec,
			}}
			built[seasonRun{ID: id, Year: year}] = k
			out[id] = k
		}
		return out
	}
	return o, rec, built
}

// TestAllSeasonsResyncRunsTheSourceJobsForEveryOlderSeason: each older season, newest first,
// runs session_groups, sessions, attendees and persons with its own season's client, and nothing
// runs for N or N-1. Every job but attendees keeps its orphans.
func TestAllSeasonsResyncRunsTheSourceJobsForEveryOlderSeason(t *testing.T) {
	runInBubble(t, func(t *testing.T) {
		o, rec, built := newAllSeasonsOrchestrator(t)
		if err := o.RunAllSeasonsResync(context.Background()); err != nil {
			t.Fatal(err)
		}
		var want []seasonRun
		for year := 2025; year >= 2017; year-- {
			for _, id := range []string{"session_groups", "sessions", "attendees", "persons"} {
				want = append(want, seasonRun{ID: id, Year: year})
			}
		}
		if got := rec.Runs(); !slices.Equal(got, want) {
			t.Fatalf("ran %v,\nwant %v", got, want)
		}
		for run, k := range built {
			if !slices.Contains(want, run) {
				continue
			}
			if wantKeep := run.ID != "attendees"; k.keep != wantKeep {
				t.Errorf("%s %d: keep orphans = %v, want %v", run.ID, run.Year, k.keep, wantKeep)
			}
		}
	})
}

// TestAllSeasonsResyncWaitsForARunningQueue: a nightly (or any queue) still running holds the
// all-seasons pass back, so the two never fight over a job id and the nightly is never refused.
func TestAllSeasonsResyncWaitsForARunningQueue(t *testing.T) {
	runInBubble(t, func(t *testing.T) {
		o, rec, _ := newAllSeasonsOrchestrator(t)
		o.mu.Lock()
		o.dailySyncRunning = true
		o.mu.Unlock()

		done := make(chan error, 1)
		go func() { done <- o.RunAllSeasonsResync(context.Background()) }()
		time.Sleep(2 * time.Hour)
		synctest.Wait()
		if runs := rec.Runs(); len(runs) != 0 {
			t.Fatalf("ran %v while the nightly was running", runs)
		}

		o.mu.Lock()
		o.dailySyncRunning = false
		o.mu.Unlock()
		if err := <-done; err != nil {
			t.Fatal(err)
		}
		if !rec.Ran("persons", 2017) {
			t.Error("the pass never finished after the nightly ended")
		}
	})
}

// TestAllSeasonsResyncRefusesASecondRun: two passes at once would fight over the same job ids.
func TestAllSeasonsResyncRefusesASecondRun(t *testing.T) {
	runInBubble(t, func(t *testing.T) {
		o, rec, _ := newAllSeasonsOrchestrator(t)
		release := make(chan struct{})
		rec.blockDuring("session_groups", 2025, release)

		done := make(chan error, 1)
		go func() { done <- o.RunAllSeasonsResync(context.Background()) }()
		rec.waitUntilBlocked(t)

		if err := o.RunAllSeasonsResync(context.Background()); err == nil {
			t.Error("a second pass started while the first was running")
		}
		close(release)
		if err := <-done; err != nil {
			t.Fatal(err)
		}
	})
}

// TestAllSeasonsResyncScheduleIsSaturdayMorning: the pass runs once a week, Saturday 05:00 in
// the container's zone. The nightly starts 03:00 and takes about an hour for two seasons; Sunday
// is the weekly globals (02:00) and the long custom-values pass (04:00), so Saturday is the
// quiet morning.
func TestAllSeasonsResyncScheduleIsSaturdayMorning(t *testing.T) {
	t.Parallel()
	sched, err := cron.ParseStandard(allSeasonsResyncSchedule)
	if err != nil {
		t.Fatal(err)
	}
	from := time.Date(2026, time.October, 14, 12, 0, 0, 0, time.UTC) // a Wednesday
	next := sched.Next(from)
	if next.Weekday() != time.Saturday || next.Hour() != 5 || next.Minute() != 0 {
		t.Errorf("next run %v, want Saturday 05:00", next)
	}
	if after := sched.Next(next); after.Sub(next) != 7*24*time.Hour {
		t.Errorf("runs %v apart, want weekly", after.Sub(next))
	}
}
