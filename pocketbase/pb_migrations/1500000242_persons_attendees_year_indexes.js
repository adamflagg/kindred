/// <reference path="../pb_data/types.d.ts" />
/**
 * Year-first indexes for the Camperships layer-1 reads (`year = Y` slices of persons and attendees),
 * which today scan all 28,720 persons / 36,878 attendees because neither table has an index that
 * starts with year. Additive only.
 *
 * Not redundant with idx_persons_campminder (cm_id, year) or idx_attendees_unique
 * (person_id, year, session): neither of those leads with `year`, so a `year = ?` filter cannot seek them.
 *
 * Matched by name, not full SQL: up strips any same-named index before adding, so a partial apply
 * followed by a re-run cannot leave two entries; down removes by name for the same reason.
 */

const INDEXES = [
  {
    collection: 'persons',
    name: 'idx_persons_year_household_id',
    sql: 'CREATE INDEX `idx_persons_year_household_id` ON `persons` (`year`, `household_id`)',
  },
  {
    collection: 'attendees',
    name: 'idx_attendees_year_status_id',
    sql: 'CREATE INDEX `idx_attendees_year_status_id` ON `attendees` (`year`, `status_id`)',
  },
]

/**
 * @param {core.Collection} collection
 * @param {string} name
 */
function withoutIndex(collection, name) {
  collection.indexes = collection.indexes.filter(function (existing) {
    return existing.indexOf('`' + name + '`') === -1
  })
}

migrate(
  (app) => {
    for (const idx of INDEXES) {
      const collection = app.findCollectionByNameOrId(idx.collection)
      withoutIndex(collection, idx.name)
      collection.indexes.push(idx.sql)
      app.save(collection)
    }
  },
  (app) => {
    for (const idx of INDEXES) {
      const collection = app.findCollectionByNameOrId(idx.collection)
      withoutIndex(collection, idx.name)
      app.save(collection)
    }
  }
)
