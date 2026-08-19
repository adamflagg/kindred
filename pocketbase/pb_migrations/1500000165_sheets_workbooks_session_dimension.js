/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: give sheets_workbooks a SESSION dimension, so a Family Camp weekend
 * can own its own roster workbook. kindred#2433.
 *
 * THREE CHANGES, ONE SCHEMA CHANGE. They are inseparable: any one alone leaves
 * the table unable to hold the rows the roster export writes.
 *
 *   1. `session_cm_id`, a CampMinder id, optional and defaulting to 0.
 *   2. `fc_roster` added to the `workbook_type` vocabulary.
 *   3. the unique index re-keyed to (workbook_type, year, session_cm_id).
 *
 * WHY THE INDEX MUST MOVE, and this is the half that is easy to miss. The
 * original index is UNIQUE (workbook_type, year) -- exactly one workbook per
 * year. 2026 has ten Family Camp weekends, eight of them with enrolled campers,
 * and each gets its own workbook. Adding the column without re-keying the index
 * would let the FIRST roster workbook of a season save and reject every one
 * after it, at the database, with a uniqueness error rather than anything that
 * names the real problem.
 *
 * NO BACKFILL IS NEEDED, and that is a property of PocketBase rather than luck.
 * PB declares number columns as `NUMERIC DEFAULT 0 NOT NULL`, so the twelve
 * existing rows (one globals, eleven per-year) take 0 rather than NULL. That
 * matters for the index: SQLite treats each NULL as DISTINCT, so a nullable
 * column would have quietly disabled uniqueness for exactly the rows that
 * already rely on it. With 0, ('year', 2026, 0) stays unique as before.
 *
 * `session_cm_id` IS OPTIONAL, deliberately. The globals workbook has no year
 * and no session; the per-year workbooks have no session. Requiring it would
 * make those rows unrepresentable. 0 reads as "not session-scoped", which is
 * the same convention `year = 0` already uses for globals.
 *
 * `max: null`, NOT `max: 0`. For a NUMBER field PocketBase enforces `max: 0` as
 * a literal ceiling of zero, which would reject every real CampMinder id.
 * docs/reference/pocketbase-migrations.md flags this as its own row in the
 * mistakes table, because the text-field advice (0 means "PB default") is the
 * opposite.
 *
 * `workbook_type` STAYS A CLOSED VOCABULARY. Minting one type per session was
 * the obvious alternative and is wrong: `workbook_type` groups rows in the
 * admin Sheets tab and drives `GetWorkbookByType`'s filter, so an unbounded set
 * turns that filter into id string-matching and the grouping into noise.
 *
 * PocketBase v0.23 syntax: `fields.add(new Field({...}))` with properties
 * DIRECT rather than inside an `options: {}` wrapper -- a bare `add({...})` or
 * an options wrapper silently does nothing. The select field is mutated IN
 * PLACE rather than re-added, because re-adding drops its stored values.
 *
 * IDEMPOTENT BY CONSTRUCTION. `_migrations` keys on FILENAME, so editing this
 * file after it has applied would never re-run it -- but a partial apply, or a
 * database that saw an earlier draft, must not double-add the field or push a
 * second index under the same name. Both helpers below filter first.
 */

const COLLECTION = "sheets_workbooks";
const INDEX_NAME = "idx_sheets_workbooks_type_year";

const TYPES_BEFORE = ["globals", "year"];
const TYPES_AFTER = TYPES_BEFORE.concat(["fc_roster"]);

const INDEX_BEFORE =
  "CREATE UNIQUE INDEX `" + INDEX_NAME + "` ON `" + COLLECTION + "` " +
  "(`workbook_type`, `year`)";
const INDEX_AFTER =
  "CREATE UNIQUE INDEX `" + INDEX_NAME + "` ON `" + COLLECTION + "` " +
  "(`workbook_type`, `year`, `session_cm_id`)";

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

/**
 * Replaces the index of the given name, matching on NAME rather than on the
 * column text: the down path installs an index that does not mention
 * session_cm_id, so a text match on the column would keep the old entry and
 * then push a second index under the same name.
 * @param {core.Collection} collection
 * @param {string} name
 * @param {string} sql
 */
function replaceIndex(collection, name, sql) {
  collection.indexes = collection.indexes.filter(function (existing) {
    return existing.indexOf("`" + name + "`") === -1;
  });
  collection.indexes.push(sql);
}

/**
 * Returns the workbook_type select field, or throws if it is missing or has
 * been changed to another type -- mutating `.values` on a non-select would
 * silently do nothing.
 * @param {core.Collection} collection
 */
function selectField(collection, name) {
  const field = collection.fields.getByName(name);
  if (!field) {
    throw new Error(COLLECTION + ': expected an existing "' + name + '" field');
  }
  if (field.type() !== "select") {
    throw new Error(
      COLLECTION + '."' + name + '" is a ' + field.type() + ", expected a select"
    );
  }
  return field;
}

migrate((app) => {
  const collection = app.findCollectionByNameOrId(COLLECTION);

  addField(collection, new Field({
    type: "number",
    name: "session_cm_id",
    required: false,
    presentable: false,
    min: 0,
    max: null,
    onlyInt: true
  }));

  selectField(collection, "workbook_type").values = TYPES_AFTER;
  replaceIndex(collection, INDEX_NAME, INDEX_AFTER);

  app.save(collection);
}, (app) => {
  // Roster workbooks would fail validation against the narrowed vocabulary, and
  // several of them share a (workbook_type, year) so they would also collide
  // under the restored two-column unique index. Deleting them is correct rather
  // than lossy: down-migrating means reverting to a schema that cannot hold
  // them. The Drive files themselves are untouched and are re-linked on the
  // next export.
  const doomed = app.findRecordsByFilter(COLLECTION, 'workbook_type = "fc_roster"', "", 0, 0);
  for (const record of doomed) {
    app.delete(record);
  }

  const collection = app.findCollectionByNameOrId(COLLECTION);

  selectField(collection, "workbook_type").values = TYPES_BEFORE;
  replaceIndex(collection, INDEX_NAME, INDEX_BEFORE);
  collection.fields.removeByName("session_cm_id");

  app.save(collection);
});
