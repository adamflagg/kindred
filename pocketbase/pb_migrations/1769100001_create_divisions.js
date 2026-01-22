/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create divisions collection
 * Dependencies: None
 *
 * Stores division definitions from CampMinder /divisions endpoint.
 * Divisions define age/gender groups like "Boys 3rd-4th Grade".
 * Note: Divisions are global (not year-specific) - they define group structures.
 *
 * The parent_division self-reference relation is added in a separate migration
 * since the collection must exist first.
 */

// Fixed collection ID for divisions
const COLLECTION_ID_DIVISIONS = "col_divisions";

migrate((app) => {
  const collection = new Collection({
    id: COLLECTION_ID_DIVISIONS,
    type: "base",
    name: "divisions",
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
          min: 1,
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
          min: 1,
          max: 200,
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
          max: 1000,
          pattern: ""
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
        type: "number",
        name: "gender_id",
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
        name: "capacity",
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
        name: "assign_on_enrollment",
        required: false,
        presentable: false,
        system: false
      },
      {
        type: "bool",
        name: "staff_only",
        required: false,
        presentable: false,
        system: false
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
      "CREATE UNIQUE INDEX `idx_divisions_cm_id` ON `divisions` (`cm_id`)"
    ]
  });

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("divisions");
  app.delete(collection);
});
