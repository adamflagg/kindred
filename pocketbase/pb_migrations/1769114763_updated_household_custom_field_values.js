/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("col_household_cf_vals")

  // update collection data
  unmarshal({
    "indexes": [
      "CREATE UNIQUE INDEX `idx_household_cf_vals_unique` ON `household_custom_field_values` (\n  `season_id`,\n  `year`,\n  `household`,\n  `field_definition`\n)",
      "CREATE INDEX `idx_household_cf_vals_household` ON `household_custom_field_values` (\n  `year`,\n  `household`\n)",
      "CREATE INDEX `idx_household_cf_vals_field` ON `household_custom_field_values` (\n  `year`,\n  `field_definition`\n)"
    ]
  }, collection)

  // remove field
  collection.fields.removeById("number3886020675")

  // remove field
  collection.fields.removeById("number1144457136")

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("col_household_cf_vals")

  // update collection data
  unmarshal({
    "indexes": [
      "CREATE UNIQUE INDEX `idx_household_cf_vals_unique` ON `household_custom_field_values` (`household_id`, `field_id`, `season_id`, `year`)",
      "CREATE INDEX `idx_household_cf_vals_household` ON `household_custom_field_values` (`household_id`, `year`)",
      "CREATE INDEX `idx_household_cf_vals_field` ON `household_custom_field_values` (`field_id`, `year`)"
    ]
  }, collection)

  // add field
  collection.fields.addAt(3, new Field({
    "hidden": false,
    "id": "number3886020675",
    "max": null,
    "min": null,
    "name": "household_id",
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

  return app.save(collection)
})
