/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Drop the redundant `source` field from `bunk_requests`.
 *
 * `RequestSource` (FAMILY/STAFF) is a deterministic 6→2 projection of
 * `source_field` and is now derived at every read site via the
 * `source_from_field()` helper. The column adds no information.
 *
 * Stage 4 of #1142.
 */

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId("bunk_requests");

    // Drop the standalone idx_bunk_requests_source index that referenced the column.
    // The composite idx_bunk_requests_unique_with_source uses source_field, not source,
    // so it stays untouched.
    collection.indexes = collection.indexes.filter(
      (idx) => !/idx_bunk_requests_source\b/.test(idx)
    );

    if (collection.fields.getByName("source")) {
      collection.fields.removeByName("source");
      app.save(collection);
      console.log("[migration #1142 stage 4] dropped bunk_requests.source field and idx_bunk_requests_source index");
    } else {
      app.save(collection);
      console.log("[migration #1142 stage 4] bunk_requests.source field already absent (index drop only)");
    }
  },
  (app) => {
    // Rollback: re-add the source field as a 2-value select, restore the index, backfill.
    const collection = app.findCollectionByNameOrId("bunk_requests");
    if (collection.fields.getByName("source")) {
      console.log("[migration #1142 stage 4 rollback] source field already present (no-op)");
      return;
    }

    collection.fields.add(new Field({
      type: "select",
      name: "source",
      required: false,
      presentable: false,
      maxSelect: 1,
      values: ["family", "staff"]
    }));

    if (!collection.indexes.some((idx) => /idx_bunk_requests_source\b/.test(idx))) {
      collection.indexes.push("CREATE INDEX idx_bunk_requests_source ON bunk_requests (source)");
    }

    app.save(collection);

    const db = app.db();
    db.newQuery(`
      UPDATE bunk_requests
      SET source = CASE
        WHEN source_field IN ('bunk_with', 'socialize_with') THEN 'family'
        WHEN source_field IN ('not_bunk_with', 'bunking_notes', 'internal_notes', 'manual') THEN 'staff'
        ELSE 'family'
      END
    `).execute();

    console.log("[migration #1142 stage 4 rollback] re-added source field, restored index, and backfilled from source_field");
  }
);
