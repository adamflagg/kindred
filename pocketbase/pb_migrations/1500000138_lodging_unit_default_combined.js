/// <reference path="../pb_data/types.d.ts" />
/**
 * Add `default_combined` to lodging_units.
 *
 * Meaningful on CONTAINER rows only. True means "draw the board's card at this
 * node and stop descending" — the whole-house let. False (the default, and
 * PocketBase's value for an unset bool) means "draw the children", which is
 * exactly the behaviour before this migration, so the column is inert until
 * the backfill below sets it.
 *
 * THE BACKFILL IS A PREDICATE, NEVER A LIST OF CODES.
 * verify-no-hardcoded-lodging.sh scans pb_migrations/ (the exclusion was
 * removed precisely because a future seed would land here), and the buildings
 * this selects are all in its needle list. A predicate names nothing.
 *
 * The predicate is not a coincidence being exploited: a container somebody
 * bothered to size with a whole-house `sleeps` is a container let as a whole.
 * Containers used purely for grouping carry no capacity.
 *
 * WHY HERE AND NOT IN THE REGISTRY FILE. The boot loader is create-if-absent
 * and never updates, so a `default_combined` added to the private registry
 * JSON is an exact no-op on every database that already has these rows —
 * production included (docs/reference/lodging-registry.md). The JSON still
 * needs the field, but for rows that do not yet exist: migrations run before
 * SeedRegistry (main.go:154), so on a FRESH db this UPDATE hits an empty table
 * and the loader supplies the value instead.
 *
 * WHY NOT apply_lodging_inventory.py. That script withholds every field but
 * `notes` from a row with `is_confirmed` set (:233). Routing this through it
 * would mean a cabin confirmed before the run could never receive the flag.
 */

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('lodging_units');

    // Idempotent: re-running (or a filename-keyed skip) must not double-add.
    if (!col.fields.getByName('default_combined')) {
      col.fields.add(
        new Field({
          type: 'bool',
          name: 'default_combined',
          required: false,
          presentable: false,
        })
      );
      app.save(col);
    }

    // Backfill. Idempotent by construction, and it deliberately does not
    // clear rows: an operator who has already ticked a box in /manage/lodging
    // outranks this.
    app.db()
      .newQuery(
        'UPDATE lodging_units SET default_combined = true ' +
          'WHERE is_container = true AND sleeps > 0'
      )
      .execute();
  },
  (app) => {
    const col = app.findCollectionByNameOrId('lodging_units');
    if (!col.fields.getByName('default_combined')) return;
    col.fields.removeByName('default_combined');
    app.save(col);
  }
);
