/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: {{description}}
 *
 * Data-only migration — no schema changes.
 * Transforms existing data using raw SQL.
 */

migrate((app) => {
  // Simple update with bind parameters
  app.db()
    .newQuery(
      `UPDATE {{table_name}} SET {{column}} = {:newVal} WHERE {{column}} = {:oldVal}`
    )
    .bind({ newVal: "new_value", oldVal: "old_value" })
    .execute();

  // Batch update with a mapping
  // const mappings = {
  //   "Old Value A": "new_a",
  //   "Old Value B": "new_b",
  // };
  //
  // for (const [oldVal, newVal] of Object.entries(mappings)) {
  //   app.db()
  //     .newQuery(
  //       `UPDATE {{table_name}} SET {{column}} = {:new} WHERE {{column}} = {:old}`
  //     )
  //     .bind({ new: newVal, old: oldVal })
  //     .execute();
  // }

  // JSON column update (replace within JSON string)
  // app.db()
  //   .newQuery(
  //     `UPDATE {{table_name}}
  //      SET json_col = REPLACE(json_col, {:oldQuoted}, {:newQuoted})
  //      WHERE json_col LIKE {:pattern}`
  //   )
  //   .bind({
  //     oldQuoted: '"old_value"',
  //     newQuoted: '"new_value"',
  //     pattern: "%old_value%",
  //   })
  //   .execute();
}, (app) => {
  // Reverse the data transform
  app.db()
    .newQuery(
      `UPDATE {{table_name}} SET {{column}} = {:newVal} WHERE {{column}} = {:oldVal}`
    )
    .bind({ newVal: "old_value", oldVal: "new_value" })
    .execute();
});
