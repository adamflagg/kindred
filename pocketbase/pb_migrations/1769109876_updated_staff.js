/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("col_staff")

  // update field
  collection.fields.addAt(9, new Field({
    "cascadeDelete": false,
    "collectionId": "col_bunks",
    "hidden": false,
    "id": "relation1954412382",
    "maxSelect": 999,
    "minSelect": 0,
    "name": "bunks",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "relation"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("col_staff")

  // update field
  collection.fields.addAt(9, new Field({
    "cascadeDelete": false,
    "collectionId": "col_bunks",
    "hidden": false,
    "id": "relation1954412382",
    "maxSelect": 0,
    "minSelect": 0,
    "name": "bunks",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "relation"
  }))

  return app.save(collection)
})
