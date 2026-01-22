/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("col_financial_transactions")

  // remove field
  collection.fields.removeById("number1520506447")

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("col_financial_transactions")

  // add field
  collection.fields.addAt(19, new Field({
    "hidden": false,
    "id": "number1520506447",
    "max": null,
    "min": null,
    "name": "payment_method_id",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  return app.save(collection)
})
