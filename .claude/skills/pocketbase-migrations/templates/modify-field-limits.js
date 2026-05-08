/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Increase field limits for {{collection_name}}
 *
 * {{description}}
 */

migrate((app) => {
  const collection = app.findCollectionByNameOrId("{{collection_name}}");

  // fields.add() with an existing field name upserts — updates the field definition
  // {{field_name}}: {{old_limit}} -> {{new_limit}}
  collection.fields.add(new Field({
    type: "text",
    name: "{{field_name}}",
    required: false,
    presentable: false,
    min: 0,
    max: 10000,   // new limit
    pattern: ""
  }));

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("{{collection_name}}");

  // Restore original limit
  // {{field_name}}: {{new_limit}} -> {{old_limit}}
  collection.fields.add(new Field({
    type: "text",
    name: "{{field_name}}",
    required: false,
    presentable: false,
    min: 0,
    max: 5000,    // original limit
    pattern: ""
  }));

  app.save(collection);
});
