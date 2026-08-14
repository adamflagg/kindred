/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: add four columns to staff_applications for the App-* fields
 * that are new in 2026 and currently route to no column. kindred#2271.
 *
 * kindred#2271 originally decided against adding columns for the four fields
 * still receiving 2026 answers, because nothing downstream read
 * staff_applications. The owner reversed that call 2026-08-14 for these four
 * specifically (see #2271) -- Go routing lands in the same PR that adds
 * pocketbase/sync/staff_applications.go.
 *
 * Measured against the production snapshot (all-persons, all-years counts):
 *   App-over 18                              294 values, 2 distinct (Yes x293, No x1)
 *   App-Work Camp Dates Kitchen Supervisor    15 values, 2 distinct (Yes x10, No x5)
 *   App-JEDIreturner                         157 values, 153 distinct free-text, maxlen 1535
 *   App-JEDInewstaff                         140 values, 136 distinct free-text, maxlen 1129
 *
 * over_18 and work_dates_kitchen_supervisor are BOOL, parsed via the same
 * parseStaffAppBool helper that already converts App-Over 21 -> over_21.
 *
 * INTENTIONAL DIVERGENCE: the sibling family work_dates_supervisor,
 * work_dates_driver and work_dates_wild are all TEXT despite also holding
 * only Yes/No values. The owner ruled work_dates_kitchen_supervisor BOOLEAN
 * anyway -- this is a deliberate decision for the new column, not a
 * retroactive correction, and the three existing siblings are left
 * untouched.
 *
 * jedi_returner and jedi_new_staff are TEXT, max 5000 -- matching the top of
 * the existing free-text range in 1500000046_staff_applications.js (e.g.
 * qualifications, why_tawonga, three_rules, autobiography). Both easily
 * clear the measured max lengths (1535 and 1129). App-Working Across
 * Differences ran 2024-2025 and stopped; JEDIreturner/JEDInewstaff are its
 * 2026-only replacement, split into returner and new-staff variants of the
 * same question -- not a new topic. The existing working_across_differences
 * column is untouched.
 *
 * NO DATA BACKFILL. All four columns are written by the staff_applications
 * sync, which runs per year. Until that sync runs for 2026, the columns are
 * empty, which reads correctly as "not yet extracted".
 *
 * PocketBase v0.23 syntax: fields.add(new Field({...})) with properties
 * DIRECT, not inside options{}. A bare add({...}) silently does nothing.
 * Every add is guarded so a re-run (or a re-applied migration after
 * consolidation) is a no-op.
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
    const col = app.findCollectionByNameOrId('staff_applications');

    addField(
      col,
      new Field({
        type: 'bool',
        name: 'over_18',
        required: false,
        presentable: false,
      })
    );

    addField(
      col,
      new Field({
        type: 'bool',
        name: 'work_dates_kitchen_supervisor',
        required: false,
        presentable: false,
      })
    );

    addField(
      col,
      new Field({
        type: 'text',
        name: 'jedi_returner',
        required: false,
        presentable: false,
        min: 0,
        max: 5000,
        pattern: '',
      })
    );

    addField(
      col,
      new Field({
        type: 'text',
        name: 'jedi_new_staff',
        required: false,
        presentable: false,
        min: 0,
        max: 5000,
        pattern: '',
      })
    );

    app.save(col);
  },
  (app) => {
    const col = app.findCollectionByNameOrId('staff_applications');

    col.fields.removeByName('over_18');
    col.fields.removeByName('work_dates_kitchen_supervisor');
    col.fields.removeByName('jedi_returner');
    col.fields.removeByName('jedi_new_staff');

    app.save(col);
  }
);
