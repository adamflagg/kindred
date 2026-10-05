/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: aid_application_corrections.reason becomes optional.
 * Dependencies: aid_application_corrections (1500000202)
 *
 * B30 (owner 2026-10-05): a correction's reason is optional. CorrectionCreate
 * (api/schemas/financial_aid_intake.py) now defaults it to "" and the
 * casework service stores a blank reason as "", so this field must accept an
 * empty string: `required` goes false and `min` 0. `max` stays 2000. Other
 * forms' reasons are on other tables and stay required. aid_change_log.reason
 * is already optional (1500000187).
 *
 * PocketBase v0.23 syntax: mutate the existing Field object's properties and
 * `app.save(col)`, as 1500000140 does, so the field keeps its id.
 */

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('aid_application_corrections');
    const reason = col.fields.getByName('reason');
    if (!reason) {
      throw new Error('aid_application_corrections: expected an existing "reason" text field');
    }
    reason.required = false;
    reason.min = 0;
    app.save(col);
  },
  (app) => {
    const col = app.findCollectionByNameOrId('aid_application_corrections');
    const reason = col.fields.getByName('reason');
    if (!reason) {
      throw new Error('aid_application_corrections: expected an existing "reason" text field');
    }
    // Restores 1500000202's shape. A blank reason saved since the up path would
    // fail its next save; PocketBase checks `required`/`min` at record-save time,
    // not at schema-save time, so flipping them back here cannot itself fail.
    reason.required = true;
    reason.min = 1;
    app.save(col);
  }
);
