/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("col_staff")

  // remove field
  collection.fields.removeById("text2685905599")

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("col_staff")

  // add field
  collection.fields.addAt(20, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text2685905599",
    "max": 0,
    "min": 0,
    "name": "last_updated",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  return app.save(collection)
})
