/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("col_households")

  // remove field
  collection.fields.removeById("text1028867911")

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("col_households")

  // add field
  collection.fields.addAt(8, new Field({
    "autogeneratePattern": "",
    "hidden": false,
    "id": "text1028867911",
    "max": 0,
    "min": 0,
    "name": "last_updated_utc",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  return app.save(collection)
})
