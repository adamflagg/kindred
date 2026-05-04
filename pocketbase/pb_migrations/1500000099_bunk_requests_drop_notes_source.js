/// <reference path="../pb_data/types.d.ts" />

/**
 * Migration: Drop unreachable 'notes' value from bunk_requests.source select field.
 *
 * The openai_provider already maps incoming 'notes' → RequestSource.STAFF before
 * writing, so the value 'notes' can never persist in production data (issue #1102).
 * This migration removes it from the schema to enforce that invariant.
 *
 * Any rows with source = 'notes' are backfilled to 'staff' before the schema change.
 *
 * Dependencies: 1500000018_bunk_requests.js
 */

migrate(
  (app) => {
    const db = app.db()

    // Backfill any lingering 'notes' rows to 'staff'. In practice this count
    // should be zero — the AI provider maps notes → staff before write — but we
    // apply the backfill defensively so the migration is safe on any DB state.
    db.newQuery("UPDATE bunk_requests SET source = 'staff' WHERE source = 'notes'").execute()
    console.log("[migration #1102] backfilled bunk_requests rows from source='notes' to source='staff' (no-op on clean DBs)")

    const collection = app.findCollectionByNameOrId("bunk_requests")

    const field = collection.fields.getByName("source")
    if (field) {
      field.values = ["family", "staff"]
    }

    app.save(collection)
  },
  (app) => {
    // Rollback: restore 'notes' as a permitted value.
    const collection = app.findCollectionByNameOrId("bunk_requests")

    const field = collection.fields.getByName("source")
    if (field) {
      field.values = ["family", "staff", "notes"]
    }

    app.save(collection)
  }
)
