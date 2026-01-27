/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create camper_history collection
 * Dependencies: persons, camp_sessions, bunks
 *
 * Stores denormalized camper history with pre-joined data and computed retention metrics.
 * One row per camper-year. Used for nonprofit reporting and analytics.
 *
 * Computed by Go: pocketbase/sync/camper_history.go
 * Exported to Google Sheets: {year}-camper-history
 */

const COLLECTION_ID_CAMPER_HISTORY = "col_camper_history";

migrate((app) => {
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

      // Aggregated session/bunk data (comma-separated for multi-session campers)
      {
        type: "text",
        name: "sessions",
        required: false,
        presentable: false,
        min: 0,
        max: 500,
        pattern: ""
      },
      {
        type: "text",
        name: "bunks",
        required: false,
        presentable: false,
        min: 0,
        max: 500,
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

      // Retention metrics
      {
        type: "bool",
        name: "is_returning",
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

      // Prior year data (for returning campers)
      {
        type: "text",
        name: "prior_year_sessions",
        required: false,
        presentable: false,
        min: 0,
        max: 500,
        pattern: ""
      },
      {
        type: "text",
        name: "prior_year_bunks",
        required: false,
        presentable: false,
        min: 0,
        max: 500,
        pattern: ""
      },

      // Household and demographic fields (for retention analysis)
      {
        type: "number",
        name: "household_id",
        required: false,
        presentable: false,
        min: 0,
        max: null,  // null = unlimited for number fields
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
      "CREATE UNIQUE INDEX `idx_camper_history_person_year` ON `camper_history` (`person_id`, `year`)",
      "CREATE INDEX `idx_camper_history_year` ON `camper_history` (`year`)",
      "CREATE INDEX `idx_camper_history_is_returning` ON `camper_history` (`is_returning`)",
      "CREATE INDEX `idx_camper_history_household` ON `camper_history` (`household_id`)",
      "CREATE INDEX `idx_camper_history_status` ON `camper_history` (`status`)"
    ]
  });

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("camper_history");
  app.delete(collection);
});
