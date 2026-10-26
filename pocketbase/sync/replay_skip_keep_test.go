package sync

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// The tests in this file pin two things about a historical replay (POST /api/custom/sync/run for a
// year outside the synced pair N, N-1):
//
//   - skip=<comma list of job names> drops those jobs from the replay, on the immediate path and
//     the queued one, and is refused for an unknown job or a synced season;
//   - the session_groups, sessions, persons and households sweeps delete nothing on a replay, and
//     log how many they kept; the attendees sweep still runs.
//
// Every orchestrator-level test runs at 2026-10-20 (afterRollover): the primary is 2027, the
// synced pair is [2027, 2026], so 2025 is a replay.

// ── skip= parsing and subtraction ─────────────────────────────────────────────────────────

// TestSubtractJobsKeepsOrderAndIgnoresAbsentNames: the queue order is the registry's, and a skip
// of a job the run would not have run anyway (a SyncedSeasonsOnly job on a replay) is a no-op.
func TestSubtractJobsKeepsOrderAndIgnoresAbsentNames(t *testing.T) {
	t.Parallel()
	jobs := []string{"session_groups", "sessions", "attendees", "persons", "bunks"}
	got := subtractJobs(jobs, []string{"persons", "sessions", "bunk_requests"})
	if want := []string{"session_groups", "attendees", "bunks"}; !slices.Equal(got, want) {
		t.Errorf("got %v, want %v", got, want)
	}
	if got := subtractJobs(jobs, nil); !slices.Equal(got, jobs) {
		t.Errorf("no skip must leave the list as it is, got %v", got)
	}
}

// TestParseSkipParam: blank parts are dropped, names are trimmed, de-duplicated and sorted (so
// the queue's dedupe key compares like with like), and an unknown name is an error naming it.
func TestParseSkipParam(t *testing.T) {
	t.Parallel()
	for _, raw := range []string{"", " ", ",,"} {
		got, err := parseSkipParam(raw)
		if err != nil || got != nil {
			t.Errorf("%q: got %v, %v; want nil, nil", raw, got, err)
		}
	}
	got, err := parseSkipParam(" persons,attendees ,persons,")
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"attendees", "persons"}; !slices.Equal(got, want) {
		t.Errorf("got %v, want %v", got, want)
	}
	if _, err := parseSkipParam("persons,not_a_job"); err == nil || !strings.Contains(err.Error(), "not_a_job") {
		t.Errorf("an unknown job must be an error naming it, got %v", err)
	}
}

// TestEnqueueUnifiedSyncSkipIsPartOfTheDedupeKey: two replays of one year that skip different jobs
// are different runs, so the second must not merge into the first and silently run its list.
// The same skip list dedupes as before.
func TestEnqueueUnifiedSyncSkipIsPartOfTheDedupeKey(t *testing.T) {
	t.Parallel()
	o := NewOrchestrator(nil)

	plain, err := o.EnqueueUnifiedSync(2021, "all", false, false, false, "user1")
	if err != nil {
		t.Fatal(err)
	}
	skipping, err := o.EnqueueUnifiedSyncWithSkip(2021, "all", false, false, false, []string{"persons"}, "user2")
	if err != nil {
		t.Fatal(err)
	}
	if skipping.ID == plain.ID {
		t.Fatal("a replay skipping persons merged into a replay that runs persons")
	}
	again, err := o.EnqueueUnifiedSyncWithSkip(2021, "all", false, false, false, []string{"persons"}, "user3")
	if err != nil {
		t.Fatal(err)
	}
	if again.ID != skipping.ID {
		t.Error("the same skip list must dedupe onto the queued item")
	}
	other, err := o.EnqueueUnifiedSyncWithSkip(2021, "all", false, false, false, []string{"attendees"}, "user4")
	if err != nil {
		t.Fatal(err)
	}
	if other.ID == skipping.ID {
		t.Error("a different skip list must not dedupe")
	}
	q := o.GetQueuedSyncs()
	if len(q) != 3 {
		t.Fatalf("want 3 queued items, got %+v", q)
	}
	if q[0].Skip != nil || !slices.Equal(q[1].Skip, []string{"persons"}) {
		t.Errorf("queued items must carry their own skip list, got %+v", q)
	}
}

// ── skip= at the HTTP boundary ────────────────────────────────────────────────────────────

// TestHandleUnifiedSyncSkipRefusesAnUnknownJob: a typo in skip= must be a 400 naming it, never a
// replay that quietly runs the job the operator meant to leave out.
func TestHandleUnifiedSyncSkipRefusesAnUnknownJob(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	withNow(t, afterRollover)
	client := newTestCampMinderClient(t, 2027)

	runInBubble(t, func(t *testing.T) {
		o, rec := newRecordingOrchestrator(t, nil, client)
		scheduler := &Scheduler{orchestrator: o}
		resp := callHandler(t, nil, "/?service=all&year=2025&skip=persons,persns", func(e *core.RequestEvent) error {
			return handleUnifiedSync(e, scheduler)
		})
		// Errorf, not Fatalf: a wrongly started run must still drain before the bubble ends.
		if resp.Code != http.StatusBadRequest {
			t.Errorf("expected 400, got %d: %s", resp.Code, resp.Body.String())
		}
		if !strings.Contains(resp.Body.String(), "persns") {
			t.Errorf("the 400 must name the unknown job, got %s", resp.Body.String())
		}
		time.Sleep(time.Hour)
		if runs := rec.Runs(); len(runs) != 0 {
			t.Errorf("a refused request ran %v", runs)
		}
	})
}

// TestHandleUnifiedSyncSkipRefusesASyncedSeason: skip= is a replay tool. A run of N or N-1 is the
// live data's refresh and keeps its full job list; a skip there is a 400, on both seasons, and
// before the busy check, so it is never queued either.
func TestHandleUnifiedSyncSkipRefusesASyncedSeason(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	withNow(t, afterRollover)
	client := newTestCampMinderClient(t, 2027)

	for _, year := range []int{2027, 2026} {
		runInBubble(t, func(t *testing.T) {
			o, rec := newRecordingOrchestrator(t, nil, client)
			scheduler := &Scheduler{orchestrator: o}
			target := fmt.Sprintf("/?service=all&year=%d&skip=persons", year)
			resp := callHandler(t, nil, target, func(e *core.RequestEvent) error {
				return handleUnifiedSync(e, scheduler)
			})
			if resp.Code != http.StatusBadRequest {
				t.Errorf("%d: expected 400, got %d: %s", year, resp.Code, resp.Body.String())
			}
			if !strings.Contains(resp.Body.String(), "skip") {
				t.Errorf("%d: the 400 must say skip= is the problem, got %s", year, resp.Body.String())
			}
			time.Sleep(time.Hour)
			if runs := rec.Runs(); len(runs) != 0 {
				t.Errorf("%d: a refused request ran %v", year, runs)
			}
		})
	}
}

// TestHandleUnifiedSyncSkipRefusesARunOfNothing: skipping every job a request resolves to leaves
// nothing to run, which is a 400 rather than a 200 for a sync that never happens.
func TestHandleUnifiedSyncSkipRefusesARunOfNothing(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	withNow(t, afterRollover)
	client := newTestCampMinderClient(t, 2027)

	runInBubble(t, func(t *testing.T) {
		o, _ := newRecordingOrchestrator(t, nil, client)
		scheduler := &Scheduler{orchestrator: o}
		resp := callHandler(t, nil, "/?service=persons&year=2025&skip=persons", func(e *core.RequestEvent) error {
			return handleUnifiedSync(e, scheduler)
		})
		if resp.Code != http.StatusBadRequest {
			t.Errorf("expected 400, got %d: %s", resp.Code, resp.Body.String())
		}
		time.Sleep(time.Hour)
	})
}

// TestHistoricalReplaySkipsTheNamedJobs is the immediate path: the skipped jobs never run for the
// replayed season, every other job still does, and the 200 echoes the list.
func TestHistoricalReplaySkipsTheNamedJobs(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	withNow(t, afterRollover)
	client := newTestCampMinderClient(t, 2027)

	runInBubble(t, func(t *testing.T) {
		o, rec := newRecordingOrchestrator(t, nil, client)
		scheduler := &Scheduler{orchestrator: o}
		resp := callHandler(t, nil, "/?service=all&year=2025&skip=persons,bunk_assignments",
			func(e *core.RequestEvent) error { return handleUnifiedSync(e, scheduler) })
		if resp.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", resp.Code, resp.Body.String())
		}
		var body map[string]any
		if err := json.Unmarshal(resp.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if got := fmt.Sprint(body["skip"]); got != "[bunk_assignments persons]" {
			t.Errorf("the 200 must echo the skip list, got %v", body["skip"])
		}
		time.Sleep(time.Hour)
		for _, job := range []string{"persons", "bunk_assignments"} {
			if rec.Ran(job, 2025) {
				t.Errorf("%s ran although it was skipped: %v", job, rec.Runs())
			}
		}
		for _, job := range []string{"sessions", "attendees", "bunks"} {
			if !rec.Ran(job, 2025) {
				t.Errorf("%s must still run: %v", job, rec.Runs())
			}
		}
	})
}

// TestQueuedHistoricalReplaySkipsTheNamedJobs is the queued path: a replay that arrives while
// another job runs is queued with its skip list, and the dequeued run honors it.
func TestQueuedHistoricalReplaySkipsTheNamedJobs(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	withNow(t, afterRollover)
	client := newTestCampMinderClient(t, 2027)

	runInBubble(t, func(t *testing.T) {
		o, rec := newRecordingOrchestrator(t, nil, client)
		scheduler := &Scheduler{orchestrator: o}
		if err := o.MarkSyncRunning("attendees"); err != nil {
			t.Fatal(err)
		}
		resp := callHandler(t, nil, "/?service=all&year=2025&skip=persons",
			func(e *core.RequestEvent) error { return handleUnifiedSync(e, scheduler) })
		if resp.Code != http.StatusAccepted {
			t.Fatalf("expected the busy orchestrator to queue the request, got %d: %s", resp.Code, resp.Body.String())
		}
		var body map[string]any
		if err := json.Unmarshal(resp.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if got := fmt.Sprint(body["skip"]); got != "[persons]" {
			t.Errorf("the 202 must echo the queued item's skip list, got %v", body["skip"])
		}
		if q := o.GetQueuedSyncs(); len(q) != 1 || !slices.Equal(q[0].Skip, []string{"persons"}) {
			t.Fatalf("the queued item must carry the skip list, got %+v", q)
		}
		o.FinalizeSyncStatus("attendees", Stats{}, nil)

		processQueuedSyncs(o)

		if rec.Ran("persons", 2025) {
			t.Errorf("the dequeued replay ran persons although it was skipped: %v", rec.Runs())
		}
		if !rec.Ran("attendees", 2025) {
			t.Errorf("the dequeued replay must still run attendees: %v", rec.Runs())
		}
	})
}

// TestHandleUnifiedSyncDryRunChecksThePostSkipList: the dry-run support check must judge the jobs
// that will run. A job left out by skip= cannot make the request a 400, and one still in the list
// still does.
func TestHandleUnifiedSyncDryRunChecksThePostSkipList(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	withNow(t, afterRollover)
	client := newTestCampMinderClient(t, 2027)

	runInBubble(t, func(t *testing.T) {
		// Recorders are not DryRunnable; registering only these two makes them the whole
		// unsupported list (UnsupportedDryRunServices skips an unregistered job).
		o, _ := newRecordingOrchestrator(t, nil, client, "persons", "bunks")
		scheduler := &Scheduler{orchestrator: o}
		resp := callHandler(t, nil, "/?service=all&year=2025&dry_run=true&skip=persons",
			func(e *core.RequestEvent) error { return handleUnifiedSync(e, scheduler) })
		if resp.Code != http.StatusBadRequest {
			t.Errorf("bunks still runs and cannot dry-run: expected 400, got %d: %s", resp.Code, resp.Body.String())
		}
		var body struct {
			Unsupported []string `json:"unsupported_services"`
		}
		if err := json.Unmarshal(resp.Body.Bytes(), &body); err != nil {
			t.Error(err)
		}
		if !slices.Equal(body.Unsupported, []string{"bunks"}) {
			t.Errorf("the check must judge the post-skip list, got %v", body.Unsupported)
		}

		resp = callHandler(t, nil, "/?service=all&year=2025&dry_run=true&skip=persons,bunks",
			func(e *core.RequestEvent) error { return handleUnifiedSync(e, scheduler) })
		if resp.Code != http.StatusOK {
			t.Errorf("with both skipped every remaining job can dry-run: expected 200, got %d: %s",
				resp.Code, resp.Body.String())
		}
		time.Sleep(time.Hour)
	})
}

// ── keep orphans on a replay ──────────────────────────────────────────────────────────────

// replayKeeperRecorder is a clientRecorder that records whether a replay told it to keep orphans.
type replayKeeperRecorder struct {
	clientRecorder
	keep bool
}

func (k *replayKeeperRecorder) keepOrphansForReplay() { k.keep = true }

// TestReplayKeepSetMatchesTheAllSeasonsResync: a replay keeps the orphans of exactly the jobs the
// weekly all-seasons re-sync keeps them for, its jobs except the one that sweeps (attendees).
func TestReplayKeepSetMatchesTheAllSeasonsResync(t *testing.T) {
	t.Parallel()
	want := subtractJobs(allSeasonsResyncJobs, []string{allSeasonsSweepingJob})
	if !slices.Equal(replayKeepOrphanJobs, want) {
		t.Errorf("replay keep set %v, all-seasons keep set %v", replayKeepOrphanJobs, want)
	}
}

// TestHistoricalReplayKeepsSessionAndPersonOrphans: a replay switches the session_groups, sessions
// and persons instances it runs (the season's own, never the registered ones) to keep their
// orphans, and leaves attendees sweeping. A run of N-1 is not a replay and sweeps as before.
func TestHistoricalReplayKeepsSessionAndPersonOrphans(t *testing.T) {
	t.Setenv("CAMPMINDER_SEASON_ID", "")
	withNow(t, afterRollover)
	client := newTestCampMinderClient(t, 2027)
	jobs := []string{"session_groups", "sessions", "attendees", "persons"}

	for _, tc := range []struct {
		year   int
		replay bool
	}{{2025, true}, {2019, true}, {2026, false}} {
		runInBubble(t, func(t *testing.T) {
			o, rec := newRecordingOrchestrator(t, nil, client, jobs...)
			built := map[string]*replayKeeperRecorder{}
			o.yearServicesFn = func(year int, _ bool) map[string]Service {
				out := map[string]Service{}
				for _, id := range jobs {
					k := &replayKeeperRecorder{clientRecorder: clientRecorder{
						id: id, client: o.BaseClient().CloneWithYear(year), rec: rec,
					}}
					built[id] = k
					out[id] = k
				}
				return out
			}
			if err := o.RunSyncWithOptions(context.Background(), Options{Year: tc.year}); err != nil {
				t.Fatal(err)
			}
			for _, id := range jobs {
				if !rec.Ran(id, tc.year) {
					t.Fatalf("%d: %s never ran: %v", tc.year, id, rec.Runs())
				}
				want := tc.replay && id != "attendees"
				if got := built[id].keep; got != want {
					t.Errorf("%d: %s keeps orphans = %v, want %v", tc.year, id, got, want)
				}
			}
		})
	}
}

// TestReplayKeepsBaseSweepsAndStillSweepsAttendees: the sessions and session_groups sweeps are
// BaseSyncService's. On a replay their instance keeps every row through both entry points and
// logs the count; the attendees instance, never switched, deletes its orphans as on any run.
// Serial: captureSweepLogs swaps slog's default.
func TestReplayKeepsBaseSweepsAndStillSweepsAttendees(t *testing.T) {
	logs := captureSweepLogs(t)
	seed := func(t *testing.T) (core.App, map[any]*core.Record) {
		t.Helper()
		app := newOrphanSweepTestApp(t, "widgets", "name")
		col, err := app.FindCollectionByNameOrId("widgets")
		if err != nil {
			t.Fatal(err)
		}
		preloaded := map[any]*core.Record{}
		for i := 1; i <= 3; i++ {
			rec := core.NewRecord(col)
			rec.Id = orphanTestID(i)
			rec.Set("name", fmt.Sprintf("widget-%d", i))
			rec.Set("year", 2021)
			if err := app.Save(rec); err != nil {
				t.Fatal(err)
			}
			preloaded[fmt.Sprintf("widget-%d", i)] = rec
		}
		return app, preloaded
	}
	keyOf := func(r *core.Record) (string, bool) { return r.GetString("name"), true }
	service := func(app core.App, replay bool) *BaseSyncService {
		b := &BaseSyncService{App: app, ProcessedKeys: map[string]bool{"widget-1": true}, SyncSuccessful: true}
		if replay {
			b.keepOrphansForReplay()
		}
		return b
	}

	for _, replay := range []bool{true, false} {
		app, _ := seed(t)
		if err := service(app, replay).DeleteOrphans("widgets", keyOf, "session", "year = 2021"); err != nil {
			t.Fatal(err)
		}
		want := 1
		if replay {
			want = 3
		}
		if n := countRows(t, app, "widgets", "year = 2021"); n != want {
			t.Errorf("DeleteOrphans replay=%v: %d rows left, want %d", replay, n, want)
		}

		app, preloaded := seed(t)
		if err := service(app, replay).DeleteOrphansFromPreloaded(preloaded, "session group"); err != nil {
			t.Fatal(err)
		}
		if n := countRows(t, app, "widgets", "year = 2021"); n != want {
			t.Errorf("DeleteOrphansFromPreloaded replay=%v: %d rows left, want %d", replay, n, want)
		}
	}
	for _, line := range []string{"entity=session kept=2", `entity="session group" kept=2`} {
		if !strings.Contains(logs.String(), line) {
			t.Errorf("log lacks %q; log:\n%s", line, logs.String())
		}
	}
}

// seedCMIDRows builds a persons-shaped (or households-shaped) collection holding one row of
// year per given CampMinder id.
func seedCMIDRows(t *testing.T, collection string, year int, cmIDs ...int) core.App {
	t.Helper()
	app := newOrphanSweepTestApp(t, collection)
	col, err := app.FindCollectionByNameOrId(collection)
	if err != nil {
		t.Fatal(err)
	}
	col.Fields.Add(&core.NumberField{Name: "cm_id"})
	col.Fields.Add(&core.DateField{Name: retiredAtField}) // persons retires staff-linked rows; households ignores it
	if err = app.Save(col); err != nil {
		t.Fatal(err)
	}
	for _, cmID := range cmIDs {
		rec := core.NewRecord(col)
		rec.Set("cm_id", cmID)
		rec.Set("year", year)
		if err = app.Save(rec); err != nil {
			t.Fatal(err)
		}
	}
	return app
}

// TestPersonsSweepsKeepEverythingOnAReplay: on a replay the real persons and households sweeps
// delete nothing and log how many orphans they kept. The control is the same short feed on a
// normal run, which deletes the two orphans. Serial: captureSweepLogs swaps slog's default.
func TestPersonsSweepsKeepEverythingOnAReplay(t *testing.T) {
	for _, replay := range []bool{true, false} {
		t.Run(fmt.Sprintf("replay=%v", replay), func(t *testing.T) {
			logs := captureSweepLogs(t)

			persons := seedCMIDRows(t, "persons", 2021, 9400401, 9400402, 9400403)
			s := NewPersonsSync(persons, nil)
			s.SyncSuccessful = true
			s.ProcessedKeys = map[string]bool{CompositeKey(9400401, 2021): true}
			if replay {
				s.keepOrphansForReplay()
			}
			if err := s.deleteOrphans(2021); err != nil {
				t.Fatal(err)
			}

			households := seedCMIDRows(t, "households", 2021, 9400501, 9400502, 9400503)
			h := NewPersonsSync(households, nil)
			h.SyncSuccessful = true
			if replay {
				h.keepOrphansForReplay()
			}
			if err := h.deleteHouseholdOrphans(2021, map[int]bool{9400501: true}); err != nil {
				t.Fatal(err)
			}

			want := 1
			if replay {
				want = 3
			}
			if n := countRows(t, persons, "persons", "year = 2021"); n != want {
				t.Errorf("%d persons left, want %d", n, want)
			}
			if n := countRows(t, households, "households", "year = 2021"); n != want {
				t.Errorf("%d households left, want %d", n, want)
			}

			out := logs.String()
			for _, entity := range []string{"person", "household"} {
				line := fmt.Sprintf("entity=%s kept=2", entity)
				if got := strings.Contains(out, line); got != replay {
					t.Errorf("log carries %q = %v, want %v; log:\n%s", line, got, replay, out)
				}
			}
		})
	}
}
