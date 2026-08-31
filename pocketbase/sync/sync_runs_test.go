package sync

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/types"
)

// The tests in this file pin the persistence half of kindred#2284.
//
// Stats.Rejected is warn-only for its first season *specifically so a distribution can be
// collected and a threshold set later from evidence*. That only works if the numbers survive
// the run. Before this, lastCompletedStatus was an in-memory map wiped on every container
// restart and there was no sync_runs table at all, so a season of Rejected counts would have
// amounted to whatever happened to be in memory the moment someone looked.

// hourlySyncJob mirrors the registry's sole CadenceHourly job. It is test-local rather than a
// production constant now that RunHourlySync loops over cadenceQueue(CadenceHourly) directly;
// TestCadenceBitsetOverlap (registry_test.go) is what pins the two together, so a change to
// the hourly cadence's membership fails there rather than silently going stale here.
const hourlySyncJob = "bunk_assignments"

// newSyncRunsApp returns a test app carrying the sync_runs collection.
//
// The schema mirrors pb_migrations/1500000152_sync_runs.js field for field. It is written out
// again here rather than derived because PocketBase's JS migrations do not run under `go
// test`; the migration itself is verified separately by booting the binary and reading
// sqlite_master. If you change one, change the other.
func newSyncRunsApp(t *testing.T) *tests.TestApp {
	t.Helper()

	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)

	col := core.NewBaseCollection(syncRunsCollection)
	col.Fields.Add(&core.TextField{Name: "service", Required: true, Max: 100})
	col.Fields.Add(&core.NumberField{
		Name: "year", Required: true, OnlyInt: true,
		Min: types.Pointer(2000.0), Max: types.Pointer(2100.0),
	})
	col.Fields.Add(&core.SelectField{
		Name: "status", Required: true, MaxSelect: 1,
		Values: []string{statusSuccess, statusFailed},
	})
	col.Fields.Add(&core.SelectField{
		Name: "trigger", Required: true, MaxSelect: 1,
		Values: []string{
			triggerHourly, triggerDaily, triggerWeekly,
			triggerCustomValues, triggerHistorical, triggerManual,
		},
	})
	col.Fields.Add(&core.TextField{Name: "batch_id", Required: true, Max: 100})
	col.Fields.Add(&core.TextField{Name: "session", Max: 100})
	for _, name := range []string{
		"created_count", "updated_count", "deleted_count", "skipped_count",
		"errors_count", "rejected_count", "expanded_count", "already_processed_count",
		"prod_audit_warnings_count", "lodging_prod_audit_warnings_count", "duration",
	} {
		col.Fields.Add(&core.NumberField{Name: name, OnlyInt: true, Min: types.Pointer(0.0)})
	}
	col.Fields.Add(&core.DateField{Name: "started"})
	col.Fields.Add(&core.DateField{Name: "ended"})
	col.Fields.Add(&core.TextField{Name: "error", Max: maxSyncRunErrorLen})
	col.Fields.Add(&core.JSONField{Name: "sub_stats", MaxSize: 100000})
	col.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	col.Fields.Add(&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})

	if err := app.Save(col); err != nil {
		t.Fatalf("save sync_runs collection: %v", err)
	}

	return app
}

// waitForSyncRuns polls until at least want rows exist, then returns everything it found.
// The two goroutine-backed completion paths write their row after the sync goroutine
// returns, so there is nothing synchronous to wait on from the caller's side.
func waitForSyncRuns(t *testing.T, app core.App, want int) []*core.Record {
	t.Helper()

	deadline := time.Now().Add(10 * time.Second)
	var recs []*core.Record
	for time.Now().Before(deadline) {
		var err error
		recs, err = app.FindAllRecords(syncRunsCollection)
		if err != nil {
			t.Fatalf("FindAllRecords(%s): %v", syncRunsCollection, err)
		}
		if len(recs) >= want {
			return recs
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %d %s row(s), found %d", want, syncRunsCollection, len(recs))
	return nil
}

// TestSyncRunIsPersisted is the core guard: every completed run leaves a row behind, through
// each of the three completion paths. Persisting from only one of them would repeat exactly
// the defect kindred#2284 fixed in the status decision — the other two would stay silent.
func TestSyncRunIsPersisted(t *testing.T) {
	t.Parallel()

	for _, path := range completionPaths() {
		t.Run(path.name, func(t *testing.T) {
			app := newSyncRunsApp(t)
			o := NewOrchestrator(app)
			svc := &MockService{name: "svc", stats: Stats{
				Created: 7, Updated: 5, Deleted: 3, Skipped: 2, Rejected: 11,
			}}

			path.run(t, o, "svc", svc, nil)

			recs := waitForSyncRuns(t, app, 1)
			if len(recs) != 1 {
				t.Fatalf("got %d rows, want exactly 1", len(recs))
			}
			rec := recs[0]

			if got := rec.GetString("service"); got != "svc" {
				t.Errorf("service = %q, want %q", got, "svc")
			}
			if got := rec.GetString("status"); got != statusSuccess {
				t.Errorf("status = %q, want %q", got, statusSuccess)
			}
			for field, want := range map[string]int{
				"created_count":  7,
				"updated_count":  5,
				"deleted_count":  3,
				"skipped_count":  2,
				"errors_count":   0,
				"rejected_count": 11,
			} {
				if got := rec.GetInt(field); got != want {
					t.Errorf("%s = %d, want %d", field, got, want)
				}
			}
			if rec.GetDateTime("started").IsZero() {
				t.Error("started is zero — the run's start time was not recorded")
			}
			if rec.GetDateTime("ended").IsZero() {
				t.Error("ended is zero — the run's end time was not recorded")
			}
		})
	}
}

// TestSyncRunPersistsRejectedCount is the reason this table exists. Rejected is warn-only
// for its first season so a distribution can be gathered; a run that drops the count leaves
// the threshold to be picked by guesswork, which is the outcome the decision on kindred#2284
// was explicitly avoiding.
func TestSyncRunPersistsRejectedCount(t *testing.T) {
	t.Parallel()

	app := newSyncRunsApp(t)
	o := NewOrchestrator(app)
	o.RegisterService("svc", &MockService{name: "svc", stats: Stats{Created: 1, Rejected: 4321}})

	if err := o.RunSingleSync(context.Background(), "svc"); err != nil {
		t.Fatalf("RunSingleSync: %v", err)
	}

	rec := waitForSyncRuns(t, app, 1)[0]
	if got := rec.GetInt("rejected_count"); got != 4321 {
		t.Errorf("rejected_count = %d, want 4321", got)
	}
	if got := rec.GetString("status"); got != statusSuccess {
		t.Errorf("status = %q, want %q — Rejected is warn-only and must not fail the run", got, statusSuccess)
	}
}

// TestSyncRunPersistsOptionalCounters covers the four job-type-specific counters. They are
// omitempty on Stats and mirrored as plain columns here, which is the whole reason this is
// one table and not one table per job type: the job-type distinction is a scheduling one,
// and every service returns the same struct.
func TestSyncRunPersistsOptionalCounters(t *testing.T) {
	t.Parallel()

	app := newSyncRunsApp(t)
	o := NewOrchestrator(app)
	o.RegisterService("svc", &MockService{name: "svc", stats: Stats{
		Expanded:                 12,
		AlreadyProcessed:         34,
		ProdAuditWarnings:        56,
		LodgingProdAuditWarnings: 78,
	}})

	if err := o.RunSingleSync(context.Background(), "svc"); err != nil {
		t.Fatalf("RunSingleSync: %v", err)
	}

	rec := waitForSyncRuns(t, app, 1)[0]
	for field, want := range map[string]int{
		"expanded_count":                    12,
		"already_processed_count":           34,
		"prod_audit_warnings_count":         56,
		"lodging_prod_audit_warnings_count": 78,
	} {
		if got := rec.GetInt(field); got != want {
			t.Errorf("%s = %d, want %d", field, got, want)
		}
	}
}

// TestSyncRunPersistsSubStats keeps the combined syncs legible. `persons` populates
// households too and reports it through SubStats; without the column, a household-only
// failure is a number with no home.
func TestSyncRunPersistsSubStats(t *testing.T) {
	t.Parallel()

	app := newSyncRunsApp(t)
	o := NewOrchestrator(app)
	o.RegisterService("persons", &MockService{name: "persons", stats: Stats{
		Created:  3,
		SubStats: map[string]Stats{"households": {Created: 9, Rejected: 2}},
	}})

	if err := o.RunSingleSync(context.Background(), "persons"); err != nil {
		t.Fatalf("RunSingleSync: %v", err)
	}

	rec := waitForSyncRuns(t, app, 1)[0]
	raw := rec.GetString("sub_stats")
	if !strings.Contains(raw, "households") {
		t.Errorf("sub_stats = %q, want it to name the households sub-entity", raw)
	}
	if !strings.Contains(raw, "9") {
		t.Errorf("sub_stats = %q, want it to carry the sub-entity counts", raw)
	}
}

// TestSyncRunPersistsFailure records the other half of the distribution. A failed run is the
// interesting one; dropping it would leave a table of successes.
func TestSyncRunPersistsFailure(t *testing.T) {
	t.Parallel()

	app := newSyncRunsApp(t)
	o := NewOrchestrator(app)
	// Errors are infrastructure failures — zero tolerance, so this run fails without the
	// service returning an error at all.
	o.RegisterService("svc", &MockService{name: "svc", stats: Stats{Created: 1, Errors: 3}})

	if err := o.RunSingleSync(context.Background(), "svc"); err != nil {
		t.Fatalf("RunSingleSync: %v", err)
	}

	rec := waitForSyncRuns(t, app, 1)[0]
	if got := rec.GetString("status"); got != statusFailed {
		t.Errorf("status = %q, want %q", got, statusFailed)
	}
	if got := rec.GetInt("errors_count"); got != 3 {
		t.Errorf("errors_count = %d, want 3", got)
	}
	if !strings.Contains(rec.GetString("error"), "3") {
		t.Errorf("error = %q, want it to carry the failure reason", rec.GetString("error"))
	}
}

// panicService panics instead of returning. A panicked sync is exactly the kind of run whose
// record you want afterwards, and the panic recovery is a fourth place a completed status is
// produced — routing it through the same store is what keeps it from being a silent gap.
type panicService struct{ name string }

func (p *panicService) Sync(context.Context) error { panic("boom") }
func (p *panicService) Name() string               { return p.name }
func (p *panicService) GetStats() Stats            { return Stats{} }

func TestSyncRunPersistsPanickedRun(t *testing.T) {
	t.Parallel()

	app := newSyncRunsApp(t)
	o := NewOrchestrator(app)
	o.RegisterService("svc", &panicService{name: "svc"})

	if err := o.RunSingleSync(context.Background(), "svc"); err != nil {
		t.Fatalf("RunSingleSync: %v", err)
	}

	rec := waitForSyncRuns(t, app, 1)[0]
	if got := rec.GetString("status"); got != statusFailed {
		t.Errorf("status = %q, want %q", got, statusFailed)
	}
	if !strings.Contains(rec.GetString("error"), "panic") {
		t.Errorf("error = %q, want it to name the panic", rec.GetString("error"))
	}
}

// TestSyncRunDefaultTriggerIsManual pins the fallback. A single service run with no queue
// around it was started by an operator, and recording it as anything else would corrupt the
// only field on this table that cannot be reconstructed afterwards.
func TestSyncRunDefaultTriggerIsManual(t *testing.T) {
	t.Parallel()

	app := newSyncRunsApp(t)
	o := NewOrchestrator(app)
	o.RegisterService("svc", &MockService{name: "svc"})

	if err := o.RunSingleSync(context.Background(), "svc"); err != nil {
		t.Fatalf("RunSingleSync: %v", err)
	}

	rec := waitForSyncRuns(t, app, 1)[0]
	if got := rec.GetString("trigger"); got != triggerManual {
		t.Errorf("trigger = %q, want %q", got, triggerManual)
	}
	if rec.GetString("batch_id") == "" {
		t.Error("batch_id is empty — an unbatched run is still a batch of one")
	}
}

// TestWeeklySyncRunsShareOneBatch is the grouping guard, driven end to end through a real
// queue. Every job of one nightly run has to be recoverable as one run; without a shared
// batch_id the table is a pile of unrelated rows and "how did last Sunday go" is
// unanswerable.
func TestWeeklySyncRunsShareOneBatch(t *testing.T) {
	t.Parallel()

	app := newSyncRunsApp(t)
	o := NewOrchestrator(app)
	o.SetJobSpacing(0)

	weekly := GetWeeklySyncJobs()
	for _, name := range weekly {
		o.RegisterService(name, &MockService{name: name})
	}

	if err := o.RunWeeklySync(context.Background()); err != nil {
		t.Fatalf("RunWeeklySync: %v", err)
	}

	recs := waitForSyncRuns(t, app, len(weekly))
	if len(recs) != len(weekly) {
		t.Fatalf("got %d rows, want %d", len(recs), len(weekly))
	}

	batch := recs[0].GetString("batch_id")
	if batch == "" {
		t.Fatal("batch_id is empty")
	}
	for _, rec := range recs {
		if got := rec.GetString("batch_id"); got != batch {
			t.Errorf("%s batch_id = %q, want %q — one queue is one batch",
				rec.GetString("service"), got, batch)
		}
		if got := rec.GetString("trigger"); got != triggerWeekly {
			t.Errorf("%s trigger = %q, want %q", rec.GetString("service"), got, triggerWeekly)
		}
	}
}

// TestHourlySyncRecordsHourlyTrigger covers the one trigger the orchestrator held no state
// for. The hourly cron is the highest-volume producer of these rows by a wide margin, so
// filing it as "manual" would drown the operator-initiated runs it is meant to be
// distinguished from.
func TestHourlySyncRecordsHourlyTrigger(t *testing.T) {
	t.Parallel()

	app := newSyncRunsApp(t)
	o := NewOrchestrator(app)
	o.RegisterService(hourlySyncJob, &MockService{name: hourlySyncJob})

	if err := o.RunHourlySync(context.Background()); err != nil {
		t.Fatalf("RunHourlySync: %v", err)
	}

	rec := waitForSyncRuns(t, app, 1)[0]
	if got := rec.GetString("trigger"); got != triggerHourly {
		t.Errorf("trigger = %q, want %q", got, triggerHourly)
	}
	if got := rec.GetString("service"); got != hourlySyncJob {
		t.Errorf("service = %q, want %q", got, hourlySyncJob)
	}
}

// TestBatchesAreSequentialNotNested corrects a false premise this file used to encode.
//
// The shared trigger/batch slot was justified by "these genuinely nest: RunDailySync calls
// RunWeeklySync first when the global tables are empty, and RunSyncWithOptions does the
// same". Neither nests. Both called RunWeeklySync *before* opening their own batch at the
// time -- the calls were at orchestrator.go's weekly-prologue and the batch was minted after
// it, and no nesting existed anywhere else in the tree either -- and both now call
// runGlobalTableBootstrap there instead (see its own doc comment for why: the bootstrap
// repairs the five global TABLES, not the weekly queue's membership, so it must not also
// export). The two queues are sequential, and each files its own jobs under its own trigger
// and its own batch id.
func TestBatchesAreSequentialNotNested(t *testing.T) {
	t.Parallel()

	app := newSyncRunsApp(t)
	o := NewOrchestrator(app)
	o.SetJobSpacing(0)

	weekly := GetWeeklySyncJobs()
	for _, name := range weekly {
		o.RegisterService(name, &MockService{name: name})
	}
	if err := o.RunWeeklySync(context.Background()); err != nil {
		t.Fatalf("RunWeeklySync: %v", err)
	}

	o.RegisterService(hourlySyncJob, &MockService{name: hourlySyncJob})
	if err := o.RunHourlySync(context.Background()); err != nil {
		t.Fatalf("RunHourlySync: %v", err)
	}

	recs := waitForSyncRuns(t, app, len(weekly)+1)

	batches := map[string]string{} // trigger -> batch id
	for _, rec := range recs {
		trigger, batch := rec.GetString("trigger"), rec.GetString("batch_id")
		if seen, ok := batches[trigger]; ok && seen != batch {
			t.Errorf("%s rows carry two batch ids, %q and %q — one queue is one batch",
				trigger, seen, batch)
		}
		batches[trigger] = batch
	}
	if batches[triggerWeekly] == "" {
		t.Error("no weekly rows")
	}
	if batches[triggerHourly] == "" {
		t.Error("no hourly row")
	}
	if batches[triggerWeekly] == batches[triggerHourly] {
		t.Error("the second queue reused the first queue's batch id")
	}
}

// TestSyncRunPruneDropsRowsPastRetention keeps the table bounded without a config knob. The
// prune lives in the write path, so a long-running deployment never accumulates unbounded
// telemetry and nothing has to be scheduled to make that true.
func TestSyncRunPruneDropsRowsPastRetention(t *testing.T) {
	t.Parallel()

	app := newSyncRunsApp(t)
	col, err := app.FindCollectionByNameOrId(syncRunsCollection)
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId: %v", err)
	}

	seed := func(service string, started time.Time) {
		t.Helper()
		rec := core.NewRecord(col)
		rec.Set("service", service)
		rec.Set("year", 2026)
		rec.Set("status", statusSuccess)
		rec.Set("trigger", triggerManual)
		rec.Set("batch_id", "seed")
		rec.Set("started", started)
		rec.Set("ended", started)
		if err := app.Save(rec); err != nil {
			t.Fatalf("seed %s: %v", service, err)
		}
	}

	now := time.Now()
	seed("ancient", now.AddDate(0, 0, -(SyncRunRetentionDays+5)))
	seed("recent", now.AddDate(0, 0, -(SyncRunRetentionDays-5)))

	o := NewOrchestrator(app)
	o.RegisterService("svc", &MockService{name: "svc"})
	if err := o.RunSingleSync(context.Background(), "svc"); err != nil {
		t.Fatalf("RunSingleSync: %v", err)
	}

	// Poll for the settled state rather than for a row count: the write inserts a third row
	// and the prune that follows it removes the first, so the count passes through 3 and
	// back to 2 without ever being observable at a fixed moment.
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		recs, err := app.FindAllRecords(syncRunsCollection)
		if err != nil {
			t.Fatalf("FindAllRecords: %v", err)
		}
		services := map[string]bool{}
		for _, rec := range recs {
			services[rec.GetString("service")] = true
		}
		if services["svc"] && !services["ancient"] {
			if !services["recent"] {
				t.Error("a row inside the retention window was pruned")
			}
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("timed out waiting for the prune to drop the out-of-retention row")
}

// TestSyncRunPruneCutoffUsesPocketBaseDateFormat guards a silent off-by-a-day.
//
// PocketBase stores dates as "2026-05-15 10:00:00.000Z" and SQLite compares the bound cutoff
// lexicographically. time.RFC3339 writes a `T` where PocketBase writes a space, and ' ' sorts
// before 'T' — so every row sharing the cutoff's calendar date compares less than the cutoff
// and is pruned up to a day early, whatever the time on it.
func TestSyncRunPruneCutoffUsesPocketBaseDateFormat(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 8, 13, 10, 0, 0, 0, time.UTC)
	got := syncRunPruneCutoff(now)
	want := "2026-05-15 10:00:00.000Z" // now - 90 days, in PocketBase's stored layout

	if got != want {
		t.Errorf("syncRunPruneCutoff = %q, want %q", got, want)
	}

	// The comparison the prune actually makes: a row written at the cutoff instant is inside
	// the window and must not sort below it.
	stored, err := types.ParseDateTime(now.AddDate(0, 0, -SyncRunRetentionDays))
	if err != nil {
		t.Fatalf("ParseDateTime: %v", err)
	}
	if stored.String() < got {
		t.Errorf("a row stored at the cutoff (%q) sorts below the cutoff (%q) — "+
			"the prune would delete rows still inside the retention window",
			stored.String(), got)
	}
}

// TestSyncRunTruncatesLongError guards the write itself. PocketBase rejects an over-cap text
// write rather than truncating it, so an unbounded error string does not produce a clipped
// row — it produces no row at all, losing the counters of the one run most worth keeping.
func TestSyncRunTruncatesLongError(t *testing.T) {
	t.Parallel()

	app := newSyncRunsApp(t)
	o := NewOrchestrator(app)
	o.RegisterService("svc", &MockService{name: "svc"})
	if err := o.MarkSyncRunning("svc"); err != nil {
		t.Fatalf("MarkSyncRunning: %v", err)
	}
	o.FinalizeSyncStatus("svc", Stats{}, &longError{n: maxSyncRunErrorLen * 2})

	rec := waitForSyncRuns(t, app, 1)[0]
	if got := len([]rune(rec.GetString("error"))); got != maxSyncRunErrorLen {
		t.Errorf("stored error is %d runes, want it truncated to %d", got, maxSyncRunErrorLen)
	}
}

// longError produces an error message of an arbitrary length without a megabyte literal.
type longError struct{ n int }

func (e *longError) Error() string { return strings.Repeat("é", e.n) }

// TestSyncRunPersistenceFailureDoesNotFailTheSync is the containment guard. This table is
// observability; a deployment whose sync_runs collection is missing must still run its syncs
// and still report their status honestly.
func TestSyncRunPersistenceFailureDoesNotFailTheSync(t *testing.T) {
	t.Parallel()

	app, err := tests.NewTestApp() // deliberately without the sync_runs collection
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)

	o := NewOrchestrator(app)
	o.RegisterService("svc", &MockService{name: "svc", stats: Stats{Created: 5}})
	if err := o.RunSingleSync(context.Background(), "svc"); err != nil {
		t.Fatalf("RunSingleSync: %v", err)
	}

	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		o.mu.RLock()
		status := o.lastCompletedStatus["svc"]
		o.mu.RUnlock()
		if status != nil {
			if status.Status != statusSuccess {
				t.Errorf("status = %q, want %q — a missing telemetry table must not fail a sync",
					status.Status, statusSuccess)
			}
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("timed out waiting for the run to complete")
}

// TestResolveRunYear covers the one field that cannot simply be copied across.
// sync_runs.year is required, and PocketBase's required check rejects 0 — which is precisely
// how the orchestrator spells "the current season".
func TestResolveRunYear(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name                             string
		statusYear, seasonYear, wallYear int
		want                             int
	}{
		{"historical run names its own year", 2019, 2026, 2027, 2019},
		{"current-season run falls back to the season", 0, 2026, 2027, 2026},
		{"unconfigured season falls back to the wall clock", 0, 0, 2027, 2027},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := resolveRunYear(tc.statusYear, tc.seasonYear, tc.wallYear); got != tc.want {
				t.Errorf("resolveRunYear(%d, %d, %d) = %d, want %d",
					tc.statusYear, tc.seasonYear, tc.wallYear, got, tc.want)
			}
		})
	}
}

// gateService blocks inside Sync until the test releases it, so a test can hold one batch
// open across another batch's whole lifetime. The cron schedule makes that overlap a
// certainty rather than a hazard — "0 * * * *" fires alongside "0 3 * * *" every day and
// alongside both "0 2 * * 0" and "0 4 * * 0" on Sunday — and robfig/cron runs every entry on
// its own goroutine.
type gateService struct {
	name    string
	entered chan struct{} // closed once Sync is running
	release chan struct{} // closed by the test to let Sync return
}

func newGateService(name string) *gateService {
	return &gateService{
		name:    name,
		entered: make(chan struct{}),
		release: make(chan struct{}),
	}
}

func (g *gateService) Sync(context.Context) error {
	close(g.entered)
	<-g.release
	return nil
}
func (g *gateService) Name() string    { return g.name }
func (g *gateService) GetStats() Stats { return Stats{} }

// TestConcurrentBatchesKeepTheirOwnOrigin is the guard for kindred#2297's review finding 1.
//
// The trigger and batch id used to live in a single pair of orchestrator fields that
// beginBatch saved and restored around a run. That is safe only if runs nest, and they do
// not: the four cron entries overlap by construction, three times a week at minimum and once
// every day. This test drives exactly that interleaving — the hourly batch opens first, the
// weekly batch opens inside it, and the hourly ends first, mid-weekly.
//
// A shared slot fails it three ways at once. The hourly's restore puts the slot back to the
// empty value it captured, so every weekly job after that point is filed as an unrelated
// manual run with a fresh batch id of its own; and the weekly's own restore then writes back
// the stale "hourly" it captured, leaving the orchestrator stuck reporting hourly for every
// run afterwards. It never self-heals.
func TestConcurrentBatchesKeepTheirOwnOrigin(t *testing.T) {
	t.Parallel()

	app := newSyncRunsApp(t)
	o := NewOrchestrator(app)
	o.SetJobSpacing(0)

	hourlyGate := newGateService(hourlySyncJob)
	o.RegisterService(hourlySyncJob, hourlyGate)

	weekly := GetWeeklySyncJobs()
	weeklyGate := newGateService(weekly[0])
	o.RegisterService(weekly[0], weeklyGate)
	for _, name := range weekly[1:] {
		o.RegisterService(name, &MockService{name: name})
	}

	hourlyDone := make(chan error, 1)
	go func() { hourlyDone <- o.RunHourlySync(context.Background()) }()
	<-hourlyGate.entered

	weeklyDone := make(chan error, 1)
	go func() { weeklyDone <- o.RunWeeklySync(context.Background()) }()
	<-weeklyGate.entered

	// The hourly finishes while the weekly is still working through its queue.
	close(hourlyGate.release)
	if err := <-hourlyDone; err != nil {
		t.Fatalf("RunHourlySync: %v", err)
	}
	close(weeklyGate.release)
	if err := <-weeklyDone; err != nil {
		t.Fatalf("RunWeeklySync: %v", err)
	}

	// One row per weekly job plus the hourly's.
	recs := waitForSyncRuns(t, app, len(weekly)+1)

	byService := map[string]*core.Record{}
	for _, rec := range recs {
		byService[rec.GetString("service")] = rec
	}

	hourlyRec := byService[hourlySyncJob]
	if hourlyRec == nil {
		t.Fatalf("no row for %s", hourlySyncJob)
	}
	if got := hourlyRec.GetString("trigger"); got != triggerHourly {
		t.Errorf("%s trigger = %q, want %q", hourlySyncJob, got, triggerHourly)
	}

	var weeklyBatch string
	for _, name := range weekly {
		rec := byService[name]
		if rec == nil {
			t.Fatalf("no row for weekly job %s", name)
		}
		if got := rec.GetString("trigger"); got != triggerWeekly {
			t.Errorf("%s trigger = %q, want %q — a concurrent batch overwrote it",
				name, got, triggerWeekly)
		}
		batch := rec.GetString("batch_id")
		if weeklyBatch == "" {
			weeklyBatch = batch
			continue
		}
		if batch != weeklyBatch {
			t.Errorf("%s batch_id = %q, want %q — one queue is one batch",
				name, batch, weeklyBatch)
		}
	}
	if weeklyBatch != "" && weeklyBatch == hourlyRec.GetString("batch_id") {
		t.Error("the hourly run and the weekly queue share a batch id — they are two runs")
	}

	// Both batches are over, so a plain single-service run is an operator's. A slot that is
	// restored rather than owned per run is left holding the last writer's trigger here.
	o.RegisterService("svc", &MockService{name: "svc"})
	if err := o.RunSingleSync(context.Background(), "svc"); err != nil {
		t.Fatalf("RunSingleSync: %v", err)
	}
	rec := waitForSyncRunByService(t, app, "svc")
	if got := rec.GetString("trigger"); got != triggerManual {
		t.Errorf("after both batches ended, trigger = %q, want %q — the shared slot never "+
			"recovered", got, triggerManual)
	}
}

// waitForSyncRunByService polls until a row exists for the given service and returns it.
func waitForSyncRunByService(t *testing.T, app core.App, service string) *core.Record {
	t.Helper()

	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		recs, err := app.FindAllRecords(syncRunsCollection)
		if err != nil {
			t.Fatalf("FindAllRecords(%s): %v", syncRunsCollection, err)
		}
		for _, rec := range recs {
			if rec.GetString("service") == service {
				return rec
			}
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for a %s row for %q", syncRunsCollection, service)
	return nil
}

// TestOperatorRunDuringABatchIsStillManual is the guard for review finding 3.
//
// `trigger` is the one column on this table that cannot be reconstructed after the fact, and
// the 3am sweep runs for the better part of an hour. An operator refreshing a single service
// at 03:05 must not have their run filed as part of that sweep, or the distinction the column
// exists for is exactly backwards for the runs most likely to be looked at.
func TestOperatorRunDuringABatchIsStillManual(t *testing.T) {
	t.Parallel()

	app := newSyncRunsApp(t)
	o := NewOrchestrator(app)
	o.SetJobSpacing(0)

	weekly := GetWeeklySyncJobs()
	weeklyGate := newGateService(weekly[0])
	o.RegisterService(weekly[0], weeklyGate)
	for _, name := range weekly[1:] {
		o.RegisterService(name, &MockService{name: name})
	}
	o.RegisterService("svc", &MockService{name: "svc"})

	weeklyDone := make(chan error, 1)
	go func() { weeklyDone <- o.RunWeeklySync(context.Background()) }()
	<-weeklyGate.entered

	// The operator's run, started while the sweep holds the queue open.
	if err := o.RunSingleSync(context.Background(), "svc"); err != nil {
		t.Fatalf("RunSingleSync: %v", err)
	}
	rec := waitForSyncRunByService(t, app, "svc")
	if got := rec.GetString("trigger"); got != triggerManual {
		t.Errorf("trigger = %q, want %q — an operator's run was filed as the sweep's",
			got, triggerManual)
	}

	close(weeklyGate.release)
	if err := <-weeklyDone; err != nil {
		t.Fatalf("RunWeeklySync: %v", err)
	}
}

// TestFinalizeSyncStatusPublishesAtomically is the guard for review finding 2.
//
// Splitting the completion into two critical sections opened a window in which a sync is
// neither in runningJobs nor in lastCompletedStatus. That is not just an odd read: it is
// exactly the state in which MarkSyncRunning succeeds — IsRunning is already false — and
// installs a *new* Status for the same service, which the second, unconditional
// delete(runningJobs, ...) then erases. That run becomes invisible; its own
// FinalizeSyncStatus finds no entry, returns early, and it never reaches sync_runs at all.
//
// The reader below is guaranteed to observe the window if there is one. sync.RWMutex releases
// every reader parked on RLock before it lets another writer in, and a writer re-acquiring
// must then wait for those readers to drain — so a reader parked when the first section
// unlocks reads the maps inside the gap, before the second section can close it.
func TestFinalizeSyncStatusPublishesAtomically(t *testing.T) {
	t.Parallel()

	o := NewOrchestrator(nil) // no app: this is about the maps, not the row

	// A fresh service per round: lastCompletedStatus being empty is the signal, so a
	// previous round's completion must not be sitting in it.
	for i := range 50 {
		syncType := fmt.Sprintf("svc%d", i)
		o.RegisterService(syncType, &MockService{name: syncType})
		if err := o.MarkSyncRunning(syncType); err != nil {
			t.Fatalf("round %d: MarkSyncRunning: %v", i, err)
		}

		gap := make(chan struct{}, 1)
		stop := make(chan struct{})
		done := make(chan struct{})
		go func() {
			defer close(done)
			sawRunning := false
			for {
				o.mu.RLock()
				_, running := o.runningJobs[syncType]
				completed := o.lastCompletedStatus[syncType]
				o.mu.RUnlock()

				switch {
				case running:
					sawRunning = true
				case !sawRunning:
					// The finalize has not started yet.
				case completed == nil:
					gap <- struct{}{}
					return
				default:
					return // the transition was atomic
				}

				select {
				case <-stop:
					return
				default:
				}
			}
		}()

		time.Sleep(time.Millisecond) // let the reader reach a steady spin
		o.FinalizeSyncStatus(syncType, Stats{}, nil)
		close(stop)
		<-done

		select {
		case <-gap:
			t.Fatalf("round %d: a reader saw %q neither running nor completed. "+
				"MarkSyncRunning succeeds in that window and installs a new Status, which "+
				"the second delete(runningJobs) then erases — that run never gets a "+
				"sync_runs row", i, syncType)
		default:
		}
	}
}

// TestSyncRunYearComesFromTheRunNotTheProcess is the guard for review finding 4.
//
// o.currentSyncYear is process-global and RunSyncWithOptions holds it at the backfill's year
// for the whole duration of a historical sync. The hourly cron fires every hour regardless, so
// a backfill of 2019 running across the hour used to stamp 2019 onto a run that read this
// season's data.
func TestSyncRunYearComesFromTheRunNotTheProcess(t *testing.T) {
	t.Parallel()

	app := newSyncRunsApp(t)
	o := NewOrchestrator(app)
	o.RegisterService(hourlySyncJob, &MockService{name: hourlySyncJob})

	// Stand in for a historical backfill holding the process-global year.
	o.mu.Lock()
	o.currentSyncYear = 2019
	o.mu.Unlock()

	if err := o.RunHourlySync(context.Background()); err != nil {
		t.Fatalf("RunHourlySync: %v", err)
	}

	rec := waitForSyncRunByService(t, app, hourlySyncJob)
	if got := rec.GetInt("year"); got == 2019 {
		t.Error("year = 2019 — the hourly run adopted a concurrent backfill's year")
	}
}

// TestSyncRunPruneKeepsRowsWithNoStartTime is the guard for review finding 12.
//
// `started` is NOT NULL DEFAULT ” and SQLite evaluates ” < <cutoff> as true, so a filter of
// "started < {:cutoff}" matches every row with no start time whatever its age. The write path
// always sets `started`, so nothing reaches that state today — but the filter has to say what
// it means, or the first row that does gets deleted on the next write with no trace.
func TestSyncRunPruneKeepsRowsWithNoStartTime(t *testing.T) {
	t.Parallel()

	app := newSyncRunsApp(t)
	col, err := app.FindCollectionByNameOrId(syncRunsCollection)
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId: %v", err)
	}

	rec := core.NewRecord(col)
	rec.Set("service", "no_start_time")
	rec.Set("year", 2026)
	rec.Set("status", statusSuccess)
	rec.Set("trigger", triggerManual)
	rec.Set("batch_id", "seed")
	if err := app.Save(rec); err != nil {
		t.Fatalf("seed row without started: %v", err)
	}

	o := NewOrchestrator(app)
	o.RegisterService("svc", &MockService{name: "svc"})
	if err := o.RunSingleSync(context.Background(), "svc"); err != nil {
		t.Fatalf("RunSingleSync: %v", err)
	}
	waitForSyncRunByService(t, app, "svc") // the write, and the prune that follows it, are done

	if _, err := app.FindRecordById(syncRunsCollection, rec.Id); err != nil {
		t.Errorf("the row with no start time was pruned: %v", err)
	}
}

// TestSyncRunsFixtureMatchesMigration is the guard for review finding 6.
//
// newSyncRunsApp hand-mirrors pb_migrations/1500000152_sync_runs.js because PocketBase's JS
// migrations do not run under `go test`. A comment asking the next person to keep the two in
// step is not a mechanism: a column dropped from the migration but left in the fixture keeps
// the whole suite green while every production write of it is rejected, and a column added to
// the migration is never exercised at all.
func TestSyncRunsFixtureMatchesMigration(t *testing.T) {
	t.Parallel()

	app := newSyncRunsApp(t)
	col, err := app.FindCollectionByNameOrId(syncRunsCollection)
	if err != nil {
		t.Fatalf("FindCollectionByNameOrId: %v", err)
	}

	fixture := map[string]string{}
	for _, f := range col.Fields {
		if f.GetName() == "id" {
			continue // PocketBase's own, not declared by either side
		}
		fixture[f.GetName()] = f.Type()
	}

	migration := migrationFields(t)

	for name, typ := range migration {
		got, ok := fixture[name]
		if !ok {
			t.Errorf("migration declares %q (%s) and the Go fixture does not — every test "+
				"in this file runs against a schema production does not have", name, typ)
			continue
		}
		if got != typ {
			t.Errorf("%q is %s in the migration and %s in the Go fixture", name, typ, got)
		}
	}
	for name, typ := range fixture {
		if _, ok := migration[name]; !ok {
			t.Errorf("the Go fixture declares %q (%s) and the migration does not — writes to "+
				"it pass here and are rejected in production", name, typ)
		}
	}
}

// migrationFields parses the sync_runs migrations' field declarations into name -> type.
// Every field on either side is written `type: "..."` then `name: "..."`, which is what this
// relies on; a field that breaks the convention shows up as a missing name and fails the
// comparison rather than being skipped silently.
//
// TWO SHAPES, because the collection is created by one migration and extended by later ones.
// The CREATE migration (*_sync_runs.js) declares its fields inside `fields: [ ... ]`, and
// everything outside that array — the indexes, the down function — must stay out of the
// parse. An ALTER migration (*_sync_runs_*.js, e.g. 1500000175's `session`) declares one
// field per `new Field({...})` with no array to bound, so its whole source is read.
//
// The union is what the fixture is compared against, because the fixture mirrors the schema
// production ENDS UP with, not the one it started at. A future ALTER that REMOVES a column
// would therefore need handling here — this parser only ever adds.
func migrationFields(t *testing.T) map[string]string {
	t.Helper()

	matches, err := filepath.Glob("../pb_migrations/*_sync_runs*.js")
	if err != nil || len(matches) == 0 {
		t.Fatalf("found no sync_runs migrations (err %v)", err)
	}

	re := regexp.MustCompile(`type:\s*"(\w+)",\s*\n\s*name:\s*"(\w+)"`)
	declared := map[string]string{}
	created := 0

	for _, path := range matches {
		body, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %s: %v", path, err)
		}
		src := string(body)

		if strings.HasSuffix(path, "_sync_runs.js") {
			created++
			from := strings.Index(src, "fields: [")
			to := strings.Index(src, "indexes: [")
			if from < 0 || to < from {
				t.Fatalf("could not find the fields array in %s", path)
			}
			src = src[from:to]
		}

		for _, m := range re.FindAllStringSubmatch(src, -1) {
			declared[m[2]] = m[1]
		}
	}

	if created != 1 {
		t.Fatalf("expected exactly one CREATE migration among %v, found %d", matches, created)
	}
	if len(declared) == 0 {
		t.Fatalf("parsed no fields out of %v — the parser, not the schema, is what broke",
			matches)
	}
	return declared
}

// TestSyncRunsMigrationLimitsMatchTheWriter pins the three limits the Go side depends on. A
// text field's max is enforced by rejecting the write, not by truncating it, so a migration
// that drifts below maxSyncRunErrorLen loses whole rows rather than clipping a message; and a
// trigger value the select does not list is rejected the same way.
func TestSyncRunsMigrationLimitsMatchTheWriter(t *testing.T) {
	t.Parallel()

	matches, err := filepath.Glob("../pb_migrations/*_sync_runs.js")
	if err != nil || len(matches) != 1 {
		t.Fatalf("expected exactly one sync_runs migration, found %v (err %v)", matches, err)
	}
	body, err := os.ReadFile(matches[0])
	if err != nil {
		t.Fatalf("read %s: %v", matches[0], err)
	}
	src := string(body)

	if want := fmt.Sprintf("max: %d", maxSyncRunErrorLen); !strings.Contains(src, want) {
		t.Errorf("the migration does not declare %q — the error column and "+
			"maxSyncRunErrorLen have drifted, so an over-cap message loses the whole row", want)
	}

	for _, trigger := range []string{
		triggerHourly, triggerDaily, triggerWeekly,
		triggerCustomValues, triggerHistorical, triggerManual,
	} {
		if !strings.Contains(src, `"`+trigger+`"`) {
			t.Errorf("the migration's trigger select does not list %q — every run carrying "+
				"it is rejected", trigger)
		}
	}

	// The column range must strictly contain the range the sync layer accepts, or a year the
	// handler allows silently drops every row of its run.
	if !strings.Contains(src, "min: 2000") || !strings.Contains(src, "max: 2100") {
		t.Error("the year column's bounds moved; check they still contain " +
			"syncYearMin..syncYearMax before updating this test")
	}
	if syncYearMin < 2000 || syncYearMax > 2100 {
		t.Errorf("sync layer accepts %d-%d, outside the year column's 2000-2100",
			syncYearMin, syncYearMax)
	}
}

// TestValidSyncYearRejectsOutOfRange is the guard for review finding 7. The unified sync
// handler accepted any year from 2017 up, so ?year=99999 was a 200 whose every row then
// failed the column's max check and was swallowed — a green sync and an empty table.
func TestValidSyncYearRejectsOutOfRange(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		year int
		want bool
	}{
		{2016, false},
		{2017, true},
		{2026, true},
		{2050, true},
		{2051, false},
		{99999, false},
	} {
		if got := ValidSyncYear(tc.year); got != tc.want {
			t.Errorf("ValidSyncYear(%d) = %v, want %v", tc.year, got, tc.want)
		}
	}
}

// TestSnapshotStatusSharesNoMutableMemory is the guard for review finding 8. The completed
// Status is published into lastCompletedStatus, where other goroutines can reach it, while
// the snapshot travels on to the sync_runs write. A plain struct copy leaves the two sharing
// Summary.SubStats and EndTime.
func TestSnapshotStatusSharesNoMutableMemory(t *testing.T) {
	t.Parallel()

	end := time.Now()
	original := &Status{
		Type:    "persons",
		EndTime: &end,
		Summary: Stats{Created: 3, SubStats: map[string]Stats{"households": {Created: 9}}},
	}

	snap := snapshotStatus(original)

	original.Summary.SubStats["households"] = Stats{Created: 999}
	original.Summary.SubStats["injected"] = Stats{Created: 1}
	want := end
	*original.EndTime = end.Add(time.Hour)

	if got := snap.Summary.SubStats["households"].Created; got != 9 {
		t.Errorf("SubStats[households].Created = %d, want 9 — the snapshot aliases the map", got)
	}
	if _, ok := snap.Summary.SubStats["injected"]; ok {
		t.Error("a key added to the published Status appeared in the snapshot")
	}
	if !snap.EndTime.Equal(want) {
		t.Errorf("EndTime = %v, want %v — the snapshot aliases the pointer", snap.EndTime, want)
	}
}

// TestYearTakingHandlersPassTheirYear closes the gap the finding-2 fix would otherwise leave.
//
// RunSingleSyncWithService now takes the year, but nothing at the orchestrator level can see
// whether the eleven handlers actually pass it — dropping `.forYear(year)` from all of them
// still compiles and still passes every behavioral test. This walks api.go instead: any
// handler that parses a ?year= and then starts a run must file that run under it.
func TestYearTakingHandlersPassTheirYear(t *testing.T) {
	t.Parallel()

	body, err := os.ReadFile("api.go")
	if err != nil {
		t.Fatalf("read api.go: %v", err)
	}

	const call = "RunSingleSyncWithService("
	checked := 0
	for _, fn := range strings.Split(string(body), "\nfunc ") {
		if !strings.Contains(fn, call) {
			continue
		}
		name, _, _ := strings.Cut(fn, "(")
		parsesYear := strings.Contains(fn, "year, err := strconv.Atoi(yearParam)")
		passesYear := strings.Contains(fn, ".forYear(year)")

		switch {
		case parsesYear && !passesYear:
			t.Errorf("%s parses a ?year= and starts a run without forYear(year) — the "+
				"service reads that year and the sync_runs row claims the current season",
				name)
		case !parsesYear && passesYear:
			t.Errorf("%s passes forYear(year) but parses no year parameter", name)
		}
		checked++
	}

	// A rename that stops matching would otherwise make this test vacuously green.
	if checked < 12 {
		t.Errorf("only %d handlers matched %q; the call was renamed or moved, so this guard "+
			"stopped covering the rest", checked, call)
	}
}

// --- The READ half of kindred#2284 -------------------------------------------------------
//
// This file's header records why the table exists: lastCompletedStatus "was an in-memory map
// wiped on every container restart". The table fixed the WRITE side. Nothing wired the READ
// side back, so `GET /api/custom/sync/status` still answered purely from the in-memory map
// and reported every service `idle` after a restart, with the history sitting in the table.
// The app shell's freshness lines ("Assignments synced …" on summer, "Housing synced …" on
// weekend) render off `end_time`, so they vanished until the next sync repopulated memory.
// Observed on a dev worktree: a successful lodging_assignments run from the previous day, and
// the endpoint still answered `{"status": "idle"}` for it.

// TestLastRecordedRunsSurvivesRestart is the core guard: a fresh Orchestrator over an app
// that already holds history answers from the table, not with nothing.
func TestLastRecordedRunsSurvivesRestart(t *testing.T) {
	t.Parallel()

	app := newSyncRunsApp(t)
	o := NewOrchestrator(app)
	o.RegisterService("lodging_assignments", &MockService{
		name: "lodging_assignments", stats: Stats{Created: 4, Updated: 2},
	})

	if err := o.RunSingleSync(context.Background(), "lodging_assignments"); err != nil {
		t.Fatalf("RunSingleSync: %v", err)
	}
	waitForSyncRuns(t, app, 1)

	// The restart: a brand-new Orchestrator over the same app. Its in-memory maps are empty,
	// exactly as they are the moment the container comes back up.
	restarted := NewOrchestrator(app)
	if got := restarted.GetStatus("lodging_assignments"); got != nil {
		t.Fatalf("GetStatus after restart = %+v, want nil — this test's premise is that memory is empty", got)
	}

	got, ok := restarted.LastRecordedRuns()["lodging_assignments"]
	if !ok {
		t.Fatal("no entry for lodging_assignments — the freshness line stays blank after every restart")
	}
	if got.Status != statusSuccess {
		t.Errorf("Status = %q, want %q", got.Status, statusSuccess)
	}
	if got.EndTime == nil || got.EndTime.IsZero() {
		t.Error("EndTime is nil/zero — this is the field the freshness lines render, so a nil here IS the bug")
	}
	if got.Summary.Created != 4 || got.Summary.Updated != 2 {
		t.Errorf("Summary = %+v, want Created=4 Updated=2", got.Summary)
	}
}

// TestLastRecordedRunsRestoresSubStats: `persons` is a combined sync that also populates
// households and reports that half through SubStats. Restoring the parent's counters while
// dropping the nested ones rehydrates half a summary — the sub-entity reads zero, which is
// the shape of the bug kindred#2284 exists to prevent, one layer down.
func TestLastRecordedRunsRestoresSubStats(t *testing.T) {
	t.Parallel()

	app := newSyncRunsApp(t)
	o := NewOrchestrator(app)
	o.RegisterService("persons", &MockService{name: "persons", stats: Stats{
		Created:  3,
		SubStats: map[string]Stats{"households": {Created: 9, Rejected: 2}},
	}})
	if err := o.RunSingleSync(context.Background(), "persons"); err != nil {
		t.Fatalf("RunSingleSync: %v", err)
	}
	waitForSyncRuns(t, app, 1)

	got, ok := NewOrchestrator(app).LastRecordedRuns()["persons"]
	if !ok {
		t.Fatal("no entry for persons")
	}
	sub, ok := got.Summary.SubStats["households"]
	if !ok {
		t.Fatalf("SubStats = %+v, want a households entry restored from sync_runs", got.Summary.SubStats)
	}
	if sub.Created != 9 || sub.Rejected != 2 {
		t.Errorf("households SubStats = %+v, want Created=9 Rejected=2", sub)
	}
}

// TestLastRecordedRunsIgnoresAFailedNewerRun is the reason the query filters on success.
//
// The caller renders "<noun> synced {N} ago" off EndTime. A nightly run that FAILED at 02:00,
// followed by a restart, followed by staff opening the app at 09:00, must not report the data
// as seven hours fresh — it never arrived. The honest answer is the older successful run.
func TestLastRecordedRunsIgnoresAFailedNewerRun(t *testing.T) {
	t.Parallel()

	app := newSyncRunsApp(t)
	col, err := app.FindCollectionByNameOrId(syncRunsCollection)
	if err != nil {
		t.Fatalf("find collection: %v", err)
	}

	older := time.Now().Add(-24 * time.Hour)
	newer := time.Now().Add(-2 * time.Hour)
	for _, row := range []struct {
		status string
		at     time.Time
	}{
		{statusSuccess, older},
		{statusFailed, newer},
	} {
		rec := core.NewRecord(col)
		rec.Set("service", "lodging_assignments")
		rec.Set("year", 2026)
		rec.Set("status", row.status)
		rec.Set("trigger", triggerDaily)
		rec.Set("batch_id", "b-"+row.status)
		rec.Set("started", row.at)
		rec.Set("ended", row.at)
		if err := app.Save(rec); err != nil {
			t.Fatalf("save %s row: %v", row.status, err)
		}
	}

	got, ok := NewOrchestrator(app).LastRecordedRuns()["lodging_assignments"]
	if !ok {
		t.Fatal("no entry for lodging_assignments — the older SUCCESSFUL run should still answer")
	}
	if got.Status != statusSuccess {
		t.Errorf("Status = %q, want %q — a failed run must not be reported as freshness", got.Status, statusSuccess)
	}
	if got.EndTime == nil {
		t.Fatal("EndTime is nil")
	}
	if got.EndTime.After(newer.Add(-time.Minute)) {
		t.Errorf("EndTime = %s, want the OLDER successful run (~%s) — the failed 02:00 run won and the "+
			"line would claim the data is two hours fresh when it never arrived", got.EndTime, older)
	}
}

// TestLastRecordedRunsTakesTheMostRecentRow: a service runs many times, and the freshness
// line must read the newest run, not whichever row the query happened to return first.
func TestLastRecordedRunsTakesTheMostRecentRow(t *testing.T) {
	t.Parallel()

	app := newSyncRunsApp(t)
	o := NewOrchestrator(app)
	o.RegisterService("bunk_assignments", &MockService{name: "bunk_assignments", stats: Stats{Created: 1}})
	if err := o.RunSingleSync(context.Background(), "bunk_assignments"); err != nil {
		t.Fatalf("first run: %v", err)
	}
	waitForSyncRuns(t, app, 1)

	o.RegisterService("bunk_assignments", &MockService{name: "bunk_assignments", stats: Stats{Created: 99}})
	if err := o.RunSingleSync(context.Background(), "bunk_assignments"); err != nil {
		t.Fatalf("second run: %v", err)
	}
	waitForSyncRuns(t, app, 2)

	got, ok := NewOrchestrator(app).LastRecordedRuns()["bunk_assignments"]
	if !ok {
		t.Fatal("no entry for bunk_assignments")
	}
	if got.Summary.Created != 99 {
		t.Errorf("Created = %d, want 99 — an older row won over the newest", got.Summary.Created)
	}
}

// TestLastRecordedRunsNeverReportsInFlight is a safety guard, not a nicety. The client polls
// every 3 s for as long as ANY service reports running or pending, and stops otherwise. A
// rehydrated status claiming "running" for a run that ended before the restart would poll
// forever against a job that can never complete.
func TestLastRecordedRunsNeverReportsInFlight(t *testing.T) {
	t.Parallel()

	app := newSyncRunsApp(t)
	col, err := app.FindCollectionByNameOrId(syncRunsCollection)
	if err != nil {
		t.Fatalf("find collection: %v", err)
	}
	// A row left behind by a process killed mid-run is the realistic way this arises. The
	// collection's own select field rejects a non-terminal value, so the guard is exercised
	// through rehydratedStatus directly as well as through the query below.
	rec := core.NewRecord(col)
	rec.Set("service", "persons")
	rec.Set("year", 2026)
	rec.Set("status", statusFailed)
	rec.Set("trigger", triggerManual)
	rec.Set("batch_id", "b1")
	rec.Set("started", time.Now().Add(-time.Hour))
	rec.Set("ended", time.Now().Add(-time.Hour))
	if err := app.Save(rec); err != nil {
		t.Fatalf("save row: %v", err)
	}

	for name, status := range NewOrchestrator(app).LastRecordedRuns() {
		if status.Status == statusRunning || status.Status == statusPending {
			t.Errorf("%s rehydrated as %q — the client would poll forever", name, status.Status)
		}
	}

	for _, stored := range []string{statusRunning, statusPending, ""} {
		if got := rehydratedStatus(stored); got == statusRunning || got == statusPending {
			t.Errorf("rehydratedStatus(%q) = %q, want a terminal status", stored, got)
		}
	}
}

// TestResolveServiceStatusesPrefersLiveState pins the merge the handler performs: live
// orchestrator state wins, the table fills the gaps, and a service with neither stays idle.
func TestResolveServiceStatusesPrefersLiveState(t *testing.T) {
	t.Parallel()

	app := newSyncRunsApp(t)
	o := NewOrchestrator(app)
	o.RegisterService("persons", &MockService{name: "persons", stats: Stats{Created: 3}})
	if err := o.RunSingleSync(context.Background(), "persons"); err != nil {
		t.Fatalf("RunSingleSync: %v", err)
	}
	waitForSyncRuns(t, app, 1)

	// The restart, with `persons` now RUNNING again. Live and recorded must be
	// distinguishable or this pins nothing: the table can only ever hold the completed run,
	// so `running` is the one state that proves which source won.
	restarted := NewOrchestrator(app)
	restarted.RegisterService("persons", &MockService{name: "persons"})
	if err := restarted.MarkSyncRunning("persons"); err != nil {
		t.Fatalf("MarkSyncRunning: %v", err)
	}

	got := resolveServiceStatuses(restarted, []string{"persons", "staff"})

	live, ok := got["persons"].(*Status)
	if !ok {
		t.Fatalf("persons = %T, want the live *Status from memory", got["persons"])
	}
	if live.Status != statusRunning {
		t.Errorf("persons status = %q, want %q — the completed row in sync_runs masked the run "+
			"happening right now, which also stops the client polling for its completion", live.Status, statusRunning)
	}

	idle, ok := got["staff"].(map[string]string)
	if !ok {
		t.Fatalf("staff = %#v, want the idle map — a service that never ran must stay idle", got["staff"])
	}
	if idle["status"] != "idle" {
		t.Errorf("staff status = %q, want idle", idle["status"])
	}
}

// TestResolveServiceStatusesUsesHistoryAfterRestart is the end-to-end shape of the defect:
// the handler's own merge, over an orchestrator whose memory is empty.
func TestResolveServiceStatusesUsesHistoryAfterRestart(t *testing.T) {
	t.Parallel()

	app := newSyncRunsApp(t)
	o := NewOrchestrator(app)
	o.RegisterService("lodging_assignments", &MockService{name: "lodging_assignments"})
	if err := o.RunSingleSync(context.Background(), "lodging_assignments"); err != nil {
		t.Fatalf("RunSingleSync: %v", err)
	}
	waitForSyncRuns(t, app, 1)

	got := resolveServiceStatuses(NewOrchestrator(app), []string{"lodging_assignments"})

	status, ok := got["lodging_assignments"].(*Status)
	if !ok {
		t.Fatalf("lodging_assignments = %#v, want a *Status rehydrated from sync_runs "+
			"— an idle map here is the bug", got["lodging_assignments"])
	}
	if status.EndTime == nil {
		t.Error("EndTime is nil — the freshness line renders off this field and would show nothing")
	}
}

// ── The weekend a run was started for (kindred#2617) ─────────────────────────────────────
//
// Status.Session shipped in kindred#2601 as an IN-MEMORY answer to "is the run I can see
// mine?", and that is enough while the run is live. It is not enough afterwards: the status
// payload keeps one slot per job, so a press scoped to weekend A overwrites the nightly cron
// run that covered weekend B, and B's freshness becomes unanswerable rather than merely old.
//
// Persisting the session is what turns "the last run of this job" into "the last run that
// COVERED this weekend" — a query the API can answer per weekend, because sync_runs keeps the
// history the single in-memory slot cannot.

// TestSyncRunPersistsTheSessionItWasStartedFor is the write half. Without it the column is
// always empty, every stored run reads as unscoped, and the per-weekend query silently
// answers "the cron covered you" for a press that covered one weekend.
func TestSyncRunPersistsTheSessionItWasStartedFor(t *testing.T) {
	t.Parallel()

	const jobID = "household_custom_values_family_camp"
	app := newSyncRunsApp(t)
	o := NewOrchestrator(app)
	o.RegisterService(jobID, &MockService{name: jobID})

	if err := o.RunSyncSequenceWithServices(
		context.Background(), []string{jobID}, nil, "1000001",
	); err != nil {
		t.Fatalf("RunSyncSequenceWithServices: %v", err)
	}

	recs := waitForSyncRuns(t, app, 1)
	if got := recs[0].GetString("session"); got != "1000001" {
		t.Errorf("session = %q, want %q — a scoped press stored as unscoped claims it "+
			"refreshed every weekend", got, "1000001")
	}
}

// TestSyncRunLeavesSessionEmptyForAnUnscopedRun pins the other half of the vocabulary, and it
// is the one that is easy to get backwards. EMPTY MEANS EVERY WEEKEND, not "unknown": the
// nightly cron genuinely refreshes the whole family-camp cohort, so a run that names no
// weekend must store no weekend — inventing one here would take the cron out of every
// weekend's readout at once.
func TestSyncRunLeavesSessionEmptyForAnUnscopedRun(t *testing.T) {
	t.Parallel()

	app := newSyncRunsApp(t)
	o := NewOrchestrator(app)
	o.RegisterService("lodging_assignments", &MockService{name: "lodging_assignments"})

	if err := o.RunSingleSync(context.Background(), "lodging_assignments"); err != nil {
		t.Fatalf("RunSingleSync: %v", err)
	}

	recs := waitForSyncRuns(t, app, 1)
	if got := recs[0].GetString("session"); got != "" {
		t.Errorf("session = %q, want empty — an unscoped run filed under a weekend stops "+
			"covering the other eleven", got)
	}
}

// TestLastRecordedRunsRehydratesTheSession is the read half, and it closes the gap the column
// would otherwise open across a restart: `session` would be present on a live run and absent
// on a rehydrated one, so the same field would mean "this weekend only" before a deploy and
// "every weekend" after it. That is worse than not storing it at all, because runBelongsHere
// and the freshness query both read an absent session as MATCHING.
func TestLastRecordedRunsRehydratesTheSession(t *testing.T) {
	t.Parallel()

	const jobID = "household_custom_values_family_camp"
	app := newSyncRunsApp(t)
	o := NewOrchestrator(app)
	o.RegisterService(jobID, &MockService{name: jobID})

	if err := o.RunSyncSequenceWithServices(
		context.Background(), []string{jobID}, nil, "1000001",
	); err != nil {
		t.Fatalf("RunSyncSequenceWithServices: %v", err)
	}
	waitForSyncRuns(t, app, 1)

	got, ok := NewOrchestrator(app).LastRecordedRuns()[jobID]
	if !ok {
		t.Fatalf("no entry for %s", jobID)
	}
	if got.Session != "1000001" {
		t.Errorf("Session = %q, want %q — a rehydrated scoped run that reports no weekend "+
			"is read as having covered them all", got.Session, "1000001")
	}
}

// TestSyncRunStoresAllAsUnscoped pins the vocabulary collapse in runOrigin.forSession.
//
// The sync-service vocabulary normalises the OTHER way — normalizeSession turns "" into
// "all" — so a caller may legitimately hand the refresh handler either spelling for "the
// whole cohort", and TestRefreshFamilyCampOverridesEmptyForWholeCohort pins that the two
// produce the same run. Once the value is stored and queried as
// `session = "" || session = <weekend>`, an "all" surviving into the column would read as a
// run scoped to a weekend named "all": it would match no weekend, so an unscoped press would
// take every weekend's freshness readout SILENT instead of refreshing all of them.
func TestSyncRunStoresAllAsUnscoped(t *testing.T) {
	t.Parallel()

	const jobID = "household_custom_values_family_camp"
	app := newSyncRunsApp(t)
	o := NewOrchestrator(app)
	o.RegisterService(jobID, &MockService{name: jobID})

	if err := o.RunSyncSequenceWithServices(
		context.Background(), []string{jobID}, nil, DefaultSession,
	); err != nil {
		t.Fatalf("RunSyncSequenceWithServices: %v", err)
	}

	recs := waitForSyncRuns(t, app, 1)
	if got := recs[0].GetString("session"); got != "" {
		t.Errorf("session = %q after a %q press, want empty — %q is the whole cohort, and "+
			"stored verbatim it matches no weekend at all", got, DefaultSession, DefaultSession)
	}
}

// TestSyncRunStoresACanonicalSessionID pins the other half of the vocabulary collapse.
//
// Same class as TestSyncRunStoresAllAsUnscoped above, and the same consequence: the stored
// value is queried by EXACT MATCH against `strconv.Itoa(cm_id)` on the API side, so any
// spelling of a weekend that is not its canonical decimal form matches nothing and takes that
// weekend's freshness silent — the exact silence kindred#2617 exists to remove.
//
// `IsValidSession` accepts "0100001" (it parses), and no UI path can produce it because
// frontend/src/services/sync.ts builds the parameter from a JS number. So this is a guard on
// the hand-crafted request rather than a live defect, and it belongs HERE rather than at the
// handler because this is where the vocabulary is defined.
//
// NON-NUMERIC SESSIONS PASS THROUGH UNTOUCHED. Summer's session identifiers are "2a", "toc"
// and friends; a numeric round-trip must not eat them, even though no current caller of
// forSession passes one.
func TestSyncRunStoresACanonicalSessionID(t *testing.T) {
	t.Parallel()

	const jobID = "household_custom_values_family_camp"
	app := newSyncRunsApp(t)
	o := NewOrchestrator(app)
	o.RegisterService(jobID, &MockService{name: jobID})

	if err := o.RunSyncSequenceWithServices(
		context.Background(), []string{jobID}, nil, "0100001",
	); err != nil {
		t.Fatalf("RunSyncSequenceWithServices: %v", err)
	}

	recs := waitForSyncRuns(t, app, 1)
	if got := recs[0].GetString("session"); got != "100001" {
		t.Errorf("session = %q, want %q -- a non-canonical id is queried by exact match "+
			"against the weekend's decimal cm_id, so it matches no weekend at all", got, "100001")
	}
}

// TestForSessionKeepsANonNumericSession is the other side of that guard, at the unit level:
// the canonicalisation must be a no-op for a session identifier that is not a number.
func TestForSessionKeepsANonNumericSession(t *testing.T) {
	t.Parallel()

	for _, session := range []string{"2a", "toc", "3b"} {
		if got := newBatch(triggerManual).forSession(session).session; got != session {
			t.Errorf("forSession(%q).session = %q, want it unchanged -- a numeric round-trip "+
				"must not eat a summer session identifier", session, got)
		}
	}
}
