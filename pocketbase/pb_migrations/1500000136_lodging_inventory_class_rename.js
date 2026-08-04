/// <reference path="../pb_data/types.d.ts" />

/**
 * Migration: lodging_units.allocation_default becomes inventory_class
 *
 * After 1500000135 the column is a ROLE, not a default. "Default" implied an
 * override, and the override is now a rare per-weekend exception rather than
 * the point: the column says whether a unit is planning inventory at all.
 *
 * RENAMED IN PLACE, never removed and re-added. All 114 rows in production
 * carry a value (92 family_pool, 22 staff_default) and a remove-and-add would
 * drop every one of them -- silently, because nothing reads the column through
 * a filter that would error on the missing name.
 *
 * The select's `values` are untouched: family_pool / staff_default keep their
 * meaning, only the question the column answers is renamed.
 */

/**
 * Renames a field in place, keeping its ID so PocketBase emits
 * `ALTER TABLE ... RENAME COLUMN` rather than a drop-and-recreate.
 *
 * The `if (!field) return` guard is not decoration: editing an already-applied
 * migration silently skips it (`_migrations` keys on filename), so every add
 * and rename in this codebase is written idempotent.
 *
 * @param {core.App} app
 * @param {string} collectionName
 * @param {string} from
 * @param {string} to
 */
function renameField(app, collectionName, from, to) {
  const col = app.findCollectionByNameOrId(collectionName);
  const field = col.fields.getByName(from);
  if (!field) return; // idempotent: already renamed
  field.name = to;
  app.save(col);
}

migrate(
  (app) => {
    renameField(app, "lodging_units", "allocation_default", "inventory_class");
  },
  (app) => {
    renameField(app, "lodging_units", "inventory_class", "allocation_default");
  }
);
