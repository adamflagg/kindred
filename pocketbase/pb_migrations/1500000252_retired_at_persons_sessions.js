/// <reference path="../pb_data/types.d.ts" />
/**
 * persons.retired_at and camp_sessions.retired_at: when the nightly sweep found that CampMinder no
 * longer returns the row for its season. Empty means live.
 *
 * The sweeps used to DELETE such rows, and a delete takes or blanks every link to them (a persons
 * delete blanked staff.person, which then collided on UNIQUE(year, person)). Owner ruling OD-05 = B
 * (and PM-7 = A): keep the record so staff can look back, so the sweep now stamps this field
 * instead and the row keeps every link. A later sync that sees the row again clears it.
 *
 * Additive and nullable. No backfill: rows deleted before this migration are gone, and every live
 * row is correctly not retired.
 */
migrate(
  (app) => {
    for (const name of ["persons", "camp_sessions"]) {
      const collection = app.findCollectionByNameOrId(name)
      collection.fields.add(
        new Field({ type: "date", name: "retired_at", required: false, presentable: false, min: "", max: "" })
      )
      app.save(collection)
    }
  },
  (app) => {
    for (const name of ["persons", "camp_sessions"]) {
      const collection = app.findCollectionByNameOrId(name)
      collection.fields.removeByName("retired_at")
      app.save(collection)
    }
  }
)
