/// <reference path="../pb_data/types.d.ts" />

/**
 * Migration: Rename snapshot_date → snapshot_datetime in enrollment_snapshots
 *
 * Stores actual UTC timestamps instead of truncated midnight dates.
 * This allows multiple snapshots per day (manual runs add data instead
 * of overwriting) and supports precise camp-day boundary alignment.
 *
 * Existing data retains midnight-truncated values — still valid for
 * Python camp-date mapping.
 */
migrate((app) => {
  const collection = app.findCollectionByNameOrId("enrollment_snapshots");

  // Remove old indexes (filter by index name to catch all, including
  // idx_enrollment_snapshots_year_session which doesn't mention snapshot_date)
  collection.indexes = collection.indexes.filter(
    (idx) =>
      !idx.includes("idx_enrollment_snapshots_unique") &&
      !idx.includes("idx_enrollment_snapshots_year_session")
  );

  // Rename field: snapshot_date → snapshot_datetime
  const field = collection.fields.getByName("snapshot_date");
  if (field) {
    field.name = "snapshot_datetime";
  }

  // Add new indexes with snapshot_datetime
  collection.indexes.push(
    "CREATE UNIQUE INDEX idx_enrollment_snapshots_unique ON enrollment_snapshots(snapshot_datetime, session_cm_id, year)"
  );
  collection.indexes.push(
    "CREATE INDEX idx_enrollment_snapshots_year_session ON enrollment_snapshots(year, session_cm_id)"
  );

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("enrollment_snapshots");

  // Remove new indexes (filter by index name to catch all)
  collection.indexes = collection.indexes.filter(
    (idx) =>
      !idx.includes("idx_enrollment_snapshots_unique") &&
      !idx.includes("idx_enrollment_snapshots_year_session")
  );

  // Rename field back: snapshot_datetime → snapshot_date
  const field = collection.fields.getByName("snapshot_datetime");
  if (field) {
    field.name = "snapshot_date";
  }

  // Restore old indexes
  collection.indexes.push(
    "CREATE UNIQUE INDEX idx_enrollment_snapshots_unique ON enrollment_snapshots(snapshot_date, session_cm_id, year)"
  );
  collection.indexes.push(
    "CREATE INDEX idx_enrollment_snapshots_year_session ON enrollment_snapshots(year, session_cm_id)"
  );

  app.save(collection);
});
