/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: lodging_ingest_issues + lodging_field_mappings
 *
 * lodging_ingest_issues is the work queue spec 3.8 requires: "When ingest meets
 * a cabin string with no alias, it records it and surfaces it in admin settings
 * with a one-click 'map this to a unit' action. Never a silent drop, never a
 * crash." It has to be a separate collection because
 * lodging_unit_aliases.member_units is required with minSelect 1, so a
 * placeholder row for an unmapped string cannot be inserted there (spec 9a.5).
 *
 * It also carries the two attribution failures, which are drops of the same kind:
 *   ambiguous_session - household attends 2+ weekends and CampMinder holds one
 *                       cabin value for the year (6-10 households per year)
 *   no_session        - a cabin value whose household has no active enrollment
 *                       (53 such values in 2025)
 *
 * lodging_field_mappings holds ONLY the human-set status spec 4.4 asks for
 * ("leaves the mapping active until a human disables it") plus the observed
 * counts behind its passive warning ("0 values in 2026, 171 in 2025"). The
 * mapping itself lives in Go (sync/lodging_fields.go): a new source field needs
 * a new target column, so it is a code change either way.
 *
 * lodging_field_mappings has NO `year` field, on purpose. The project-wide year
 * invariant covers CampMinder-derived data tables; this is a per-field admin
 * switch keyed to custom_field_defs.cm_id, and custom_field_defs itself carries
 * no year and is unique on cm_id alone (migration 1500000002). The sibling
 * registry tables are shaped the same way -- lodging_areas, lodging_units and
 * lodging_unit_aliases have no year either, while the year-scoped placement
 * tables (lodging_merges, lodging_availability, lodging_assignments) all do, as
 * does lodging_ingest_issues below. Scoping the unique index per year would
 * drop a human's is_enabled = false at every season rollover, which is exactly
 * what spec 4.4 forbids. The year dimension this table does need is carried by
 * last_seen_year / last_seen_count / prior_year_count.
 */

migrate((app) => {
  const sessionsCol = app.findCollectionByNameOrId("camp_sessions");
  const aliasesCol = app.findCollectionByNameOrId("lodging_unit_aliases");

  const issues = new Collection({
    type: "base",
    name: "lodging_ingest_issues",
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: "@request.auth.is_admin = true",
    updateRule: "@request.auth.is_admin = true",
    deleteRule: "@request.auth.is_admin = true",
    fields: [
      {
        type: "select", name: "kind", required: true, presentable: false,
        values: [
          "unresolved_alias",
          "ambiguous_alias",
          "ambiguous_session",
          "no_session",
          "field_zero_values"
        ],
        maxSelect: 1
      },
      // Verbatim source string. 500 rather than 300 so a truncated request text
      // still fits; alias_string itself is capped at 300 upstream.
      { type: "text", name: "raw_value", required: false, presentable: true, min: 0, max: 500, pattern: "" },
      { type: "text", name: "source_field", required: false, presentable: false, min: 0, max: 200, pattern: "" },
      { type: "number", name: "year", required: true, presentable: false, min: 2010, max: 2100, onlyInt: true },
      { type: "number", name: "household_cm_id", required: false, presentable: false, min: null, max: null, onlyInt: true },
      { type: "number", name: "person_cm_id", required: false, presentable: false, min: null, max: null, onlyInt: true },
      // For ambiguous_session: the last_updated heuristic's best guess. Advisory
      // only -- no assignment row is written until a human confirms it.
      {
        type: "relation", name: "suggested_session", required: false, presentable: false,
        collectionId: sessionsCol.id, cascadeDelete: false, minSelect: null, maxSelect: 1
      },
      { type: "json", name: "candidate_session_cm_ids", required: false, presentable: false, maxSize: 20000 },
      { type: "number", name: "occurrences", required: false, presentable: false, min: null, max: null, onlyInt: true },
      // Set by the Plan 3 admin UI when staff resolve an unresolved_alias item by
      // mapping the string to a unit: it points at the lodging_unit_aliases row
      // that action created. resolution_note alone loses that link, so "which
      // alias fixed this?" becomes unanswerable a season later.
      // Null for every other kind. cascadeDelete false -- deleting the alias must
      // not delete the audit trail of it having been created.
      {
        type: "relation", name: "resolved_alias", required: false, presentable: false,
        collectionId: aliasesCol.id, cascadeDelete: false, minSelect: null, maxSelect: 1
      },
      { type: "date", name: "first_seen", required: false, presentable: false, min: "", max: "" },
      { type: "date", name: "last_seen", required: false, presentable: false, min: "", max: "" },
      // Staff tick this rather than deleting the row, so the queue keeps a record
      // of what was fixed. Ingest never sets it back to false, and never writes
      // resolved_alias either -- both belong to the Plan 3 admin UI.
      { type: "bool", name: "is_resolved", required: false, presentable: false },
      { type: "text", name: "resolution_note", required: false, presentable: false, min: 0, max: 2000, pattern: "" },
      { type: "autodate", name: "created", required: false, presentable: false, onCreate: true, onUpdate: false },
      { type: "autodate", name: "updated", required: false, presentable: false, onCreate: true, onUpdate: true }
    ],
    indexes: [
      "CREATE INDEX `idx_lodging_issues_year_kind` ON `lodging_ingest_issues` (`year`, `kind`)",
      "CREATE INDEX `idx_lodging_issues_open` ON `lodging_ingest_issues` (`is_resolved`, `year`)",
      // One row per distinct problem, with an occurrences counter, instead of one
      // row per affected record. Backfilling 2022 hits the same alias string
      // five times; that is one queue item, not five.
      // household_cm_id / person_cm_id are 0 for whole-string issues like
      // unresolved_alias, which collapses them correctly. No WHERE predicate:
      // every key column is NOT NULL by PocketBase's own column defaults.
      "CREATE UNIQUE INDEX `idx_lodging_issues_dedup` ON `lodging_ingest_issues` " +
        "(`year`, `kind`, `raw_value`, `source_field`, `household_cm_id`, `person_cm_id`)"
    ]
  });
  app.save(issues);

  const mappings = new Collection({
    type: "base",
    name: "lodging_field_mappings",
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: "@request.auth.is_admin = true",
    updateRule: "@request.auth.is_admin = true",
    deleteRule: "@request.auth.is_admin = true",
    fields: [
      // custom_field_defs.cm_id. Spec 4.4: source fields are matched on cm_id,
      // never on the user-editable display name.
      { type: "number", name: "field_cm_id", required: true, presentable: true, min: 1, max: null, onlyInt: true },
      // Snapshot of the display name at last sync, for the admin UI only.
      { type: "text", name: "field_name", required: false, presentable: false, min: 0, max: 200, pattern: "" },
      { type: "text", name: "target", required: false, presentable: false, min: 0, max: 100, pattern: "" },
      // NOTE: `required: true` on a PocketBase bool means "must be true", and PB
      // has no per-field default, so an unset bool stores as false. The sync
      // therefore CREATES every row with is_enabled explicitly true and never
      // writes this field again -- only a human turns a mapping off (spec 4.4).
      { type: "bool", name: "is_enabled", required: false, presentable: false },
      { type: "number", name: "last_seen_year", required: false, presentable: false, min: null, max: null, onlyInt: true },
      { type: "number", name: "last_seen_count", required: false, presentable: false, min: null, max: null, onlyInt: true },
      { type: "number", name: "prior_year_count", required: false, presentable: false, min: null, max: null, onlyInt: true },
      { type: "text", name: "note", required: false, presentable: false, min: 0, max: 2000, pattern: "" },
      { type: "autodate", name: "created", required: false, presentable: false, onCreate: true, onUpdate: false },
      { type: "autodate", name: "updated", required: false, presentable: false, onCreate: true, onUpdate: true }
    ],
    indexes: [
      "CREATE UNIQUE INDEX `idx_lodging_field_map_cmid` ON `lodging_field_mappings` (`field_cm_id`)"
    ]
  });
  app.save(mappings);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("lodging_field_mappings"));
  app.delete(app.findCollectionByNameOrId("lodging_ingest_issues"));
});
