/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create camper_history collection
 * Dependencies: persons, camp_sessions, bunks
 *
 * Stores denormalized camper history with pre-joined data and computed retention metrics.
 * One row per camper-session-year. Used for nonprofit reporting and analytics.
 *
 * Computed by Go: pocketbase/sync/camper_history.go
 * Exported to Google Sheets: {year}-camper-history
 *
 * CONSOLIDATED: Includes changes from migrations 36, 37, 40 (first_year, session_types, v2 rework)
 */

const COLLECTION_ID_CAMPER_HISTORY = "col_camper_history";

migrate((app) => {
  const personsCol = app.findCollectionByNameOrId("persons");
  const sessionsCol = app.findCollectionByNameOrId("camp_sessions");

  const collection = new Collection({
    id: COLLECTION_ID_CAMPER_HISTORY,
    type: "base",
    name: "camper_history",
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.id != ""',
    fields: [
      // Person identification (CampMinder ID, not PB ID)
      {
        type: "number",
        name: "person_id",
        required: true,
        presentable: true,
        min: 1,
        max: null,
        onlyInt: true
      },
      {
        type: "text",
        name: "first_name",
        required: false,
        presentable: true,
        min: 0,
        max: 100,
        pattern: ""
      },
      {
        type: "text",
        name: "last_name",
        required: false,
        presentable: true,
        min: 0,
        max: 100,
        pattern: ""
      },

      // Year scope
      {
        type: "number",
        name: "year",
        required: true,
        presentable: false,
        min: 2010,
        max: 2100,
        onlyInt: true
      },

      // Session identification (added in v2 rework)
      {
        type: "number",
        name: "session_cm_id",
        required: true,
        presentable: false,
        min: 1,
        max: null,
        onlyInt: true
      },
      {
        type: "relation",
        name: "session",
        required: false,
        presentable: false,
        collectionId: sessionsCol.id,
        cascadeDelete: false,
        minSelect: null,
        maxSelect: 1
      },
      {
        type: "text",
        name: "session_name",
        required: false,
        presentable: false,
        min: 0,
        max: 200,
        pattern: ""
      },
      {
        type: "select",
        name: "session_type",
        required: false,
        presentable: false,
        values: ["main", "embedded", "ag", "family", "quest", "training", "bmitzvah", "tli", "adult", "school", "hebrew", "teen", "other"],
        maxSelect: 1
      },

      // Person relation (added in v2 rework)
      {
        type: "relation",
        name: "person",
        required: false,
        presentable: false,
        collectionId: personsCol.id,
        cascadeDelete: false,
        minSelect: null,
        maxSelect: 1
      },

      // Bunk data (single value per record in v2)
      {
        type: "number",
        name: "bunk_cm_id",
        required: false,
        presentable: false,
        min: null,
        max: null,
        onlyInt: true
      },
      {
        type: "text",
        name: "bunk_name",
        required: false,
        presentable: false,
        min: 0,
        max: 100,
        pattern: ""
      },

      // Demographics (from persons table)
      {
        type: "text",
        name: "school",
        required: false,
        presentable: false,
        min: 0,
        max: 200,
        pattern: ""
      },
      {
        type: "text",
        name: "city",
        required: false,
        presentable: false,
        min: 0,
        max: 100,
        pattern: ""
      },
      {
        type: "number",
        name: "grade",
        required: false,
        presentable: false,
        min: null,
        max: 15,
        onlyInt: true
      },
      {
        type: "number",
        name: "age",
        required: false,
        presentable: false,
        min: 0,
        max: 120,
        onlyInt: false
      },

      // Context-aware retention metrics (v2 rework)
      {
        type: "bool",
        name: "is_returning_summer",
        required: false,
        presentable: false
      },
      {
        type: "bool",
        name: "is_returning_family",
        required: false,
        presentable: false
      },
      {
        type: "number",
        name: "years_at_camp",
        required: false,
        presentable: false,
        min: 0,
        max: 50,
        onlyInt: true
      },
      {
        type: "number",
        name: "first_year_summer",
        required: false,
        presentable: false,
        min: 2010,
        max: 2100,
        onlyInt: true
      },
      {
        type: "number",
        name: "first_year_family",
        required: false,
        presentable: false,
        min: 0,
        max: 2100,
        onlyInt: true
      },

      // Household and demographic fields (for retention analysis)
      {
        type: "number",
        name: "household_id",
        required: false,
        presentable: false,
        min: 0,
        max: null,
        onlyInt: true
      },
      {
        type: "text",
        name: "gender",
        required: false,
        presentable: false,
        min: 0,
        max: 20,
        pattern: ""
      },
      {
        type: "text",
        name: "division_name",
        required: false,
        presentable: false,
        min: 0,
        max: 100,
        pattern: ""
      },
      {
        type: "text",
        name: "enrollment_date",
        required: false,
        presentable: false,
        min: 0,
        max: 30,
        pattern: ""
      },
      {
        type: "text",
        name: "status",
        required: false,
        presentable: false,
        min: 0,
        max: 50,
        pattern: ""
      },
      {
        type: "text",
        name: "synagogue",
        required: false,
        presentable: false,
        min: 0,
        max: 200,
        pattern: ""
      },

      // Auto timestamps
      {
        type: "autodate",
        name: "created",
        required: false,
        presentable: false,
        onCreate: true,
        onUpdate: false
      },
      {
        type: "autodate",
        name: "updated",
        required: false,
        presentable: false,
        onCreate: true,
        onUpdate: true
      }
    ],
    indexes: [
      "CREATE UNIQUE INDEX `idx_camper_history_unique` ON `camper_history` (`person_id`, `session_cm_id`, `year`)",
      "CREATE INDEX `idx_camper_history_year` ON `camper_history` (`year`)",
      "CREATE INDEX `idx_camper_history_household` ON `camper_history` (`household_id`)",
      "CREATE INDEX `idx_camper_history_status` ON `camper_history` (`status`)",
      "CREATE INDEX `idx_camper_history_session_type` ON `camper_history` (`session_type`)",
      "CREATE INDEX `idx_camper_history_session_cm_id` ON `camper_history` (`session_cm_id`)",
      "CREATE INDEX `idx_camper_history_returning_summer` ON `camper_history` (`is_returning_summer`, `year`)",
      "CREATE INDEX `idx_camper_history_returning_family` ON `camper_history` (`is_returning_family`, `year`)",
      "CREATE INDEX `idx_camper_history_person_rel` ON `camper_history` (`person`)",
      "CREATE INDEX `idx_camper_history_session_rel` ON `camper_history` (`session`)",
      "CREATE INDEX `idx_camper_history_first_year_summer` ON `camper_history` (`first_year_summer`)"
    ]
  });

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("camper_history");
  app.delete(collection);
});
