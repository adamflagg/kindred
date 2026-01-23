/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Replace persons.division_id with division relation
 * Dependencies: persons, divisions
 *
 * Replaces the division_id number field with a proper division relation.
 * The division relation points to the divisions table for PocketBase expands.
 * The division_id field is removed as it was not being used.
 */

migrate((app) => {
  const collection = app.findCollectionByNameOrId("persons");
  const divisionsCol = app.findCollectionByNameOrId("divisions");

  // Remove the old division_id number field
  collection.fields.removeByName("division_id");

  // Add the new division relation field
  collection.fields.add(new Field({
    type: "relation",
    name: "division",
    required: false,
    presentable: false,
    system: false,
    collectionId: divisionsCol.id,
    cascadeDelete: false,
    minSelect: null,
    maxSelect: 1
  }));

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("persons");

  // Remove the division relation
  collection.fields.removeByName("division");

  // Restore the old division_id number field
  collection.fields.add(new Field({
    type: "number",
    name: "division_id",
    required: false,
    presentable: false,
    system: false,
    options: {
      min: null,
      max: null,
      noDecimal: true
    }
  }));

  app.save(collection);
});
