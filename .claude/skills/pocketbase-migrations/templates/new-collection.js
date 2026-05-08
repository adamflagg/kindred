/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create {{collection_name}} collection
 *
 * {{description}}
 */

migrate((app) => {
  // Dynamic lookups for relation targets (if needed)
  // const personsCol = app.findCollectionByNameOrId("persons");

  const collection = new Collection({
    type: "base",
    name: "{{collection_name}}",
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.id != ""',
    fields: [
      // --- Replace with actual fields ---
      // Text field
      {
        type: "text",
        name: "name",
        required: true,
        presentable: true,
        min: 0,
        max: 200,
        pattern: ""
      },
      // Number field (use null for unbounded, not 0)
      {
        type: "number",
        name: "year",
        required: true,
        presentable: false,
        min: 2010,
        max: 2100,
        onlyInt: true
      },
      // Select field
      {
        type: "select",
        name: "status",
        required: true,
        presentable: false,
        values: ["active", "inactive"],
        maxSelect: 1
      },
      // Auto timestamps
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
      "CREATE INDEX `idx_{{collection_name}}_year` ON `{{collection_name}}` (`year`)"
    ]
  });

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("{{collection_name}}");
  app.delete(collection);
});
