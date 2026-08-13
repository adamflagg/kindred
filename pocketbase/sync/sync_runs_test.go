package sync

import (
	"context"
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

// TestNestedBatchRestoresTheOuterBatch guards a real nesting: RunDailySync calls
// RunWeeklySync first when the global tables are empty. If the inner batch cleared the
// state instead of restoring it, every job after that point in the nightly run would be
// filed as an unrelated manual run.
func TestNestedBatchRestoresTheOuterBatch(t *testing.T) {
	t.Parallel()

	o := NewOrchestrator(nil)

	endOuter := o.beginBatch(triggerDaily)
	outerTrigger, outerBatch := o.runOrigin()

	endInner := o.beginBatch(triggerWeekly)
	innerTrigger, innerBatch := o.runOrigin()
	if innerTrigger != triggerWeekly {
		t.Errorf("inner trigger = %q, want %q", innerTrigger, triggerWeekly)
	}
	if innerBatch == outerBatch {
		t.Error("inner batch reused the outer batch id — the two runs are not one run")
	}
	endInner()

	gotTrigger, gotBatch := o.runOrigin()
	if gotTrigger != outerTrigger || gotBatch != outerBatch {
		t.Errorf("after the inner batch ended: trigger/batch = %q/%q, want %q/%q",
			gotTrigger, gotBatch, outerTrigger, outerBatch)
	}
	endOuter()

	if trigger, _ := o.runOrigin(); trigger != triggerManual {
		t.Errorf("with no batch in progress trigger = %q, want %q", trigger, triggerManual)
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
