/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("col_persons")

  // update field
  collection.fields.addAt(35, new Field({
    "cascadeDelete": true,
    "collectionId": "col_person_tag_defs",
    "hidden": false,
    "id": "relation1874629670",
    "maxSelect": 999,
    "minSelect": 0,
    "name": "tags",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "relation"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("col_persons")

  // update field
  collection.fields.addAt(35, new Field({
    "cascadeDelete": false,
    "collectionId": "col_person_tag_defs",
    "hidden": false,
    "id": "relation1874629670",
    "maxSelect": 0,
    "minSelect": 0,
    "name": "tags",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "relation"
  }))

  return app.save(collection)
})
