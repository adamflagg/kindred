/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("col_financial_transactions")

  // update collection data
  unmarshal({
    "indexes": [
      "CREATE UNIQUE INDEX `idx_financial_transactions_cm_id_year` ON `financial_transactions` (\n  `cm_id`,\n  `amount`\n)",
      "CREATE INDEX `idx_financial_transactions_year` ON `financial_transactions` (`year`)",
      "CREATE INDEX `idx_financial_transactions_post_date` ON `financial_transactions` (`post_date`)",
      "CREATE INDEX `idx_financial_transactions_category` ON `financial_transactions` (`financial_category`)",
      "CREATE INDEX `idx_M1MWgUmwil` ON `financial_transactions` (`session`)",
      "CREATE INDEX `idx_9Pyx7gPqzb` ON `financial_transactions` (`person`)",
      "CREATE INDEX `idx_3IALi6r5Vl` ON `financial_transactions` (`division`)"
    ]
  }, collection)

  // remove field
  collection.fields.removeById("number1349609342")

  // remove field
  collection.fields.removeById("number2474733994")

  // remove field
  collection.fields.removeById("number1979234607")

  // remove field
  collection.fields.removeById("number1099272841")

  // remove field
  collection.fields.removeById("number3838498488")

  // remove field
  collection.fields.removeById("number2683323397")

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("col_financial_transactions")

  // update collection data
  unmarshal({
    "indexes": [
      "CREATE UNIQUE INDEX `idx_financial_transactions_cm_id_year` ON `financial_transactions` (\n  `cm_id`,\n  `amount`\n)",
      "CREATE INDEX `idx_financial_transactions_year` ON `financial_transactions` (`year`)",
      "CREATE INDEX `idx_financial_transactions_post_date` ON `financial_transactions` (`post_date`)",
      "CREATE INDEX `idx_financial_transactions_person` ON `financial_transactions` (`person_cm_id`)",
      "CREATE INDEX `idx_financial_transactions_household` ON `financial_transactions` (`household_cm_id`)",
      "CREATE INDEX `idx_financial_transactions_session` ON `financial_transactions` (`session_cm_id`)",
      "CREATE INDEX `idx_financial_transactions_category` ON `financial_transactions` (`financial_category_id`)"
    ]
  }, collection)

  // add field
  collection.fields.addAt(10, new Field({
    "hidden": false,
    "id": "number1349609342",
    "max": null,
    "min": null,
    "name": "financial_category_id",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(22, new Field({
    "hidden": false,
    "id": "number2474733994",
    "max": null,
    "min": null,
    "name": "session_cm_id",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(25, new Field({
    "hidden": false,
    "id": "number1979234607",
    "max": null,
    "min": null,
    "name": "session_group_id",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(27, new Field({
    "hidden": false,
    "id": "number1099272841",
    "max": null,
    "min": null,
    "name": "division_id",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(29, new Field({
    "hidden": false,
    "id": "number3838498488",
    "max": null,
    "min": null,
    "name": "person_cm_id",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(31, new Field({
    "hidden": false,
    "id": "number2683323397",
    "max": null,
    "min": null,
    "name": "household_cm_id",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  return app.save(collection)
})
