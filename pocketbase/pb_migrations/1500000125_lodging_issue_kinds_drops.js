/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: two more lodging_ingest_issues.kind values, for the drops the
 * ingest could previously only log.
 *
 * lodging_ingest_issues.kind is a SELECT, so PocketBase rejects any value not
 * listed here -- the Go constants in lodging_issues.go are not the constraint,
 * this list is. Spec 6.2 ("every historical value must resolve to a unit or
 * appear in an unresolved-alias report. Zero silent drops") needs both:
 *
 * - unknown_party: the household or person row the custom value hangs off does
 *   not exist for the sync year, so there is no CampMinder id to key a
 *   placement on. The ingest counted the value before discovering this, which
 *   means it also suppressed the field_zero_values warning -- the observation
 *   was invisible in every direction.
 *
 * - write_failed: the value resolved and attributed cleanly, then the write
 *   lost. Stats.Errors and a log line carried it, but Stats is never persisted
 *   and logs rotate, so by morning the value was accounted for nowhere.
 *
 * Both are year-scoped like every other kind and dedup on the same six columns
 * (idx_lodging_issues_dedup, migration 1500000122), so a backfill hitting the
 * same broken household 400 times still queues one row.
 *
 * PocketBase v0.23 syntax: mutate the existing field in place and save. There
 * is no fields.add() here -- the field already exists and re-adding it would
 * drop the stored values.
 */

const kindsBefore = [
  "unresolved_alias",
  "ambiguous_alias",
  "ambiguous_session",
  "no_session",
  "field_zero_values"
];

const kindsAfter = kindsBefore.concat(["unknown_party", "write_failed"]);

migrate((app) => {
  const col = app.findCollectionByNameOrId("lodging_ingest_issues");
  const kind = col.fields.getByName("kind");
  if (!kind) {
    throw new Error('lodging_ingest_issues: expected an existing "kind" select field');
  }
  kind.values = kindsAfter;
  app.save(col);
}, (app) => {
  // Rows carrying a kind this migration introduced would fail validation against
  // the narrowed list, so they go first. Deleting them is correct rather than
  // lossy: down-migrating means reverting to an ingest that never produced them.
  const doomed = app.findRecordsByFilter(
    "lodging_ingest_issues",
    'kind = "unknown_party" || kind = "write_failed"',
    "", 0, 0
  );
  for (const rec of doomed) {
    app.delete(rec);
  }

  const col = app.findCollectionByNameOrId("lodging_ingest_issues");
  const kind = col.fields.getByName("kind");
  if (!kind) {
    throw new Error('lodging_ingest_issues: expected an existing "kind" select field');
  }
  kind.values = kindsBefore;
  app.save(col);
});
