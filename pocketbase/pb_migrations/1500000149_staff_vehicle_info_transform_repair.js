/// <reference path="../pb_data/types.d.ts" />
/**
 * staff_vehicle_info transform repair — four column changes in one migration.
 *
 * Four open issues (kindred#2258, #2262, #2268, #2273) all need a schema change on
 * this one table. Landing them separately would mean three migrations on one
 * table and three ten-year backfills, so they are merged here.
 *
 * 1. license_plate 20 -> 100.  22 of the 798 real values exceed 20 characters
 *    (longest 83). upsertRecords sets all columns then calls Save ONCE, so an
 *    over-cap plate fails the WHOLE row -- make, model and driver for that
 *    staff member are lost too, and `errors` increments. 100 matches
 *    vehicle_make/vehicle_model. None of the other columns' caps is below its
 *    observed data (driver_name is the closest, 189 against 200), so nothing
 *    else is widened speculatively.
 *
 * 2. can_bring_others bool -> text(1000).  The CampMinder field behind it,
 *    'SVI - bring others', is an open-ended String question: 1,044 answers,
 *    629 distinct, longest 328 characters. The bool is true on 18 of 1,772
 *    rows and on 0 of 200 for 2026. 34% of answers match no yes/no prefix
 *    rule in either direction, so no derived verdict is trustworthy -- the
 *    raw sentence IS the data. Empty string means "never asked" (732
 *    person-years); a non-empty value means they answered.
 *
 * 3./4. ride_from and transport_notes are new destinations for
 *    'SVI- Where do you need a ride from' (475 staff-linked values, longest
 *    352) and 'SVI - other' (447, longest 328), which have had nowhere to
 *    land since the table was created. max 1000 clears both with headroom;
 *    max 100 would truncate both.
 *
 * NO DATA BACKFILL HERE, deliberately. All four columns are written by the
 * staff_vehicle_info sync, which must be re-run per year. A migration cannot
 * compute them -- the inputs are person_custom_values rows that need the
 * staff-gate join. Until the sync runs, the new columns are empty, which reads
 * correctly as "not yet extracted".
 *
 * The existing can_bring_others booleans are DERIVED, not authoritative, which
 * is what makes drop-then-add safe: there is nothing worth preserving through
 * the type change, and the sync rebuilds the column from person_custom_values.
 * They could not be preserved anyway -- 732 of the false values mean "never
 * asked" and 1,022 mean "answered and flattened", and nothing on disk
 * distinguishes them.
 *
 * PocketBase v0.23 syntax: fields.add(new Field({...})) with properties
 * DIRECT, not inside options{}. A bare add({...}) silently does nothing.
 * Every add is guarded, because PB records an applied migration by FILENAME --
 * a later edit to this file would never re-run.
 */

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

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('staff_vehicle_info');

    // 1 — widen the plate.
    const plate = col.fields.getByName('license_plate');
    if (!plate) {
      throw new Error('staff_vehicle_info: expected an existing "license_plate" text field');
    }
    plate.max = 100;

    // 2 — bool -> text. Guarded on the CURRENT type so a re-run is a no-op.
    // NOTE: on a Field returned by getByName(), `.type` is a bound Go method,
    // not a string property (`typeof bring.type === 'function'`) -- comparing
    // it directly to a string is always false and silently no-ops the whole
    // block. Must be called: `bring.type()`.
    const bring = col.fields.getByName('can_bring_others');
    if (bring && bring.type() === 'bool') {
      col.fields.removeByName('can_bring_others');
      col.fields.add(
        new Field({
          type: 'text',
          name: 'can_bring_others',
          required: false,
          presentable: false,
          min: 0,
          max: 1000,
          pattern: '',
        })
      );
    }

    // 3/4 — new destinations.
    addField(
      col,
      new Field({
        type: 'text',
        name: 'ride_from',
        required: false,
        presentable: false,
        min: 0,
        max: 1000,
        pattern: '',
      })
    );
    addField(
      col,
      new Field({
        type: 'text',
        name: 'transport_notes',
        required: false,
        presentable: false,
        min: 0,
        max: 1000,
        pattern: '',
      })
    );

    app.save(col);
  },
  (app) => {
    const col = app.findCollectionByNameOrId('staff_vehicle_info');

    const plate = col.fields.getByName('license_plate');
    if (plate) {
      plate.max = 20;
    }

    const bring = col.fields.getByName('can_bring_others');
    if (bring && bring.type() === 'text') {
      col.fields.removeByName('can_bring_others');
      col.fields.add(
        new Field({ type: 'bool', name: 'can_bring_others', required: false, presentable: false })
      );
    }

    col.fields.removeByName('ride_from');
    col.fields.removeByName('transport_notes');

    app.save(col);
  }
);
