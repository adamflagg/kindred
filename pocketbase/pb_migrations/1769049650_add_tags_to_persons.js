/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Add tags multi-select relation to persons
 *
 * Replaces the person_tags junction table with a direct multi-select relation
 * on the persons table. This simplifies the schema and eliminates ~1100 lines
 * of sync code while fixing the idempotency bug causing spurious updates.
 *
 * Tags will be repopulated on next sync.
 */

migrate((app) => {
  const collection = app.findCollectionByNameOrId("persons")
  const tagDefsCol = app.findCollectionByNameOrId("person_tag_defs")

  // Add multi-select relation to tag definitions
  collection.fields.add(new Field({
    type: "relation",
    name: "tags",
    required: false,
    presentable: false,
    system: false,
    collectionId: tagDefsCol.id,
    cascadeDelete: false,
    minSelect: null,
    maxSelect: null  // Multi-select (unlimited)
  }))

  app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("persons")
  collection.fields.removeByName("tags")
  app.save(collection)
})
