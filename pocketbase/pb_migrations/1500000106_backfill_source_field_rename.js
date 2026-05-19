/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Rename the SourceField wire-values across schema + data for every
 * table that carries the field identifier (#1142 Stage 4 / source-type
 * co-evolution Phase 1).
 *
 * The two colliding wire-values were renamed to disambiguate from RequestType:
 *   "bunk_with"     → "bunk_request_form"
 *   "not_bunk_with" → "staff_not_bunk_with"
 *
 * The same vocabulary is stored in three tables:
 *   - bunk_requests.source_field        (text col; solver/satisfaction read path)
 *   - original_bunk_requests.field      (SELECT field; CSV-origin identifier — the
 *                                         Go sync write path in bunk_requests.go
 *                                         csvFieldMap now emits the new strings, so
 *                                         the select's allowed values MUST include
 *                                         them or record.Save() is rejected)
 *   - bunk_request_sources.source_field (text col; per-source provenance links)
 *
 * `original_bunk_requests.field` is a select, so this migration updates the
 * field's allowed `values` (schema) in addition to rewriting existing rows.
 * Raw-SQL UPDATEs bypass select validation, so the data step is order-independent,
 * but the schema step is required for future PocketBase-API writes (Go sync).
 *
 * Idempotent on the data side: rows already carrying the new string aren't matched.
 *
 * Down-migration restores the old select values and the old row strings.
 */

const NEW_FIELD_VALUES = [
  "bunk_request_form",
  "staff_not_bunk_with",
  "bunking_notes",
  "internal_notes",
  "socialize_with",
];

const OLD_FIELD_VALUES = [
  "bunk_with",
  "not_bunk_with",
  "bunking_notes",
  "internal_notes",
  "socialize_with",
];

const DATA_TARGETS = [
  ["bunk_requests", "source_field"],
  ["original_bunk_requests", "field"],
  ["bunk_request_sources", "source_field"],
];

function renameRows(app, pairs) {
  for (const [table, col] of DATA_TARGETS) {
    for (const [from, to] of pairs) {
      app
        .db()
        .newQuery(`UPDATE ${table} SET ${col} = '${to}' WHERE ${col} = '${from}'`)
        .execute();
    }
  }
}

function setFieldSelectValues(app, values) {
  // fields.add() with an existing field name upserts the field definition.
  const collection = app.findCollectionByNameOrId("original_bunk_requests");
  collection.fields.add(
    new Field({
      type: "select",
      name: "field",
      required: true,
      presentable: false,
      values: values,
      maxSelect: 1,
    })
  );
  app.save(collection);
}

migrate(
  (app) => {
    // Schema first so the select accepts the new vocabulary, then rewrite rows.
    setFieldSelectValues(app, NEW_FIELD_VALUES);
    renameRows(app, [
      ["bunk_with", "bunk_request_form"],
      ["not_bunk_with", "staff_not_bunk_with"],
    ]);
  },
  (app) => {
    renameRows(app, [
      ["bunk_request_form", "bunk_with"],
      ["staff_not_bunk_with", "not_bunk_with"],
    ]);
    setFieldSelectValues(app, OLD_FIELD_VALUES);
  }
);
