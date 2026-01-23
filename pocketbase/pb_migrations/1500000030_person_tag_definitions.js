/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create person_tag_definitions collection
 * Dependencies: None
 *
 * Stores tag definitions from CampMinder /persons/tags endpoint.
 * Tags like "Alumni", "Volunteer", "Leadership", etc.
 * Note: CampMinder TagDef uses Name as identifier (no ID field).
 */

// Fixed collection ID for person_tag_definitions
const COLLECTION_ID_PERSON_TAG_DEFINITIONS = "col_person_tag_defs";

migrate((app) => {
  const collection = new Collection({
    id: COLLECTION_ID_PERSON_TAG_DEFINITIONS,
    type: "base",
    name: "person_tag_definitions",
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.id != ""',
    fields: [
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
        type: "bool",
        name: "is_seasonal",
        required: false,
        presentable: false,
        system: false
      },
      {
        type: "bool",
        name: "is_hidden",
        required: false,
        presentable: false,
        system: false
      },
      {
        type: "text",
        name: "last_updated_utc",
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
      "CREATE UNIQUE INDEX `idx_person_tag_defs_name_year` ON `person_tag_definitions` (`name`, `year`)",
      "CREATE INDEX `idx_person_tag_defs_year` ON `person_tag_definitions` (`year`)"
    ]
  });

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("person_tag_definitions");
  app.delete(collection);
});
