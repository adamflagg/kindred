/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: drop the `camper_history` collection.
 * Dependencies: 1500000033 (created it), 1500000108 (renamed the `training`
 * session_type value to `scit` on it). See kindred#2301.
 *
 * WHAT THE TABLE WAS. A denormalized, computed camper-history table: one row
 * per person/session/year, pre-joined from attendees + persons + bunk
 * assignments + household custom values, with retention metrics
 * (is_returning_summer, is_returning_family, years_at_camp) baked in.
 * Written by pocketbase/sync/camper_history.go and exported to the
 * "{year}-camper-history" Google Sheets tab.
 *
 * WHY IT IS SAFE TO DROP. An audit for kindred#2301 confirmed zero live
 * consumers outside the writer's own blast radius: no product surface, API
 * endpoint, UI component, reporting query, or solver path reads this
 * collection, and no other collection carries a schema relation into it. The
 * only reads were (1) the writer's own idempotency/orphan-sweep comparison
 * inside camper_history.go, and (2) a `*_normalized` column rewrite inside
 * normalize_geographic.go's Step 6 — both removed in the same PR that adds
 * this migration.
 *
 * THE DATA IS NOT RECOVERABLE FROM THIS MIGRATION'S DOWN ARM. 36,687 rows are
 * being dropped, and PocketBase's SQLite backend has no undo for a DROP TABLE
 * -- the down arm below recreates the empty SCHEMA only, not the rows. That is
 * an acceptable loss because the table was itself a computed cache: every
 * field on it is re-derivable from attendees + persons + bunk_assignments +
 * household_custom_values, the same source tables camper_history.go read to
 * populate it in the first place. Nothing here is a system of record.
 *
 * SCHEMA RECREATED BELOW is the collection's final live shape: the original
 * fields from 1500000033_camper_history.js, plus the three *_normalized
 * columns that migration added in a second app.save(), with session_type's
 * `values` and `required` updated to match what 1500000108 left in place
 * (the "scit" rename; "training" was never a live value after that migration
 * ran).
 */

const COLLECTION_ID_CAMPER_HISTORY = "col_camper_history";

migrate((app) => {
  const collection = app.findCollectionByNameOrId("camper_history");
  app.delete(collection);
}, (app) => {
  const personsCol = app.findCollectionByNameOrId("persons");
  const sessionsCol = app.findCollectionByNameOrId("camp_sessions");

  const adminOnly = '@request.auth.is_admin = true';

  const collection = new Collection({
    id: COLLECTION_ID_CAMPER_HISTORY,
    type: "base",
    name: "camper_history",
    listRule: adminOnly,
    viewRule: adminOnly,
    createRule: adminOnly,
    updateRule: adminOnly,
    deleteRule: adminOnly,
    fields: [
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
      {
        type: "number",
        name: "year",
        required: true,
        presentable: false,
        min: 2010,
        max: 2100,
        onlyInt: true
      },
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
      // Values/required as of 1500000108 (training -> scit rename), not the
      // narrower list 1500000033 originally created this field with.
      {
        type: "select",
        name: "session_type",
        required: true,
        presentable: false,
        values: ["main", "embedded", "ag", "family", "quest", "scit", "bmitzvah", "tli", "adult", "school", "hebrew", "teen", "other"],
        maxSelect: 1
      },
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
        type: "text",
        name: "state",
        required: false,
        presentable: false,
        min: 0,
        max: 50,
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
        max: 400,
        pattern: ""
      },
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
      },
      {
        type: "text",
        name: "city_normalized",
        required: false,
        presentable: false,
        min: 0,
        max: 100,
        pattern: ""
      },
      {
        type: "text",
        name: "school_normalized",
        required: false,
        presentable: false,
        min: 0,
        max: 200,
        pattern: ""
      },
      {
        type: "text",
        name: "congregation_normalized",
        required: false,
        presentable: false,
        min: 0,
        max: 300,
        pattern: ""
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
      "CREATE INDEX `idx_camper_history_session_rel` ON `camper_history` (`session`)"
    ]
  });

  app.save(collection);
});
