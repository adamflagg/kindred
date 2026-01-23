/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("col_camp_sessions")

  // remove field
  collection.fields.removeById("number2908426004")

  // remove field
  collection.fields.removeById("number3618756047")

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("col_camp_sessions")

  // add field
  collection.fields.addAt(17, new Field({
    "hidden": false,
    "id": "number2908426004",
    "max": null,
    "min": null,
    "name": "start_age",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(18, new Field({
    "hidden": false,
    "id": "number3618756047",
    "max": null,
    "min": null,
    "name": "end_age",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  return app.save(collection)
})
