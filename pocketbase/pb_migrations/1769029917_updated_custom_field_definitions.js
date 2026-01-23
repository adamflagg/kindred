/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("col_custom_field_defs")

  // update collection data
  unmarshal({
    "indexes": [
      "CREATE UNIQUE INDEX `idx_custom_field_defs_cm_id_year` ON `custom_field_definitions` (`cm_id`)",
      "CREATE INDEX `idx_custom_field_defs_partition` ON `custom_field_definitions` (`partition`)"
    ]
  }, collection)

  // remove field
  collection.fields.removeById("number3145888567")

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("col_custom_field_defs")

  // update collection data
  unmarshal({
    "indexes": [
      "CREATE UNIQUE INDEX `idx_custom_field_defs_cm_id_year` ON `custom_field_definitions` (`cm_id`, `year`)",
      "CREATE INDEX `idx_custom_field_defs_year` ON `custom_field_definitions` (`year`)",
      "CREATE INDEX `idx_custom_field_defs_partition` ON `custom_field_definitions` (`partition`)"
    ]
  }, collection)

  // add field
  collection.fields.addAt(8, new Field({
    "hidden": false,
    "id": "number3145888567",
    "max": null,
    "min": null,
    "name": "year",
    "onlyInt": false,
    "presentable": false,
    "required": true,
    "system": false,
    "type": "number"
  }))

  return app.save(collection)
})
