/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create person_tags junction table
 * Dependencies: persons, person_tag_definitions
 *
 * Links persons to their tags. Tags are extracted from the CampMinder
 * persons response when includetags=true is set.
 */

// Fixed collection ID for person_tags
const COLLECTION_ID_PERSON_TAGS = "col_person_tags";

migrate((app) => {
  // Lookup required collections for relations
  const personsCol = app.findCollectionByNameOrId("persons");
  const tagDefsCol = app.findCollectionByNameOrId("person_tag_definitions");

  const collection = new Collection({
    id: COLLECTION_ID_PERSON_TAGS,
    type: "base",
    name: "person_tags",
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.id != ""',
    fields: [
      // Relation to persons (for PocketBase joins/expand)
      {
        type: "relation",
        name: "person",
        required: false,  // May be null initially, populated after person lookup
        presentable: false,
        system: false,
        collectionId: personsCol.id,
        cascadeDelete: false,
        minSelect: null,
        maxSelect: 1
      },
      // Relation to tag definition (for PocketBase joins/expand)
      {
        type: "relation",
        name: "tag_definition",
        required: false,  // May be null initially, populated after tag def lookup
        presentable: false,
        system: false,
        collectionId: tagDefsCol.id,
        cascadeDelete: false,
        minSelect: null,
        maxSelect: 1
      },
      // CampMinder person ID (for sync lookups)
      {
        type: "number",
        name: "person_id",
        required: true,
        presentable: false,
        system: false,
        options: {
          min: 1,
          max: null,
          noDecimal: true
        }
      },
      // Tag name (for sync lookups - matches person_tag_definitions.name)
      {
        type: "text",
        name: "tag_name",
        required: true,
        presentable: true,
        system: false,
        options: {
          min: 1,
          max: 200,
          pattern: ""
        }
      },
      // Last updated timestamp from CampMinder
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
      // Year for year-scoping
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
      // Unique constraint: one tag per person per year
      "CREATE UNIQUE INDEX `idx_person_tags_unique` ON `person_tags` (`person_id`, `tag_name`, `year`)",
      // Query by person
      "CREATE INDEX `idx_person_tags_person_id` ON `person_tags` (`person_id`, `year`)",
      // Query by tag name
      "CREATE INDEX `idx_person_tags_tag_name` ON `person_tags` (`tag_name`, `year`)"
    ]
  });

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("person_tags");
  app.delete(collection);
});
