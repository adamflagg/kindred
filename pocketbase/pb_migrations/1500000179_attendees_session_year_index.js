/// <reference path="../pb_data/types.d.ts" />
/**
 * Index `attendees` on (session, year). kindred#2803, item B.
 *
 * The family weekend landing (`/api/lodging/summary`) reads each weekend's
 * attendees with `session = "<id>" && year = <year> && status_id = 2`, sorted
 * by id -- twelve reads per load. The table carried only `(person)` and the
 * unique `(person_id, year, session)`, neither of which can seek on `session`,
 * so SQLite walked the whole table (36,839 rows on the production snapshot) in
 * id order for every one of them: 25-37 ms of raw SQL each, under 0.5 ms with
 * this index. The summer board's `session.cm_id = N && year = Y` reads join
 * through the same column and benefit too.
 *
 * ADDITIVE ONLY. It adds a non-unique index and touches no field and no row, so
 * it cannot refuse existing data and changes no read's result -- only its plan.
 * `main_attendees_session_year_index_test.go` pins that the planner picks it
 * for the repository's filter, and that the pre-migration indexes do not.
 *
 * Idempotent by NAME, for the reason 1500000165 gives: `_migrations` keys on
 * filename so this never re-runs on its own, but a partial apply must not leave
 * two entries under one name.
 */

const COLLECTION = 'attendees'
const INDEX_NAME = 'idx_attendees_session_year'
const INDEX_SQL = 'CREATE INDEX `idx_attendees_session_year` ON `attendees` (`session`, `year`)'

/**
 * @param {core.Collection} collection
 */
function withoutIndex(collection) {
  collection.indexes = collection.indexes.filter(function (existing) {
    return existing.indexOf('`' + INDEX_NAME + '`') === -1
  })
}

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId(COLLECTION)
    withoutIndex(collection)
    collection.indexes.push(INDEX_SQL)
    app.save(collection)
  },
  (app) => {
    const collection = app.findCollectionByNameOrId(COLLECTION)
    withoutIndex(collection)
    app.save(collection)
  }
)
