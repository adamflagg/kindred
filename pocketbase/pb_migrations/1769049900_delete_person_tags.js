/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Delete person_tags junction table
 *
 * This table is no longer needed now that tags are stored as a multi-select
 * relation field directly on the persons table.
 *
 * The person_tags table was a junction table between persons and person_tag_defs.
 * With the new schema, persons.tags[] directly references person_tag_defs.
 */

migrate((app) => {
  const collection = app.findCollectionByNameOrId("person_tags")
  app.delete(collection)
}, (app) => {
  // Down migration - recreate the person_tags junction table
  // Note: This is for rollback purposes only; data would need to be repopulated via sync
  const personsCol = app.findCollectionByNameOrId("persons")
  const tagDefsCol = app.findCollectionByNameOrId("person_tag_defs")

  const collection = new Collection({
    name: "person_tags",
    type: "base",
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      {
        type: "number",
        name: "person_id",
        required: true,
        presentable: false,
        min: 1,
        max: null,
        noDecimal: true
      },
      {
        type: "text",
        name: "tag_name",
        required: true,
        presentable: false,
        options: { min: null, max: 200, pattern: "" }
      },
      {
        type: "number",
        name: "year",
        required: true,
        presentable: false,
        min: 2017,
        max: 2100,
        noDecimal: true
      },
      {
        type: "text",
        name: "last_updated_utc",
        required: false,
        presentable: false,
        options: { min: null, max: 50, pattern: "" }
      },
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
      {
        type: "relation",
        name: "tag_definition",
        required: false,
        presentable: false,
        collectionId: tagDefsCol.id,
        cascadeDelete: false,
        minSelect: null,
        maxSelect: 1
      }
    ],
    indexes: [
      "CREATE INDEX `idx_person_tags_lookup` ON `person_tags` (`person_id`, `year`)",
      "CREATE UNIQUE INDEX `idx_person_tags_unique` ON `person_tags` (`person_id`, `tag_name`, `year`)"
    ]
  })

  app.save(collection)
})
