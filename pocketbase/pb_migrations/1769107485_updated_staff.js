/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("col_staff")

  // remove field
  collection.fields.removeById("number561756999")

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("col_staff")

  // add field
  collection.fields.addAt(1, new Field({
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

  return app.save(collection)
})
