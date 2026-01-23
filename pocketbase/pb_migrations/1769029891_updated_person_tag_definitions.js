/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("col_person_tag_defs")

  // update collection data
  unmarshal({
    "indexes": [
      "CREATE UNIQUE INDEX `idx_person_tag_defs_name_year` ON `person_tag_definitions` (`name`)"
    ]
  }, collection)

  // remove field
  collection.fields.removeById("number3145888567")

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("col_person_tag_defs")

  // update collection data
  unmarshal({
    "indexes": [
      "CREATE UNIQUE INDEX `idx_person_tag_defs_name_year` ON `person_tag_definitions` (`name`, `year`)",
      "CREATE INDEX `idx_person_tag_defs_year` ON `person_tag_definitions` (`year`)"
    ]
  }, collection)

  // add field
  collection.fields.addAt(5, new Field({
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
