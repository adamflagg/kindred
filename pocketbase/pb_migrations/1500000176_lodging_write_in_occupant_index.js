/// <reference path="../pb_data/types.d.ts" />
/**
 * Narrow both write-in unique indexes onto `occupant_name`. kindred#2583 step 8.
 *
 * THE ON-SWITCH. Steps 0-7 shipped the read path, the request model, the
 * create-vs-update decision, the row-addressed delete and the push/unpush
 * re-keying, and every one of them was dark: the indexes below forbade the
 * second row, so no code path any of those steps added could be reached with
 * production data. This migration is what makes them reachable.
 *
 *   idx_lodging_write_in_unique
 *     (session_cm_id, year, unit) -> (session_cm_id, year, unit, occupant_name)
 *   idx_lodging_write_in_draft_unique
 *     (session_cm_id, year, unit, scenario)
 *       -> (session_cm_id, year, unit, scenario, occupant_name)
 *
 * WHY, in the owner's terms. 30 leaf units are classified `shareable` and 14
 * of the 15 containers are too -- the model asserts two households may share
 * them -- while the index keyed on the unit alone forbade the second row. Staff
 * had to type both families into one `occupant_name` and add their counts
 * together, which destroys the per-party count this surface exists to keep.
 *
 * WHY NARROW RATHER THAN DROP, which was the owner's first lean. Dropping is
 * safe for IDENTITY -- two different families in a shareable cabin is the
 * feature, not a contradiction -- and unsafe for DOUBLE-COUNTING.
 * `write_in_demand` sums every cover, so one family of 3 entered twice (a
 * double-click, two staff, a re-submit) consumes 6 spots, and a 15-spot cabin
 * reports 9 free instead of 12 with nothing anywhere flagging it. Narrowing
 * keeps that refusal and permits what `shareability` asserts. It also keeps
 * three things in api/services/lodging_write_service.py working as written:
 * `_upsert_row`'s lost-race recovery, `unpush`'s `by_tuple`, and
 * `execute_push`'s add-side pre-check, all of which key on this same tuple.
 *
 * THE DRAFT TWIN KEEPS `scenario`. A scenario is a legitimate second axis --
 * 1500000161 put it there so two scenarios may hold contradicting write-ins for
 * one unit -- and dropping it here would let two scenarios' rows collide. It
 * gains `occupant_name` and loses nothing.
 *
 * ⚠️ ONE-WAY IN PRACTICE, and the down path below is honest about it rather
 * than absent. Restoring a unique index over a table that by then holds two
 * rows on one unit FAILS: SQLite refuses to build a unique index over
 * duplicate keys, and the migration aborts with the collection unchanged.
 * That is the correct outcome -- silently deleting one of two real households
 * to make a schema fit would be worse -- but it means this is a widening
 * migration like every other, and the way back is to remove the second row
 * first. The down path is here for a database that has not yet used the
 * feature.
 *
 * NO DEDUPE BACKFILL, and that is measured rather than assumed. Against the
 * production snapshot: `occupant_name` is 0 blank and 0 padded across every
 * live and draft write-in, and there are 0 duplicate (unit, session_cm_id,
 * year) groups -- the old index guaranteed the last of those, and the first two
 * are what make the new key well-formed. So every existing row keys cleanly
 * under the narrowed index and nothing has to be merged or dropped first.
 *
 * A PURE INDEX CHANGE TOUCHES NO FIELD, so the v0.23 `new Field({...})` trap
 * that docs/reference/pocketbase-migrations.md warns about does not apply here.
 * The trap that DOES apply is the one 1500000165 documents: replace an index by
 * NAME, never by matching its column text, or the down path's differently-worded
 * statement leaves the old entry standing and pushes a second index beside it
 * under the same name.
 *
 * IDEMPOTENT BY CONSTRUCTION, for the reason 1500000165 gives: `_migrations`
 * keys on FILENAME so this never re-runs on its own, but a partial apply or a
 * database that saw an earlier draft must not end up with two entries under one
 * name. `replaceIndex` filters before it pushes.
 */

const LIVE = 'lodging_write_ins'
const DRAFT = 'lodging_write_ins_draft'

const LIVE_INDEX = 'idx_lodging_write_in_unique'
const DRAFT_INDEX = 'idx_lodging_write_in_draft_unique'

// Written out in full, both ends, rather than assembled from shared parts. The
// down path's job is to restore 1500000161's own statements VERBATIM, and a
// builder that generated both ends would happily restore something else.
// `TestWriteInIndexDownPathRestoresTheOriginalStatements` compares the two
// "before" strings against 1500000161 itself.
const LIVE_BEFORE =
  'CREATE UNIQUE INDEX `idx_lodging_write_in_unique` ON `lodging_write_ins` ' +
  '(`session_cm_id`, `year`, `unit`)'
const LIVE_AFTER =
  'CREATE UNIQUE INDEX `idx_lodging_write_in_unique` ON `lodging_write_ins` ' +
  '(`session_cm_id`, `year`, `unit`, `occupant_name`)'
const DRAFT_BEFORE =
  'CREATE UNIQUE INDEX `idx_lodging_write_in_draft_unique` ON `lodging_write_ins_draft` ' +
  '(`session_cm_id`, `year`, `unit`, `scenario`)'
const DRAFT_AFTER =
  'CREATE UNIQUE INDEX `idx_lodging_write_in_draft_unique` ON `lodging_write_ins_draft` ' +
  '(`session_cm_id`, `year`, `unit`, `scenario`, `occupant_name`)'

/**
 * Replaces the index of the given name, matching on NAME rather than on the
 * column text -- 1500000165's helper, and its reasoning applies unchanged here:
 * the down path installs a statement that does not mention `occupant_name`, so
 * a text match on the columns would keep the old entry and then push a second
 * index under the same name.
 * @param {core.Collection} collection
 * @param {string} name
 * @param {string} sql
 */
function replaceIndex(collection, name, sql) {
  collection.indexes = collection.indexes.filter(function (existing) {
    return existing.indexOf('`' + name + '`') === -1
  })
  collection.indexes.push(sql)
}

migrate(
  (app) => {
    const live = app.findCollectionByNameOrId(LIVE)
    replaceIndex(live, LIVE_INDEX, LIVE_AFTER)
    app.save(live)

    const draft = app.findCollectionByNameOrId(DRAFT)
    replaceIndex(draft, DRAFT_INDEX, DRAFT_AFTER)
    app.save(draft)
  },
  (app) => {
    // See the header: this succeeds only on a database that has not yet put two
    // rows on one unit. Where it cannot, SQLite refuses to build the index and
    // the save throws -- which is the right answer, because the alternative is
    // deleting one of two real households to make the schema fit.
    const live = app.findCollectionByNameOrId(LIVE)
    replaceIndex(live, LIVE_INDEX, LIVE_BEFORE)
    app.save(live)

    const draft = app.findCollectionByNameOrId(DRAFT)
    replaceIndex(draft, DRAFT_INDEX, DRAFT_BEFORE)
    app.save(draft)
  }
)
