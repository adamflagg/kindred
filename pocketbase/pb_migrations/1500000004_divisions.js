/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create divisions collection
 * Dependencies: None
 *
 * Stores division definitions from CampMinder /divisions endpoint.
 * Divisions define age/gender groups like "Boys 3rd-4th Grade".
 * Note: Divisions are global (not year-specific) - they define group structures.
 */

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
          max: 200,
          pattern: ""
        }
      },
      {
        type: "text",
        name: "description",
        required: false,
        presentable: false,
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
        type: "number",
        name: "capacity",
        required: false,
        presentable: false,
        min: null,
        max: null,
        onlyInt: true
      },
      {
        type: "bool",
        name: "assign_on_enrollment",
        required: false,
        presentable: false
      },
      {
        type: "bool",
        name: "staff_only",
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
      "CREATE UNIQUE INDEX `idx_divisions_cm_id` ON `divisions` (`cm_id`)"
    ]
  });

  // Save collection first (self-reference requires collection to exist)
  app.save(collection);

  // Add parent_division self-reference relation after collection exists
  const savedCollection = app.findCollectionByNameOrId("divisions");
  savedCollection.fields.add(new Field({
    type: "relation",
    name: "parent_division",
    required: false,
    presentable: false,
    collectionId: savedCollection.id,
    cascadeDelete: false,
    minSelect: null,
    maxSelect: 1
  }));
  app.save(savedCollection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("divisions");
  app.delete(collection);
});
