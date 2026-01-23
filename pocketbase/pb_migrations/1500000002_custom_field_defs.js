/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create custom_field_defs collection
 * Dependencies: None
 *
 * Stores custom field definitions from CampMinder /persons/custom-fields endpoint.
 * Defines the schema for custom fields that can be attached to persons or households.
 */

const COLLECTION_ID_CUSTOM_FIELD_DEFS = "col_custom_field_defs";

migrate((app) => {
  const collection = new Collection({
    id: COLLECTION_ID_CUSTOM_FIELD_DEFS,
    type: "base",
    name: "custom_field_defs",
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
        min: 1,
        max: null,
        onlyInt: true
      },
      {
        type: "text",
        name: "name",
        required: true,
        presentable: true,
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
        values: ["None", "String", "Integer", "Decimal", "Date", "Time", "DateTime", "Boolean"],
        maxSelect: 1
      },
      {
        type: "select",
        name: "partition",
        required: false,
        presentable: false,
        values: ["None", "Family", "Alumnus", "Staff", "Camper", "Parent", "Adult"],
        maxSelect: 7
      },
      {
        type: "bool",
        name: "is_seasonal",
        required: false,
        presentable: false
      },
      {
        type: "bool",
        name: "is_array",
        required: false,
        presentable: false
      },
      {
        type: "bool",
        name: "is_active",
        required: false,
        presentable: false
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
      "CREATE UNIQUE INDEX `idx_custom_field_defs_cm_id` ON `custom_field_defs` (`cm_id`)",
      "CREATE INDEX `idx_custom_field_defs_partition` ON `custom_field_defs` (`partition`)"
    ]
  });

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("custom_field_defs");
  app.delete(collection);
});
