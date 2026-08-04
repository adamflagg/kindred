/// <reference path="../pb_data/types.d.ts" />
/**
 * Five facts the 2026 Master Housing sheet carries that had nowhere to live.
 *
 * Before this they were discarded outright or survived only as prose in
 * `notes`, which nothing can query. Counts from the sheet: has_tub 5,
 * has_kitchenette 4, has_crib 3, has_changing_table 1, has_shared_fridge 4.
 *
 * Each REFINES a column that already exists rather than restating it:
 *
 *   has_tub           <- narrows the `bathroom` select (none|private|shared)
 *   has_kitchenette   <- narrows has_kitchen
 *   has_shared_fridge <- narrows has_fridge
 *
 * so none of them can contradict its parent and a consumer that reads only the
 * parent stays correct. The `bathroom` enum was deliberately NOT widened to
 * carry tub or shower: that three-way is load-bearing in the fit check and in
 * matching, and a family with a private-bathroom need is scored against it.
 * Adding values would ripple through every one of those call sites, which is a
 * much larger change than the fact justifies. See 1500000117's bathroom_group
 * note for the last time that enum's exact shape mattered.
 *
 * has_crib and has_changing_table are distinct from the existing
 * has_pack_play_space -- a camp-provided crib is not floor space for a family's
 * own pack-and-play, and families with babies ask about both.
 *
 * Absent means false, which for these is the same claim the columns made before
 * the 2026 inventory: unknown, recorded as false. There is no null state, so
 * they are NOT in apply_lodging_inventory's NULLABLE_FIELDS.
 *
 * PocketBase v0.23 syntax: fields.add(new Field({...})) on an existing
 * collection. A bare add({...}) silently does nothing.
 */

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('lodging_units');

    const BOOLS = [
      'has_tub',
      'has_kitchenette',
      'has_crib',
      'has_changing_table',
      'has_shared_fridge',
    ];

    // Idempotent PER FIELD, matching 1500000131. `_migrations` keys on
    // filename, so a file edited after it was applied never re-runs as a whole
    // -- checking each column individually means a later addition still lands.
    let dirty = false;
    for (const name of BOOLS) {
      if (col.fields.getByName(name)) continue;
      col.fields.add(new Field({ type: 'bool', name, required: false, presentable: false }));
      dirty = true;
    }

    if (dirty) app.save(col);
  },
  (app) => {
    const col = app.findCollectionByNameOrId('lodging_units');
    const NAMES = [
      'has_tub',
      'has_kitchenette',
      'has_crib',
      'has_changing_table',
      'has_shared_fridge',
    ];
    let dirty = false;
    for (const name of NAMES) {
      if (!col.fields.getByName(name)) continue;
      // removeByName is this repo's idiom (1500000087, 1500000097, 1500000113).
      col.fields.removeByName(name);
      dirty = true;
    }
    if (dirty) app.save(col);
  }
);
