/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_3262161419")

  // add field
  collection.fields.addAt(7, new Field({
    "hidden": false,
    "id": "bool1784410456",
    "name": "is_delete",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "bool"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_3262161419")

  // remove field
  collection.fields.removeById("bool1784410456")

  return app.save(collection)
})
