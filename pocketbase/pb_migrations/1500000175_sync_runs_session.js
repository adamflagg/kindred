/// <reference path="../pb_data/types.d.ts" />
/**
 * sync_runs.session — the weekend a run was started for.
 *
 * ── WHY A COLUMN ────────────────────────────────────────────────────────────
 *
 * kindred#2601 gave a run an in-memory `Status.Session` so a weekend surface
 * could ask "is the run I can see mine?". That answers a question about a LIVE
 * run, and the status payload keeps exactly ONE slot per job — so the moment a
 * press scoped to weekend A lands, the nightly cron run that covered weekend B
 * is gone from memory, and B's "Housing synced …" line has nothing left to
 * date itself from. Both surfaces went silent there rather than lying, which
 * was the right call and is still an absence.
 *
 * `sync_runs` already keeps ninety days of run history. Storing the session on
 * the row turns "the last run of this job" into "the last run that COVERED
 * this weekend" — `session = '' OR session = <weekend>`, a query the API
 * answers per weekend (kindred#2617).
 *
 * ── EMPTY MEANS EVERY WEEKEND, NOT "UNKNOWN" ────────────────────────────────
 *
 * The nightly cron refreshes the whole family-camp cohort and names no
 * weekend, so an absent session is a POSITIVE claim: this run covered you.
 * A consumer reading it as "not mine" would silently stop the cron driving any
 * weekend's readout — which is why `runOrigin.forSession` collapses the
 * "all" spelling to empty before it ever reaches this column, and why the Go
 * reader COALESCEs a NULL to the same value.
 *
 * ── NO BACKFILL, AND NOTHING TO BACK FILL WITH ──────────────────────────────
 *
 * Every existing row predates scoping — kindred#2601 shipped the ability to
 * scope a press at all — so each one genuinely DID cover every weekend, and
 * empty is not a gap in them but the correct value. A backfill could only
 * invent a weekend that no run was narrowed to.
 *
 * ── NO INDEX ────────────────────────────────────────────────────────────────
 *
 * The freshness read filters `service` + `status` + `year` first, which
 * `idx_sync_runs_service_started` already serves; what survives that is one
 * job's runs over the retention window — order tens of rows, on a table sized
 * at roughly 100 rows a day for 90 days. An index on a column that is empty on
 * the overwhelming majority of rows would cost writes to save nothing.
 *
 * `max: 100` matches `service` and `batch_id`. A session is a decimal
 * CampMinder id; the width is the table's convention for a short identifier,
 * not a measurement.
 *
 * PocketBase v0.23 syntax: fields.add(new Field({...})) on an existing
 * collection, properties DIRECT rather than inside options{} — an options
 * wrapper is ignored without error. addField() is a no-op when the column
 * already exists, because PocketBase records an applied migration by FILENAME:
 * a later edit to this file would never re-run on a database that has already
 * seen it, and `Set` on a missing column is a silent no-op that never
 * persists.
 */

/**
 * Adds a field unless the collection already has one by that name.
 * @param {core.Collection} collection
 * @param {core.Field} field
 */
function addField(collection, field) {
  if (!collection.fields.getByName(field.name)) {
    collection.fields.add(field);
  }
}

migrate((app) => {
  const collection = app.findCollectionByNameOrId("sync_runs");
  addField(collection, new Field({
    type: "text",
    name: "session",
    required: false,
    presentable: false,
    min: 0,
    max: 100,
    pattern: ""
  }));
  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("sync_runs");
  collection.fields.removeByName("session");
  app.save(collection);
});
