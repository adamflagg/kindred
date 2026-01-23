/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create camp_sessions collection
 * Dependencies: session_groups
 *
 * Stores session definitions from CampMinder with support for main, embedded,
 * AG, and other session types. Uses parent_id for AG session relationships.
 */

const COLLECTION_ID_CAMP_SESSIONS = "col_camp_sessions";

migrate((app) => {
  const sessionGroupsCol = app.findCollectionByNameOrId("session_groups");

  let collection = new Collection({
    id: COLLECTION_ID_CAMP_SESSIONS,
    type: "base",
    name: "camp_sessions",
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.id != ""',
    fields: [
      {
        type: "number",
        name: "cm_id",
        required: true,
        presentable: false,
        min: 0,
        max: null,
        onlyInt: true
      },
      {
        type: "text",
        name: "name",
        required: true,
        presentable: true,
        options: {
          min: null,
          max: null,
          pattern: ""
        }
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
        type: "date",
        name: "start_date",
        required: true,
        presentable: false,
        options: {
          min: "",
          max: ""
        }
      },
      {
        type: "date",
        name: "end_date",
        required: true,
        presentable: false,
        options: {
          min: "",
          max: ""
        }
      },
      {
        type: "select",
        name: "session_type",
        required: true,
        presentable: false,
        values: ["main", "embedded", "ag", "family", "quest", "training", "bmitzvah", "tli", "adult", "school", "hebrew", "teen", "other"],
        maxSelect: 1
      },
      {
        type: "number",
        name: "parent_id",
        required: false,
        presentable: false,
        min: 0,
        max: null,
        onlyInt: true
      },
      {
        type: "text",
        name: "description",
        required: false,
        presentable: false,
        options: {
          min: null,
          max: null,
          pattern: ""
        }
      },
      {
        type: "bool",
        name: "is_active",
        required: false,
        presentable: false
      },
      {
        type: "number",
        name: "sort_order",
        required: false,
        presentable: false,
        min: null,
        max: null,
        onlyInt: true
      },
      {
        type: "relation",
        name: "session_group",
        required: false,
        presentable: false,
        collectionId: sessionGroupsCol.id,
        cascadeDelete: false,
        minSelect: null,
        maxSelect: 1
      },
      {
        type: "bool",
        name: "is_day",
        required: false,
        presentable: false
      },
      {
        type: "bool",
        name: "is_residential",
        required: false,
        presentable: false
      },
      {
        type: "bool",
        name: "is_for_children",
        required: false,
        presentable: false
      },
      {
        type: "bool",
        name: "is_for_adults",
        required: false,
        presentable: false
      },
      {
        type: "number",
        name: "start_grade_id",
        required: false,
        presentable: false,
        min: null,
        max: null,
        onlyInt: true
      },
      {
        type: "number",
        name: "end_grade_id",
        required: false,
        presentable: false,
        min: null,
        max: null,
        onlyInt: true
      },
      {
        type: "number",
        name: "gender_id",
        required: false,
        presentable: false,
        min: null,
        max: null,
        onlyInt: true
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
      }
    ],
    indexes: [
      "CREATE UNIQUE INDEX `idx_camp_sessions_id_year` ON `camp_sessions` (`cm_id`, `year`)",
      "CREATE INDEX idx_camp_sessions_parent ON camp_sessions (parent_id)",
      "CREATE INDEX idx_camp_sessions_type ON camp_sessions (session_type)"
    ]
  });

  app.save(collection);
}, (app) => {
  let collection = app.findCollectionByNameOrId("camp_sessions");
  app.delete(collection);
});
