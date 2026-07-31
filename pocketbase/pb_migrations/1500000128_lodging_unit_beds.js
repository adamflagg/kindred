/// <reference path="../pb_data/types.d.ts" />
/**
 * Add `beds` to lodging_units.
 *
 * Bed inventory ("2 twins and a queen") is the detail behind `sleeps`, not a
 * replacement for it. `sleeps` remains the single number every consumer reads
 * — the roster's fit note, units_capacity_unknown, the availability rules —
 * because real capacity depends on bed size AND on who can share a bed, which
 * is a staff judgement rather than a sum. The admin form offers the sum as a
 * one-click suggestion; it never writes it silently.
 *
 * Shape: [{ "type": "queen", "count": 1 }, { "type": "twin", "count": 2 }]
 * Rows predating this migration carry null, so readers normalise.
 *
 * PocketBase v0.23 syntax: fields.add(new Field({...})) on an existing
 * collection. A bare add({...}) silently does nothing.
 */

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('lodging_units');

    // Idempotent: re-running (or a filename-keyed skip) must not double-add.
    if (col.fields.getByName('beds')) return;

    col.fields.add(
      new Field({
        type: 'json',
        name: 'beds',
        required: false,
        presentable: false,
        maxSize: 20000,
      })
    );
    app.save(col);
  },
  (app) => {
    const col = app.findCollectionByNameOrId('lodging_units');
    if (!col.fields.getByName('beds')) return;
    // removeByName is this repo's idiom (1500000087, 1500000097, 1500000113).
    col.fields.removeByName('beds');
    app.save(col);
  }
);
