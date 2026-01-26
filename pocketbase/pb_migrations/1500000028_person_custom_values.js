/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create person_custom_values collection
 * Dependencies: persons, custom_field_defs
 *
 * Stores custom field values for persons from CampMinder /{personId}/custom-fields endpoint.
 * This is an on-demand sync (not part of daily sync) due to requiring 1 API call per person.
 *
 * IMPORTANT: Uses fixed collection ID so dependent migrations can reference
 * it directly without findCollectionByNameOrId (which fails in fresh DB).
 */

const COLLECTION_ID_PERSON_CUSTOM_VALUES = "col_person_cf_vals";

migrate((app) => {
  // Get collection IDs for relations
  const personsCol = app.findCollectionByNameOrId("persons");
  const customFieldDefsCol = app.findCollectionByNameOrId("custom_field_defs");

  const collection = new Collection({
    id: COLLECTION_ID_PERSON_CUSTOM_VALUES,
    type: "base",
    name: "person_custom_values",
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.id != ""',
    fields: [
      // Relation to persons collection
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
      // Relation to custom_field_defs collection
      {
        type: "relation",
        name: "field_definition",
        required: false,
        presentable: false,
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
        min: 0,
        max: 100000,
        pattern: ""
      },
      // Year for filtering
      {
        type: "number",
        name: "year",
        required: true,
        presentable: false,
        min: 2010,
        max: 2100,
        onlyInt: true
      },
      // Last updated timestamp from CampMinder
      {
        type: "text",
        name: "last_updated",
        required: false,
        presentable: false,
        min: 0,
        max: 0,
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
      }
    ],
    indexes: [
      "CREATE UNIQUE INDEX `idx_person_cf_vals_unique` ON `person_custom_values` (`year`, `person`, `field_definition`)",
      "CREATE INDEX `idx_person_cf_vals_person` ON `person_custom_values` (`year`, `person`)",
      "CREATE INDEX `idx_person_cf_vals_field` ON `person_custom_values` (`year`, `field_definition`)"
    ]
  });

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("person_custom_values");
  app.delete(collection);
});
