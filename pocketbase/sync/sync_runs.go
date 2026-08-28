package sync

import (
	"log/slog"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

// This file persists one row per completed sync run to the `sync_runs` collection.
//
// It exists because of the decision on kindred#2284. Stats.Rejected — a per-record transform
// failure, upstream data quality rather than a local fault — is warn-only for its first
// season *specifically so a real distribution can be collected and a threshold set from
// evidence later*. That is only true if the numbers survive: before this, the orchestrator's
// lastCompletedStatus was an in-memory map wiped on every container restart, and no table
// recorded sync history at all.
//
// One table, not one per job type. Every job — CampMinder API syncs, custom-value syncs,
// internal transforms, the request processor — satisfies the same three-method Service
// interface and returns the same Stats struct. The job-type distinction is a *scheduling*
// one; there is no kind/category concept anywhere in this package. Stats already carries the
// job-type-specific counters as omitempty fields, and the columns mirror that exactly.
//
// The rule for what gets a column is: store what cannot be reconstructed, derive what can.
// So there is deliberately no `kind` column — `household_demographics` is always a transform
// and `bunks` is always an API sync, so storing it would duplicate a static fact and create a
// second place for it to be wrong. `trigger` gets a column for the opposite reason: nothing
// in a finished row says whether it came from the 3am cron or an operator pressing a button.

const (
	// syncRunsCollection holds one row per completed run.
	// Schema: pb_migrations/1500000152_sync_runs.js.
	syncRunsCollection = "sync_runs"

	// SyncRunRetentionDays is how long a row is kept before the write path prunes it.
	//
	// Hardcoded rather than a `config` table knob, matching LogRetentionDays above it: this
	// is infrastructure retention, not a business rule anyone should be tuning from a GUI.
	//
	// The window is sized from real volume. The hourly cron runs a single service, the 3am
	// daily sweeps ~26, and two small weeklies run on Sunday — roughly 100 rows a day, so 90
	// days is about 9,000 rows. That spans a whole summer season plus the shoulder either
	// side, which is the period the Rejected distribution has to be read over.
	SyncRunRetentionDays = 90

	// maxSyncRunErrorLen caps the stored error message, in runes, and matches the `error`
	// field's declared max in the migration.
	//
	// The write path truncates to it rather than trusting the message to be short.
	// PocketBase *rejects* an over-cap text write instead of truncating it, so an unusually
	// long message — an errors.Join of many failures, say — would not produce a clipped row,
	// it would produce no row at all. That loses the counters of exactly the run most worth
	// keeping.
	maxSyncRunErrorLen = 20000

	// syncRunPruneBatch caps how many out-of-retention rows a single write may delete.
	//
	// The prune runs on every write, which sounds excessive and is not: on an indexed
	// `started` column it returns nothing on all but the first write of the day. The cap is
	// there for the other case — a deployment that has been down long enough to accumulate a
	// backlog converges over several runs instead of stalling one sync behind a huge delete.
	syncRunPruneBatch = 500
)

// recordSyncRun persists one completed run.
//
// Every failure here is logged and swallowed. This table is observability for a warn-only
// counter, and a sync that ran correctly must not be reported as failed because its telemetry
// row could not be written — by this point the run's own stats are final and could not absorb
// the failure anyway.
func (o *Orchestrator) recordSyncRun(completed *Status) {
	if o.app == nil {
		return
	}

	col, err := o.app.FindCollectionByNameOrId(syncRunsCollection)
	if err != nil {
		slog.Warn("sync_runs collection unavailable, run not recorded",
			"syncType", completed.Type, "error", err)
		return
	}

	// Only consulted when the run does not name its own year: resolveRunYear discards the
	// season outright whenever Year > 0, and ParseSeasonYear reads the environment on every
	// write for a value that is then thrown away.
	seasonYear := 0
	if completed.Year == 0 {
		var seasonErr error
		if seasonYear, seasonErr = ParseSeasonYear(); seasonErr != nil {
			slog.Warn("Recording sync run against the wall-clock year",
				"syncType", completed.Type, "error", seasonErr)
		}
	}

	stats := completed.Summary

	rec := core.NewRecord(col)
	rec.Set("service", completed.Type)
	rec.Set("year", resolveRunYear(completed.Year, seasonYear, time.Now().Year()))
	rec.Set("status", completed.Status)
	rec.Set("trigger", completed.Trigger)
	rec.Set("batch_id", completed.BatchID)
	rec.Set("created_count", stats.Created)
	rec.Set("updated_count", stats.Updated)
	rec.Set("deleted_count", stats.Deleted)
	rec.Set("skipped_count", stats.Skipped)
	rec.Set("errors_count", stats.Errors)
	rec.Set("rejected_count", stats.Rejected)
	rec.Set("expanded_count", stats.Expanded)
	rec.Set("already_processed_count", stats.AlreadyProcessed)
	rec.Set("prod_audit_warnings_count", stats.ProdAuditWarnings)
	rec.Set("lodging_prod_audit_warnings_count", stats.LodgingProdAuditWarnings)
	rec.Set("duration", stats.Duration)
	rec.Set("started", completed.StartTime)
	if completed.EndTime != nil {
		rec.Set("ended", *completed.EndTime)
	}
	rec.Set("error", truncateRunes(completed.Error, maxSyncRunErrorLen))
	if len(stats.SubStats) > 0 {
		rec.Set("sub_stats", stats.SubStats)
	}

	if err := o.app.Save(rec); err != nil {
		slog.Error("Failed to record sync run", "syncType", completed.Type, "error", err)
		return
	}

	// Deliberately no forceWALCheckpoint here, and this is a judgment call rather than an
	// exemption the existing rule already grants. pocketbase/CLAUDE.md § "Sync invariants" 4
	// requires one after database modifications in the Go sync layer and excuses only
	// migrations; its rationale (main.go:372) is durability across a docker stop/start, not
	// reader visibility.
	//
	// The call: this table is orchestrator telemetry, read weeks later to fit a threshold,
	// and the whole write path already swallows its own failures for that reason. Losing the
	// last few rows to an unclean shutdown costs a handful of points on a distribution of
	// thousands, against a wal_checkpoint(FULL) on every one of ~100 writes a day. The
	// exception is recorded in pocketbase/CLAUDE.md so this reads as a decision and not an
	// omission — if that entry goes, this comment is wrong and the checkpoint belongs here.
	o.pruneSyncRuns()
}

// pruneSyncRuns deletes rows whose run started before the retention cutoff.
//
// It lives in the write path rather than on the scheduler so that retention holds without
// anything having to be scheduled — a deployment that never runs the daily cron still cannot
// grow this table without bound.
func (o *Orchestrator) pruneSyncRuns() {
	cutoff := syncRunPruneCutoff(time.Now())

	// `started != ''` is not redundant. The column is NOT NULL DEFAULT '' and SQLite
	// compares '' as less than any date string, so "started < cutoff" on its own also
	// matches every row with no start time, at any age. The write path always sets it, so
	// nothing reaches that state today — but the filter has to say what it means, or the
	// first row that does is deleted on the next write with nothing to show for it.
	stale, err := o.app.FindRecordsByFilter(
		syncRunsCollection,
		"started != '' && started < {:cutoff}",
		"started",
		syncRunPruneBatch,
		0,
		dbx.Params{"cutoff": cutoff},
	)
	if err != nil {
		slog.Warn("Failed to scan sync_runs for pruning", "cutoff", cutoff, "error", err)
		return
	}
	if len(stale) == 0 {
		return
	}

	deleted := 0
	for _, rec := range stale {
		if err := o.app.Delete(rec); err != nil {
			slog.Warn("Failed to prune sync_run", "recordId", rec.Id, "error", err)
			continue
		}
		deleted++
	}

	slog.Info("Pruned old sync runs",
		"deleted", deleted, "found", len(stale), "retentionDays", SyncRunRetentionDays)
}

// syncRunPruneCutoff renders the retention cutoff in the layout PocketBase stores dates in.
//
// The filter binds this as a string and SQLite compares it lexicographically, so the layout is
// load-bearing rather than cosmetic. PocketBase writes "2026-05-15 10:00:00.000Z"; time.RFC3339
// writes a `T` where that has a space, and ' ' sorts before 'T' — so an RFC3339 cutoff makes
// every row sharing its calendar date compare less than it, pruning up to a day early
// regardless of the time on those rows.
func syncRunPruneCutoff(now time.Time) string {
	// types.DefaultDateLayout is exactly what DateTime.String() formats with, so this cannot
	// drift from what the writes produce.
	return now.AddDate(0, 0, -SyncRunRetentionDays).UTC().Format(types.DefaultDateLayout)
}

// resolveRunYear picks the year a persisted run is filed under.
//
// sync_runs.year is a required PocketBase number field, and PocketBase's required check
// rejects 0 (core/field_number.go, ValidateValue) — which is exactly how the orchestrator
// spells "the current season" on Status.Year. So the value has to be resolved rather than
// copied.
//
// Order: the run's own year, since a historical sync names its year explicitly; then the
// configured season; then the wall clock. The last is a guess and the caller logs when it is
// reached, but losing the row outright would be worse for a table whose only job is to
// accumulate a distribution.
//
// The season and wall-clock years are passed in rather than read here so this stays a pure
// function. Reading CAMPMINDER_SEASON_ID inside it would force every test that touches it to
// t.Setenv, and the package's parallelism guard (pocketbase/main_test_parallelism_test.go)
// exists to stop that spreading.
func resolveRunYear(statusYear, seasonYear, wallClockYear int) int {
	if statusYear > 0 {
		return statusYear
	}
	if seasonYear > 0 {
		return seasonYear
	}
	return wallClockYear
}

// truncateRunes clips s to at most n runes. Runes, not bytes, because that is what
// PocketBase's text field measures (utf8.RuneCountInString in TextField.ValidateValue) — a
// byte-wise cut would both under-fill the field and risk splitting a multi-byte character.
func truncateRunes(s string, n int) string {
	runes := []rune(s)
	if len(runes) <= n {
		return s
	}
	return string(runes[:n])
}

// syncRunRow is one `sync_runs` row, scanned raw.
//
// Dates are scanned as strings rather than types.DateTime: the column is text and a row
// carrying "" for `ended` is not something a date scanner accepts. Parsing per row lets an
// unparseable value degrade to "no end time" instead of failing the whole query — the same
// posture recordSyncRun takes on the write side.
type syncRunRow struct {
	Service                  string `db:"service"`
	Status                   string `db:"status"`
	Started                  string `db:"started"`
	Ended                    string `db:"ended"`
	Error                    string `db:"error"`
	Year                     int    `db:"year"`
	Trigger                  string `db:"trigger"`
	BatchID                  string `db:"batch_id"`
	Created                  int    `db:"created_count"`
	Updated                  int    `db:"updated_count"`
	Deleted                  int    `db:"deleted_count"`
	Skipped                  int    `db:"skipped_count"`
	Errors                   int    `db:"errors_count"`
	Rejected                 int    `db:"rejected_count"`
	Expanded                 int    `db:"expanded_count"`
	AlreadyProcessed         int    `db:"already_processed_count"`
	ProdAuditWarnings        int    `db:"prod_audit_warnings_count"`
	LodgingProdAuditWarnings int    `db:"lodging_prod_audit_warnings_count"`
	Duration                 int    `db:"duration"`
}

// LastRecordedRuns returns the most recent recorded run per service, as Status values.
//
// THIS IS THE READ HALF OF kindred#2284, and it was missing. This file's header says the
// table exists because lastCompletedStatus "was an in-memory map wiped on every container
// restart" — but only the WRITE side was ever wired up. `GET /api/custom/sync/status` still
// answered purely from that map, so after any restart it reported every service `idle` with a
// full history sitting in the table. The app shell's freshness lines render off `end_time`
// ("Assignments synced …" on summer, "Housing synced …" on weekend), so they did not go
// stale — they DISAPPEARED, until the next sync repopulated memory. For a mid-morning deploy
// that means the 3am cron the following night.
//
// ONE QUERY, not one per service. The status endpoint asks about ~32 services and is polled
// every 3 s while any sync runs, so a per-service lookup would be 32 round trips a tick.
//
// Deliberately NOT called from GetStatus. That is on the hot path — runSyncAndWait polls it
// in a loop — and putting a query behind it would turn a mutex read into database traffic.
// The handler prefetches this once per request instead and fills its own gaps.
//
// Failure is logged and swallowed, matching recordSyncRun: this is a freshness readout, and a
// telemetry query that cannot run must not take the status endpoint down with it. The caller
// gets an empty map and falls back to `idle`, which is exactly the old behaviour.
func (o *Orchestrator) LastRecordedRuns() map[string]*Status {
	out := make(map[string]*Status)
	if o.app == nil {
		return out
	}

	// ROW_NUMBER over (service ORDER BY started DESC) rather than a bare GROUP BY: SQLite's
	// bare-column-with-max() extension would also work, but it is a SQLite-specific guarantee
	// that silently returns an arbitrary row if the aggregate is ever changed. `id DESC`
	// breaks the tie for two rows sharing a `started` — stored timestamps are millisecond
	// precision and a fast transform can produce two within one.
	var rows []syncRunRow
	query := o.app.DB().NewQuery(`
		SELECT service, status, started, ended, error, year, trigger, batch_id,
		       created_count, updated_count, deleted_count, skipped_count, errors_count,
		       rejected_count, expanded_count, already_processed_count,
		       prod_audit_warnings_count, lodging_prod_audit_warnings_count, duration
		FROM (
			SELECT *, ROW_NUMBER() OVER (PARTITION BY service ORDER BY started DESC, id DESC) AS rn
			FROM ` + syncRunsCollection + `
		)
		WHERE rn = 1`)
	if err := query.All(&rows); err != nil {
		slog.Warn("Failed to read sync_runs history; status falls back to idle", "error", err)
		return out
	}

	for _, row := range rows {
		status := &Status{
			Type:    row.Service,
			Status:  rehydratedStatus(row.Status),
			Error:   row.Error,
			Year:    row.Year,
			Trigger: row.Trigger,
			BatchID: row.BatchID,
			Summary: Stats{
				Created:                  row.Created,
				Updated:                  row.Updated,
				Deleted:                  row.Deleted,
				Skipped:                  row.Skipped,
				Errors:                   row.Errors,
				Rejected:                 row.Rejected,
				Expanded:                 row.Expanded,
				AlreadyProcessed:         row.AlreadyProcessed,
				ProdAuditWarnings:        row.ProdAuditWarnings,
				LodgingProdAuditWarnings: row.LodgingProdAuditWarnings,
				Duration:                 row.Duration,
			},
		}
		if started, err := types.ParseDateTime(row.Started); err == nil && !started.IsZero() {
			status.StartTime = started.Time()
		}
		if ended, err := types.ParseDateTime(row.Ended); err == nil && !ended.IsZero() {
			at := ended.Time()
			status.EndTime = &at
		}
		out[row.Service] = status
	}

	return out
}

// rehydratedStatus maps a stored status onto one safe to publish for a run that is over.
//
// A row can only be written by publishCompletedLocked, so in practice this is already
// terminal — but a process killed mid-write, or a future path that records differently, must
// not be able to resurrect a job as in-flight. The client polls every 3 s for as long as ANY
// service reads `running` or `pending` and stops otherwise, so a rehydrated "running" would
// poll forever against a job that ended before the restart and can never complete.
//
// Anything non-terminal is reported as failed rather than success: the run did not finish,
// and the honest reading of a half-written row is that it did not work.
func rehydratedStatus(stored string) string {
	switch stored {
	case statusRunning, statusPending, "":
		return statusFailed
	default:
		return stored
	}
}
