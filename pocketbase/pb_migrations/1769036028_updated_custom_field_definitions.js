/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("col_custom_field_defs")

  // update collection data
  unmarshal({
    "indexes": [
      "CREATE UNIQUE INDEX `idx_custom_field_defs_cm_id_year` ON `custom_field_defs` (`cm_id`)",
      "CREATE INDEX `idx_custom_field_defs_partition` ON `custom_field_defs` (`partition`)"
    ],
    "name": "custom_field_defs"
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("col_custom_field_defs")

  // update collection data
  unmarshal({
    "indexes": [
      "CREATE UNIQUE INDEX `idx_custom_field_defs_cm_id_year` ON `custom_field_definitions` (`cm_id`)",
      "CREATE INDEX `idx_custom_field_defs_partition` ON `custom_field_definitions` (`partition`)"
    ],
    "name": "custom_field_definitions"
  }, collection)

  return app.save(collection)
})
