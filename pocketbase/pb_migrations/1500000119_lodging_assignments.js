/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: lodging_assignments + lodging_assignment_history
 *
 * DUAL GRAIN. Exactly one of household_cm_id / person_cm_id is set, and a
 * person-row OVERRIDES its household's row. That one rule covers all three cases:
 *   - family camp        -> household rows (94% of the work)
 *   - adult weekends     -> person rows (individuals into shared cabins)
 *   - a grandparent placed apart from their family -> household row + one person override
 * Keyed on CampMinder IDs per the project-wide rule, not PB relations.
 *
 * Either unit (an atomic room) or merge (a merged slot) is set, not both.
 *
 * History is append-only and mirrors attendee_status_history's shape
 * (detected_at / old_* / new_* / session / year). It exists because CampMinder
 * stores ONE cabin value per household per YEAR: a household attending two
 * weekends has its first assignment overwritten. History reconstructs both, and
 * works for two future weekends too. old_unit/new_unit are TEXT, not relations,
 * so an unresolvable historical string is still recorded rather than dropped.
 */

migrate((app) => {
  const unitsCol = app.findCollectionByNameOrId("lodging_units");
  const mergesCol = app.findCollectionByNameOrId("lodging_merges");
  const sessionsCol = app.findCollectionByNameOrId("camp_sessions");
  const scenariosCol = app.findCollectionByNameOrId("saved_scenarios");

  const assignments = new Collection({
    type: "base",
    name: "lodging_assignments",
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.is_admin = true',
    updateRule: '@request.auth.is_admin = true',
    deleteRule: '@request.auth.is_admin = true',
    fields: [
      {
        type: "relation", name: "session", required: true, presentable: false,
        collectionId: sessionsCol.id, cascadeDelete: true, minSelect: null, maxSelect: 1
      },
      { type: "number", name: "year", required: true, presentable: false, min: 2010, max: 2100, onlyInt: true },
      {
        type: "relation", name: "unit", required: false, presentable: false,
        collectionId: unitsCol.id, cascadeDelete: false, minSelect: null, maxSelect: 1
      },
      {
        type: "relation", name: "merge", required: false, presentable: false,
        collectionId: mergesCol.id, cascadeDelete: false, minSelect: null, maxSelect: 1
      },
      {
        type: "relation", name: "scenario", required: false, presentable: false,
        collectionId: scenariosCol.id, cascadeDelete: true, minSelect: null, maxSelect: 1
      },
      { type: "number", name: "household_cm_id", required: false, presentable: false, min: null, max: null, onlyInt: true },
      { type: "number", name: "person_cm_id", required: false, presentable: false, min: null, max: null, onlyInt: true },
      { type: "number", name: "party_size", required: false, presentable: false, min: null, max: null, onlyInt: true },
      {
        type: "select", name: "source", required: false, presentable: false,
        values: ["campminder_sync", "jotform_sync", "staff_manual"], maxSelect: 1
      },
      { type: "bool", name: "staff_touched", required: false, presentable: false },
      { type: "autodate", name: "created", required: false, presentable: false, onCreate: true, onUpdate: false },
      { type: "autodate", name: "updated", required: false, presentable: false, onCreate: true, onUpdate: true }
    ],
    indexes: [
      "CREATE INDEX `idx_lodging_assign_session_year` ON `lodging_assignments` (`session`, `year`)",
      "CREATE INDEX `idx_lodging_assign_household` ON `lodging_assignments` (`household_cm_id`, `year`)",
      "CREATE INDEX `idx_lodging_assign_person` ON `lodging_assignments` (`person_cm_id`, `year`)",
      // One live (scenario-less) row per household per session, and per person.
      //
      // The predicates MUST use `> 0`, not `!= ''`. PocketBase declares number
      // fields as `NUMERIC DEFAULT 0 NOT NULL`, so an unset household_cm_id is 0
      // — and SQLite evaluates `0 != ''` as TRUE (numeric-vs-text comparison).
      // With `!= ''` the household index would capture every person-grain row
      // (all household_cm_id = 0) and collide them, permitting only ONE adult
      // assignment per session. Relations are `TEXT DEFAULT '' NOT NULL`, so
      // `scenario = ''` is correct for "the live plan".
      "CREATE UNIQUE INDEX `idx_lodging_assign_hh_live` ON `lodging_assignments` (`session`, `year`, `household_cm_id`) WHERE `household_cm_id` > 0 AND `scenario` = ''",
      "CREATE UNIQUE INDEX `idx_lodging_assign_person_live` ON `lodging_assignments` (`session`, `year`, `person_cm_id`) WHERE `person_cm_id` > 0 AND `scenario` = ''"
    ]
  });
  app.save(assignments);

  const history = new Collection({
    type: "base",
    name: "lodging_assignment_history",
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.is_admin = true',
    updateRule: '@request.auth.is_admin = true',
    deleteRule: '@request.auth.is_admin = true',
    fields: [
      { type: "number", name: "household_cm_id", required: false, presentable: false, min: null, max: null, onlyInt: true },
      { type: "number", name: "person_cm_id", required: false, presentable: false, min: null, max: null, onlyInt: true },
      {
        type: "relation", name: "session", required: false, presentable: false,
        collectionId: sessionsCol.id, cascadeDelete: false, minSelect: null, maxSelect: 1
      },
      { type: "number", name: "year", required: true, presentable: false, min: 2010, max: 2100, onlyInt: true },
      // TEXT, not relations: an unresolvable historical string is still recorded.
      { type: "text", name: "old_unit", required: false, presentable: false, min: 0, max: 300, pattern: "" },
      { type: "text", name: "new_unit", required: false, presentable: false, min: 0, max: 300, pattern: "" },
      // `date`, not `text` — matches attendee_status_history.detected_at
      // (1500000057_attendee_status_history.js:83-90), the collection this
      // deliberately mirrors. Using text would lose PB's date validation and
      // would surface as an untyped string in the generated OpenAPI/TS types.
      { type: "date", name: "detected_at", required: true, presentable: false, min: "", max: "" },
      { type: "text", name: "source_field", required: false, presentable: false, min: 0, max: 200, pattern: "" },
      { type: "autodate", name: "created", required: false, presentable: false, onCreate: true, onUpdate: false }
    ],
    indexes: [
      "CREATE INDEX `idx_lodging_hist_household_year` ON `lodging_assignment_history` (`household_cm_id`, `year`)",
      "CREATE INDEX `idx_lodging_hist_person_year` ON `lodging_assignment_history` (`person_cm_id`, `year`)",
      "CREATE INDEX `idx_lodging_hist_session` ON `lodging_assignment_history` (`session`, `year`)"
    ]
  });
  app.save(history);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("lodging_assignment_history"));
  app.delete(app.findCollectionByNameOrId("lodging_assignments"));
});
