/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("col_bunks")

  // add field
  collection.fields.addAt(5, new Field({
    "hidden": false,
    "id": "bool458715613",
    "name": "is_active",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "bool"
  }))

  // add field
  collection.fields.addAt(6, new Field({
    "hidden": false,
    "id": "number1169138922",
    "max": null,
    "min": null,
    "name": "sort_order",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(7, new Field({
    "hidden": false,
    "id": "number3171893404",
    "max": null,
    "min": null,
    "name": "area_id",
    "onlyInt": true,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("col_bunks")

  // remove field
  collection.fields.removeById("bool458715613")

  // remove field
  collection.fields.removeById("number1169138922")

  // remove field
  collection.fields.removeById("number3171893404")

  return app.save(collection)
})
