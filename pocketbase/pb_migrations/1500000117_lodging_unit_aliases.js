/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: lodging_unit_aliases
 *
 * Maps historical free-text cabin strings onto units. TEMPORAL, because renames
 * happened mid-history: one building was renamed outright between 2024 and
 * 2025, and a second, which had shared its old name, lost its area prefix in
 * the same season — so the identical free-text string means two different
 * units depending on the year it was written in.
 *
 * member_units is MULTI-valued so one table covers both cases: a single member
 * resolves to an atomic room; 2+ members denote a merge (see lodging_merges),
 * which backfill materialises as a merge row: one free-text string naming two
 * adjacent rooms resolves to both of their unit rows.
 */

migrate((app) => {
  const unitsCol = app.findCollectionByNameOrId("lodging_units");

  const aliases = new Collection({
    type: "base",
    name: "lodging_unit_aliases",
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.is_admin = true',
    updateRule: '@request.auth.is_admin = true',
    deleteRule: '@request.auth.is_admin = true',
    fields: [
      // Verbatim as it appears in the CampMinder custom field, including any
      // double spaces (e.g. "Health Center Downstairs  - Room A"). Do not trim.
      { type: "text", name: "alias_string", required: true, presentable: true, min: 1, max: 300, pattern: "" },
      {
        type: "relation", name: "member_units", required: true, presentable: false,
        collectionId: unitsCol.id, cascadeDelete: false, minSelect: 1, maxSelect: 20
      },
      { type: "number", name: "valid_from_year", required: false, presentable: false, min: 2000, max: 2100, onlyInt: true },
      { type: "number", name: "valid_to_year", required: false, presentable: false, min: 2000, max: 2100, onlyInt: true },
      { type: "text", name: "source_field", required: false, presentable: false, min: 0, max: 200, pattern: "" },
      { type: "text", name: "notes", required: false, presentable: false, min: 0, max: 2000, pattern: "" },
      { type: "autodate", name: "created", required: false, presentable: false, onCreate: true, onUpdate: false },
      { type: "autodate", name: "updated", required: false, presentable: false, onCreate: true, onUpdate: true }
    ],
    indexes: [
      // Same string can map differently in different year windows, so the unique
      // key includes valid_from_year.
      "CREATE UNIQUE INDEX `idx_lodging_alias_string_from` ON `lodging_unit_aliases` (`alias_string`, `valid_from_year`)",
      "CREATE INDEX `idx_lodging_alias_string` ON `lodging_unit_aliases` (`alias_string`)"
    ]
  });
  app.save(aliases);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("lodging_unit_aliases"));
});
