/// <reference path="../pb_data/types.d.ts" />
/**
 * persons.retired_at: when the nightly sweep found that CampMinder no longer returns a person who
 * has a staff record that season. Empty means live.
 *
 * The persons sweep used to DELETE such a row, and the delete blanked staff.person, which then
 * collided on staff's UNIQUE(year, person) (bug B1). Owner ruling OD-05 = B (PM-7 = A) keeps staff
 * records to look back at; owner ruling C (2026-10-26) narrows the retire to staff-linked persons
 * for now, so the sweep stamps this field instead and the row keeps its staff link. A later sync
 * that sees the person again clears it. Every other person, and camp_sessions, is still deleted:
 * retiring them waits on what staff should see for a retired row (OD-08).
 *
 * Additive and nullable. No backfill: rows deleted before this migration are gone, and every live
 * row is correctly not retired.
 */
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId("persons")
    collection.fields.add(
      new Field({ type: "date", name: "retired_at", required: false, presentable: false, min: "", max: "" })
    )
    app.save(collection)
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("persons")
    collection.fields.removeByName("retired_at")
    app.save(collection)
  }
)
