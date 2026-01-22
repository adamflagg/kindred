/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Fix custom_field_defs partition field for multi-select
 *
 * CampMinder API returns partition as comma-separated multi-values (e.g., "Camper, Adult").
 * Change partition field from maxSelect: 1 to maxSelect: 7 to allow multiple values.
 */

migrate((app) => {
  const collection = app.findCollectionByNameOrId("custom_field_defs");

  // Update partition field to allow multiple selections
  for (let i = 0; i < collection.fields.length; i++) {
    if (collection.fields[i].name === "partition") {
      collection.fields[i].maxSelect = 7;
      break;
    }
  }

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("custom_field_defs");

  // Revert: set maxSelect back to 1
  for (let i = 0; i < collection.fields.length; i++) {
    if (collection.fields[i].name === "partition") {
      collection.fields[i].maxSelect = 1;
      break;
    }
  }

  app.save(collection);
});
