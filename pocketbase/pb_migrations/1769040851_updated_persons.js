/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("col_persons")

  // remove field
  collection.fields.removeById("relation_principal_hh")

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("col_persons")

  // add field
  collection.fields.addAt(33, new Field({
    "cascadeDelete": false,
    "collectionId": "col_households",
    "hidden": false,
    "id": "relation_principal_hh",
    "maxSelect": 1,
    "minSelect": 0,
    "name": "principal_household",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "relation"
  }))

  return app.save(collection)
})
