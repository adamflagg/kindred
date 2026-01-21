/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create custom_field_definitions collection
 * Dependencies: None
 *
 * Stores custom field definitions from CampMinder /persons/custom-fields endpoint.
 * Defines the schema for custom fields that can be attached to persons or households.
 */

// Fixed collection ID for custom_field_definitions
const COLLECTION_ID_CUSTOM_FIELD_DEFINITIONS = "col_custom_field_defs";

migrate((app) => {
  const collection = new Collection({
    id: COLLECTION_ID_CUSTOM_FIELD_DEFINITIONS,
    type: "base",
    name: "custom_field_definitions",
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
        presentable: true,
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
          max: 500,
          pattern: ""
        }
      },
      {
        type: "select",
        name: "data_type",
        required: false,
        presentable: false,
        system: false,
        values: ["None", "String", "Integer", "Decimal", "Date", "Time", "DateTime", "Boolean"],
        maxSelect: 1
      },
      {
        type: "select",
        name: "partition",
        required: false,
        presentable: false,
        system: false,
        values: ["None", "Family", "Alumnus", "Staff", "Camper", "Parent", "Adult"],
        maxSelect: 1
      },
      {
        type: "bool",
        name: "is_seasonal",
        required: false,
        presentable: false,
        system: false
      },
      {
        type: "bool",
        name: "is_array",
        required: false,
        presentable: false,
        system: false
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
      "CREATE UNIQUE INDEX `idx_custom_field_defs_cm_id_year` ON `custom_field_definitions` (`cm_id`, `year`)",
      "CREATE INDEX `idx_custom_field_defs_year` ON `custom_field_definitions` (`year`)",
      "CREATE INDEX `idx_custom_field_defs_partition` ON `custom_field_definitions` (`partition`)"
    ]
  });

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("custom_field_definitions");
  app.delete(collection);
});
