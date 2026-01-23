/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Add parent_division self-relation to divisions
 * Dependencies: divisions
 *
 * Adds the self-referencing relation field for division hierarchy.
 * CampMinder's SubOfDivisionID field references another division.
 */

migrate((app) => {
  const collection = app.findCollectionByNameOrId("divisions");

  // Add parent_division self-reference relation
  collection.fields.add(new Field({
    type: "relation",
    name: "parent_division",
    required: false,
    presentable: false,
    system: false,
    collectionId: collection.id, // Self-reference
    cascadeDelete: false,
    minSelect: null,
    maxSelect: 1
  }));

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("divisions");
  collection.fields.removeByName("parent_division");
  app.save(collection);
});
