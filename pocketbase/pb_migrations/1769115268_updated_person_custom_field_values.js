/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("col_person_cf_vals")

  // update collection data
  unmarshal({
    "indexes": [
      "CREATE UNIQUE INDEX `idx_person_cf_vals_unique` ON `person_custom_values` (\n  `year`,\n  `person`,\n  `field_definition`\n)",
      "CREATE INDEX `idx_person_cf_vals_person` ON `person_custom_values` (\n  `year`,\n  `person`\n)",
      "CREATE INDEX `idx_person_cf_vals_field` ON `person_custom_values` (\n  `year`,\n  `field_definition`\n)"
    ],
    "name": "person_custom_values"
  }, collection)

  // remove field
  collection.fields.removeById("number561756999")

  // remove field
  collection.fields.removeById("number1144457136")

  // remove field
  collection.fields.removeById("number1321206225")

  // remove field
  collection.fields.removeById("text2685905599")

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("col_person_cf_vals")

  // update collection data
  unmarshal({
    "indexes": [
      "CREATE UNIQUE INDEX `idx_person_cf_vals_unique` ON `person_custom_field_values` (`person_id`, `field_id`, `season_id`, `year`)",
      "CREATE INDEX `idx_person_cf_vals_person` ON `person_custom_field_values` (`person_id`, `year`)",
      "CREATE INDEX `idx_person_cf_vals_field` ON `person_custom_field_values` (`field_id`, `year`)"
    ],
    "name": "person_custom_field_values"
  }, collection)

  // add field
  collection.fields.addAt(3, new Field({
    "hidden": false,
    "id": "number561756999",
    "max": null,
    "min": null,
    "name": "person_id",
    "onlyInt": false,
    "presentable": false,
    "required": true,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(4, new Field({
    "hidden": false,
    "id": "number1144457136",
    "max": null,
    "min": null,
    "name": "field_id",
    "onlyInt": false,
    "presentable": false,
    "required": true,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(5, new Field({
    "hidden": false,
    "id": "number1321206225",
    "max": null,
    "min": null,
    "name": "season_id",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(8, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text2685905599",
    "max": 0,
    "min": 0,
    "name": "last_updated",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  return app.save(collection)
})
