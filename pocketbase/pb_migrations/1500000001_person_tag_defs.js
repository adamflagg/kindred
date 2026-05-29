/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create person_tag_defs collection
 * Dependencies: None
 *
 * Stores tag definitions from CampMinder /persons/tags endpoint.
 * Tags like "Alumni", "Volunteer", "Leadership", etc.
 * Note: CampMinder TagDef uses Name as identifier (no ID field).
 */

const COLLECTION_ID_PERSON_TAG_DEFS = "col_person_tag_defs";

migrate((app) => {
  const adminOnly = '@request.auth.is_admin = true';

  const collection = new Collection({
    id: COLLECTION_ID_PERSON_TAG_DEFS,
    type: "base",
    name: "person_tag_defs",
    listRule: adminOnly,
    viewRule: adminOnly,
    createRule: adminOnly,
    updateRule: adminOnly,
    deleteRule: adminOnly,
    fields: [
      {
        type: "text",
        name: "name",
        required: true,
        presentable: true
      },
      {
        type: "bool",
        name: "is_seasonal",
        required: false,
        presentable: false
      },
      {
        type: "bool",
        name: "is_hidden",
        required: false,
        presentable: false
      },
      {
        type: "text",
        name: "last_updated_utc",
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
      "CREATE UNIQUE INDEX `idx_person_tag_defs_name` ON `person_tag_defs` (`name`)"
    ]
  });

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("person_tag_defs");
  app.delete(collection);
});
