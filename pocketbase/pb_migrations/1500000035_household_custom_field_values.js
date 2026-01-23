/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create household_custom_field_values collection
 * Dependencies: households, custom_field_definitions
 *
 * Stores custom field values for households from CampMinder /households/{id}/custom-fields endpoint.
 * This is an on-demand sync (not part of daily sync) due to requiring 1 API call per household.
 */

// Fixed collection ID for household_custom_field_values
const COLLECTION_ID_HOUSEHOLD_CUSTOM_FIELD_VALUES = "col_household_cf_vals";

migrate((app) => {
  // Get collection IDs for relations
  const householdsCol = app.findCollectionByNameOrId("households");
  const customFieldDefsCol = app.findCollectionByNameOrId("custom_field_definitions");

  const collection = new Collection({
    id: COLLECTION_ID_HOUSEHOLD_CUSTOM_FIELD_VALUES,
    type: "base",
    name: "household_custom_field_values",
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
      // Relation to custom_field_definitions collection
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
      // CampMinder household ID (for sync lookups)
      {
        type: "number",
        name: "household_id",
        required: true,
        presentable: false,
        system: false,
        options: {
          min: 1,
          max: null,
          noDecimal: true
        }
      },
      // CampMinder custom field definition ID (for sync lookups)
      {
        type: "number",
        name: "field_id",
        required: true,
        presentable: false,
        system: false,
        options: {
          min: 1,
          max: null,
          noDecimal: true
        }
      },
      // Season ID for seasonal fields (0 or null for non-seasonal)
      {
        type: "number",
        name: "season_id",
        required: false,
        presentable: false,
        system: false,
        options: {
          min: 0,
          max: null,
          noDecimal: true
        }
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
      // Unique composite key: household + field + season + year
      "CREATE UNIQUE INDEX `idx_household_cf_vals_unique` ON `household_custom_field_values` (`household_id`, `field_id`, `season_id`, `year`)",
      // Index for querying by household
      "CREATE INDEX `idx_household_cf_vals_household` ON `household_custom_field_values` (`household_id`, `year`)",
      // Index for querying by field definition
      "CREATE INDEX `idx_household_cf_vals_field` ON `household_custom_field_values` (`field_id`, `year`)"
    ]
  });

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("household_custom_field_values");
  app.delete(collection);
});
