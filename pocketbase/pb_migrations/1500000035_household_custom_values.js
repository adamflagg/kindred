/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create household_custom_values collection
 * Dependencies: households, custom_field_defs
 *
 * Stores custom field values for households from CampMinder /households/{id}/custom-fields endpoint.
 * This is an on-demand sync (not part of daily sync) due to requiring 1 API call per household.
 */

const COLLECTION_ID_HOUSEHOLD_CUSTOM_VALUES = "col_household_cf_vals";

migrate((app) => {
  const householdsCol = app.findCollectionByNameOrId("households");
  const customFieldDefsCol = app.findCollectionByNameOrId("custom_field_defs");

  const collection = new Collection({
    id: COLLECTION_ID_HOUSEHOLD_CUSTOM_VALUES,
    type: "base",
    name: "household_custom_values",
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.id != ""',
    fields: [
      // Relation to households collection
      {
        type: "relation",
        name: "household",
        required: false,
        presentable: false,
        system: false,
        collectionId: householdsCol.id,
        cascadeDelete: false,
        minSelect: null,
        maxSelect: 1
      },
      // Relation to custom_field_defs collection
      {
        type: "relation",
        name: "field_definition",
        required: false,
        presentable: false,
        system: false,
        collectionId: customFieldDefsCol.id,
        cascadeDelete: false,
        minSelect: null,
        maxSelect: 1
      },
      // The actual value (stored as text, typed by definition)
      {
        type: "text",
        name: "value",
        required: false,
        presentable: true,
        system: false,
        options: {
          min: null,
          max: 10000,
          pattern: ""
        }
      },
      // Year for filtering
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
      // Last updated timestamp from CampMinder
      {
        type: "text",
        name: "last_updated",
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
      "CREATE UNIQUE INDEX `idx_household_cf_vals_unique` ON `household_custom_values` (`year`, `household`, `field_definition`)",
      "CREATE INDEX `idx_household_cf_vals_household` ON `household_custom_values` (`year`, `household`)",
      "CREATE INDEX `idx_household_cf_vals_field` ON `household_custom_values` (`year`, `field_definition`)"
    ]
  });

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("household_custom_values");
  app.delete(collection);
});
