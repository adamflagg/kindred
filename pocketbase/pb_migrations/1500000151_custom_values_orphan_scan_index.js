/**
 * Migration: give the orphan sweep an index it can scan in order.
 *
 * kindred#2266 uncapped the orphan sweep for person_custom_values and
 * household_custom_values. Uncapping it exposed a planner problem that the
 * 10,000-row cap had been hiding.
 *
 * The scan reads `year = ? ORDER BY id`. person_custom_values' only usable
 * index is idx_person_cf_vals_field on (year, field_definition), which does not
 * mention id, so SQLite satisfies the WHERE from that index and then sorts the
 * whole year through a temp b-tree -- once per page. Measured on a copy of the
 * production snapshot before this migration:
 *
 *   EXPLAIN QUERY PLAN SELECT * FROM person_custom_values
 *     WHERE year=2026 ORDER BY id LIMIT 500;
 *   |--SEARCH person_custom_values USING INDEX idx_person_cf_vals_field (year=?)
 *   `--USE TEMP B-TREE FOR ORDER BY
 *
 * 2026 holds ~156k rows in that table, so the sweep sorted ~156k rows for every
 * page it read. persons, by contrast, already seeks correctly through its
 * primary-key index, which is why only these two tables need this.
 *
 * (year, id) is the smallest index that removes the sort: it satisfies the
 * equality and yields rows already ordered by id.
 *
 * NOT UNIQUE, deliberately. id is already unique on its own; this index exists
 * for ordering, not for a constraint. A unique index here would add a second
 * uniqueness rule with nothing behind it and would fail the migration on any
 * table that ever legitimately repeated a (year, id) pair.
 *
 * Idempotent by name: `_migrations` keys on filename, so editing an
 * already-applied migration silently skips it. addIndex therefore removes any
 * index carrying the same name before pushing, so a re-run cannot leave two.
 * Lifted from 1500000147 and 1500000150.
 */
/// <reference path="../pb_data/types.d.ts" />

const SCAN_INDEXES = [
  {
    collection: "person_custom_values",
    name: "idx_person_custom_values_year_id",
    sql:
      "CREATE INDEX `idx_person_custom_values_year_id` " +
      "ON `person_custom_values` (`year`, `id`)",
  },
  {
    collection: "household_custom_values",
    name: "idx_household_custom_values_year_id",
    sql:
      "CREATE INDEX `idx_household_custom_values_year_id` " +
      "ON `household_custom_values` (`year`, `id`)",
  },
];

function withoutIndex(col, name) {
  return col.indexes.filter(function (sql) {
    return sql.indexOf("`" + name + "`") === -1;
  });
}

migrate(
  function (app) {
    for (const idx of SCAN_INDEXES) {
      const col = app.findCollectionByNameOrId(idx.collection);
      col.indexes = withoutIndex(col, idx.name);
      col.indexes.push(idx.sql);
      app.save(col);
    }
  },
  function (app) {
    for (const idx of SCAN_INDEXES) {
      const col = app.findCollectionByNameOrId(idx.collection);
      col.indexes = withoutIndex(col, idx.name);
      app.save(col);
    }
  },
);
