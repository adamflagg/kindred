/// <reference path="../pb_data/types.d.ts" />
/**
 * Add the amenity columns the 2026 inventory needs to lodging_units.
 *
 * SCHEMA ONLY. No values are written here: the registry is private data in
 * config/lodging_registry.json (docs/reference/lodging-registry.md), and unit
 * names are camp-identifying, so nothing camp-specific may live in a tracked
 * migration. These columns land empty on existing rows and are populated
 * separately.
 *
 * WHY THESE FIELDS AT ALL. Of the 93 units the registry holds today,
 * `has_power`, `has_ac`, `has_fridge`, `is_accessible` and `is_confirmed` are
 * false on ALL of them — not because the cabins lack power, but because nobody
 * ever filled the columns in. That is why the roster's fit check has never been
 * meaningful: `needs_power` was being judged against a column that is false
 * everywhere. This is the first amenity data the registry will have.
 *
 * `has_ramp` IS A SELECT, NOT A BOOL, and that is the load-bearing decision
 * here. The source column is overwhelmingly blank, with a handful of yeses, a
 * few explicit noes, and some qualified yeses ("yes, but there is a lip at the
 * door"). A bool maps every unassessed cabin to false, which asserts "no ramp"
 * about cabins nobody has looked at — so someone filtering for step-free access
 * would see a short list and a long tail of invisible maybes. An empty select
 * means NOT ASSESSED, the same discipline that stops `sleeps: null` rendering
 * as 0. `partial` carries the qualified case; the qualifier text itself belongs
 * in `notes`, where it can say what the lip actually is.
 *
 * `max_beds` IS NOT `sleeps`, and neither may overwrite the other. `max_beds`
 * is the total number of sleeping spots in the room. `sleeps` is the staff
 * judgement about how many people should actually be put there for a given
 * session type, and the two disagree on most units — a camper cabin with 14
 * bunks holds one family. HANDOFF §6: spaces, not beds. 1500000128 anticipated
 * this: "real capacity depends on bed size AND on who can share a bed, which is
 * a staff judgement rather than a sum."
 *
 * PocketBase v0.23 syntax: fields.add(new Field({...})) on an existing
 * collection. A bare add({...}) silently does nothing and fails at server boot.
 */

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('lodging_units');

    const BOOLS = [
      'has_heat',
      'is_weatherized',
      'has_plumbing',
      // Distinct from has_heat: a space heater is portable and needs an outlet,
      // so it is not the same claim as a heated cabin.
      'has_space_heater',
      // The unit-side counterpart to the family-side infant flag. Without it, a
      // family bringing an infant can be placed in a room with nowhere to put a
      // pack & play and nothing can see it.
      'has_pack_play_space',
      'has_living_room',
      'has_kitchen',
      'has_lights',
    ];

    // Idempotent per field: re-running, or a filename-keyed skip, must not
    // double-add. Checked per column rather than once for the whole batch, so a
    // migration edited after it was applied still adds what is missing —
    // _migrations keys on filename and will not re-run the file otherwise.
    for (const name of BOOLS) {
      if (col.fields.getByName(name)) continue;
      col.fields.add(new Field({ type: 'bool', name, required: false, presentable: false }));
    }

    if (!col.fields.getByName('has_ramp')) {
      col.fields.add(
        new Field({
          type: 'select',
          name: 'has_ramp',
          required: false,
          presentable: false,
          values: ['yes', 'no', 'partial'],
          maxSelect: 1,
        })
      );
    }

    if (!col.fields.getByName('max_beds')) {
      col.fields.add(
        new Field({
          type: 'number',
          name: 'max_beds',
          required: false,
          presentable: false,
          onlyInt: true,
          // Unbounded must be null, not 0 — a max of 0 rejects every positive
          // value, and verify-lodging-schema.sh asserts this for sleeps too.
          min: null,
          max: null,
        })
      );
    }

    app.save(col);
  },
  (app) => {
    const col = app.findCollectionByNameOrId('lodging_units');
    const NAMES = [
      'has_heat',
      'is_weatherized',
      'has_plumbing',
      'has_space_heater',
      'has_pack_play_space',
      'has_living_room',
      'has_kitchen',
      'has_lights',
      'has_ramp',
      'max_beds',
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
