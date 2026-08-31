/// <reference path="../pb_data/types.d.ts" />
/**
 * lodging_write_in_pushes — the push-event LEDGER for kindred#2477.
 *
 * One row per executed push of a scenario's write-ins onto the live board.
 * `changes` holds the full row payload BOTH directions ({action: "add"|"remove",
 * unit, unit_code, occupant_name, note, party_size}), which is what makes
 * Unpush a replay: delete what the push added, recreate what it removed.
 *
 * Removals of live write-ins are PHYSICAL deletes recorded here first — a
 * `deleted_at` tombstone was ruled out (owner, 2026-08-22) for three reasons,
 * two of which stand and one of which kindred#2583 step 8 has since changed:
 *
 *   1. ⚠️ CORRECTED. This used to read "the live table's unique index
 *      (unit, session_cm_id, year) means a tombstone blocks staff from ever
 *      writing that unit again for the weekend". 1500000176 narrowed that
 *      index onto `occupant_name`, so a tombstone no longer blocks the UNIT —
 *      it blocks re-writing THAT OCCUPANT onto it. Weakened, not void: remove
 *      "Chen" from Ridge D and write "Chen" back, and the tombstone is still
 *      in the way. It is no longer the reason it once was, and the next reader
 *      should not argue from it as though it were.
 *   2. The live table deliberately has no scenario column
 *      (main_lodging_write_in_cascade_test.go pins it). UNCHANGED.
 *   3. Every reader would need a deleted-filter, and one missed reader would
 *      break. UNCHANGED, and stronger: the two-write-ins work found three
 *      readers of this data nobody had audited.
 *
 * ⇒ Physical delete is still the answer, on reasons 2 and 3. The answer did
 * not move; the argument did, and it is corrected here rather than left to
 * mislead — see CLAUDE.md § "A Wrong Issue Body Gets Fixed, Not Worked Around".
 *
 * `scenario_id` is a TEXT SNAPSHOT, not a relation, deliberately: push history
 * must outlive the scenario. A relation with cascadeDelete erases the audit
 * trail when the scenario is deleted; without cascadeDelete it dangles. The
 * cross-table-relations convention is for CampMinder data; this table is
 * app-owned history and diverges on purpose.
 *
 * API-only access: all reads and writes go through FastAPI under
 * bunking.manage, like every other lodging write surface. Locked to
 * superuser-only (every rule `null`) rather than AUTHED_READ / BUNKING_MANAGE
 * like `lodging_write_ins` — the frontend never reads this table directly,
 * only the FastAPI service (authenticating as PocketBase superuser) does, so
 * there is no end-user rule to grant.
 *
 * PocketBase v0.23 syntax: fields and indexes passed directly on
 * `new Collection({...})`, properties DIRECT rather than inside `options: {}`.
 * `min`/`max`/`onlyInt` on `session_cm_id` and `year` mirror the sibling
 * `lodging_write_ins` table (1500000161) so "required, nonzero" is an actual
 * constraint and not just documentation.
 *
 * `changes.maxSize` is 2000000 (2MB) — generous headroom for a push touching
 * many units in one scenario; a ledger write must not silently reject data.
 */
migrate(
  (app) => {
    app.save(
      new Collection({
        type: 'base',
        name: 'lodging_write_in_pushes',
        listRule: null,
        viewRule: null,
        createRule: null,
        updateRule: null,
        deleteRule: null,
        fields: [
          // CampMinder reuses session ids across years — every data table
          // carries the year that disambiguates them.
          { type: 'number', name: 'year', required: true, presentable: false, min: 2010, max: 2100, onlyInt: true },
          { type: 'number', name: 'session_cm_id', required: true, presentable: false, min: 1, max: null, onlyInt: true },
          // TEXT snapshot, not a relation — see header. Push history must
          // outlive the scenario it was pushed from.
          { type: 'text', name: 'scenario_id', required: true, presentable: false, min: 1, max: 200, pattern: '' },
          { type: 'text', name: 'scenario_name', required: false, presentable: false, min: 0, max: 200, pattern: '' },
          { type: 'text', name: 'pushed_by', required: false, presentable: false, min: 0, max: 200, pattern: '' },
          // Full row payload both directions — what makes Unpush a replay.
          { type: 'json', name: 'changes', required: true, presentable: false, maxSize: 2000000 },
          { type: 'text', name: 'unpushed_at', required: false, presentable: false, min: 0, max: 100, pattern: '' },
          { type: 'autodate', name: 'created', required: false, presentable: false, onCreate: true, onUpdate: false },
          { type: 'autodate', name: 'updated', required: false, presentable: false, onCreate: true, onUpdate: true },
        ],
        indexes: [
          'CREATE INDEX `idx_write_in_push_session` ON `lodging_write_in_pushes` (`session_cm_id`, `year`)',
        ],
      })
    )
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('lodging_write_in_pushes')
    app.delete(collection)
  }
)
