/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Add {{field_names}} to {{collection_name}}
 *
 * {{description}}
 */

migrate((app) => {
  const collection = app.findCollectionByNameOrId("{{collection_name}}");

  // Add new field (fields.add with matching name upserts existing fields)
  collection.fields.add(new Field({
    type: "text",
    name: "{{field_name}}",
    required: false,
    presentable: false,
    min: 0,
    max: 200,
    pattern: ""
  }));

  // To remove a field instead:
  // collection.fields.removeByName("old_field");

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("{{collection_name}}");

  // Reverse: remove added fields
  collection.fields.removeByName("{{field_name}}");

  // Reverse: restore removed fields
  // collection.fields.add(new Field({ ... original definition ... }));

  app.save(collection);
});
