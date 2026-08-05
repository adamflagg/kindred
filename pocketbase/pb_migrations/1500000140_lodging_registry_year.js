/// <reference path="../pb_data/types.d.ts" />

/**
 * Migration: year on lodging_units and lodging_areas
 *
 * The registry was the only timeless table in a system where every table that
 * points at it is year-keyed. Editing an amenity restated what a prior year's
 * roster was judged against; renaming a building erased the old name. One row
 * per unit per year fixes both, and `code` becomes the cross-year identity
 * thread — see docs/superpowers/specs/2026-08-04-lodging-year-scoping-design.md.
 *
 * BACKFILL IS THE LITERAL 2026, never CAMPMINDER_SEASON_ID and never a clock.
 * A migration is a historical fact; one that reads the environment writes
 * different data on every fresh dev clone and on the CD synthetic seed.
 *
 * THREE STEPS, not one. Adding a required number field to a populated table
 * leaves every existing row at 0, which violates min:2010 — so the next save of
 * any row fails validation with an error that names the wrong problem. Add
 * optional, backfill, then require.
 */

const BACKFILL_YEAR = 2026;
const TABLES = ["lodging_units", "lodging_areas"];

/**
 * Adds the year field if absent. Idempotent: `_migrations` keys on filename, so
 * an edited-after-apply migration is skipped silently and every add here must
 * tolerate already having run.
 *
 * @param {core.App} app
 * @param {string} name
 * @param {boolean} required
 */
function ensureYearField(app, name, required) {
  const col = app.findCollectionByNameOrId(name);
  const existing = col.fields.getByName("year");
  if (existing) {
    existing.required = required;
  } else {
    col.fields.add(
      new Field({
        type: "number",
        name: "year",
        required: required,
        presentable: false,
        min: 2010,
        max: 2100,
        onlyInt: true,
      })
    );
  }
  app.save(col);
}

/**
 * Replaces the single-column unique code index with (code, year).
 *
 * @param {core.App} app
 * @param {string} name
 * @param {string} indexName
 * @param {string} columns
 */
function setCodeIndex(app, name, indexName, columns) {
  const col = app.findCollectionByNameOrId(name);
  col.indexes = col.indexes
    .filter((sql) => !sql.includes(indexName))
    .concat([`CREATE UNIQUE INDEX \`${indexName}\` ON \`${name}\` (${columns})`]);
  app.save(col);
}

migrate(
  (app) => {
    for (const table of TABLES) {
      ensureYearField(app, table, false);
      app
        .db()
        .newQuery(`UPDATE ${table} SET year = {:y} WHERE year IS NULL OR year = 0`)
        .bind({ y: BACKFILL_YEAR })
        .execute();
      ensureYearField(app, table, true);
    }

    setCodeIndex(app, "lodging_units", "idx_lodging_units_code", "`code`, `year`");
    setCodeIndex(app, "lodging_areas", "idx_lodging_areas_code", "`code`, `year`");
  },
  (app) => {
    setCodeIndex(app, "lodging_units", "idx_lodging_units_code", "`code`");
    setCodeIndex(app, "lodging_areas", "idx_lodging_areas_code", "`code`");

    for (const table of TABLES) {
      const col = app.findCollectionByNameOrId(table);
      const field = col.fields.getByName("year");
      if (field) {
        col.fields.removeById(field.id);
        app.save(col);
      }
    }
  }
);
