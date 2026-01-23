/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("col_household_cf_vals")

  // update collection data
  unmarshal({
    "indexes": [
      "CREATE UNIQUE INDEX `idx_household_cf_vals_unique` ON `household_custom_values` (\n  `year`,\n  `household`,\n  `field_definition`\n)",
      "CREATE INDEX `idx_household_cf_vals_household` ON `household_custom_values` (\n  `year`,\n  `household`\n)",
      "CREATE INDEX `idx_household_cf_vals_field` ON `household_custom_values` (\n  `year`,\n  `field_definition`\n)"
    ]
  }, collection)

  // remove field
  collection.fields.removeById("number1321206225")

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("col_household_cf_vals")

  // update collection data
  unmarshal({
    "indexes": [
      "CREATE UNIQUE INDEX `idx_household_cf_vals_unique` ON `household_custom_values` (\n  `season_id`,\n  `year`,\n  `household`,\n  `field_definition`\n)",
      "CREATE INDEX `idx_household_cf_vals_household` ON `household_custom_values` (\n  `year`,\n  `household`\n)",
      "CREATE INDEX `idx_household_cf_vals_field` ON `household_custom_values` (\n  `year`,\n  `field_definition`\n)"
    ]
  }, collection)

  // add field
  collection.fields.addAt(3, new Field({
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

  return app.save(collection)
})
