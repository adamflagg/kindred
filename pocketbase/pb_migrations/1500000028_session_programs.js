/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create session_programs collection
 * Dependencies: None
 *
 * Stores program definitions from CampMinder (e.g., "Junior Camp", "Teen Camp")
 */

// Fixed collection ID for session_programs
const COLLECTION_ID_SESSION_PROGRAMS = "col_session_programs";

migrate((app) => {
  const collection = new Collection({
    id: COLLECTION_ID_SESSION_PROGRAMS,
    type: "base",
    name: "session_programs",
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
        system: false,
        options: {
          min: 0,
          max: null,
          noDecimal: true
        }
      },
      {
        type: "text",
        name: "name",
        required: true,
        presentable: true,
        system: false,
        options: {
          min: null,
          max: null,
          pattern: ""
        }
      },
      {
        type: "text",
        name: "description",
        required: false,
        presentable: false,
        system: false,
        options: {
          min: null,
          max: null,
          pattern: ""
        }
      },
      {
        type: "number",
        name: "session_cm_id",
        required: false,
        presentable: false,
        system: false,
        options: {
          min: null,
          max: null,
          noDecimal: true
        }
      },
      {
        type: "number",
        name: "start_age",
        required: false,
        presentable: false,
        system: false,
        options: {
          min: null,
          max: null,
          noDecimal: true
        }
      },
      {
        type: "number",
        name: "end_age",
        required: false,
        presentable: false,
        system: false,
        options: {
          min: null,
          max: null,
          noDecimal: true
        }
      },
      {
        type: "number",
        name: "start_grade_id",
        required: false,
        presentable: false,
        system: false,
        options: {
          min: null,
          max: null,
          noDecimal: true
        }
      },
      {
        type: "number",
        name: "end_grade_id",
        required: false,
        presentable: false,
        system: false,
        options: {
          min: null,
          max: null,
          noDecimal: true
        }
      },
      {
        type: "bool",
        name: "is_active",
        required: false,
        presentable: false,
        system: false
      },
      {
        type: "number",
        name: "year",
        required: true,
        presentable: false,
        system: false,
        options: {
          min: 2010,
          max: 2100,
          noDecimal: true
        }
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
      "CREATE UNIQUE INDEX `idx_session_programs_cm_id_year` ON `session_programs` (`cm_id`, `year`)",
      "CREATE INDEX `idx_session_programs_year` ON `session_programs` (`year`)",
      "CREATE INDEX `idx_session_programs_session` ON `session_programs` (`session_cm_id`)"
    ]
  });

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("session_programs");
  app.delete(collection);
});
