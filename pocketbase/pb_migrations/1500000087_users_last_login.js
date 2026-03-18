/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Add last_login field to users collection
 * Dependencies: None (modifies existing system collection)
 */

migrate((app) => {
  const collection = app.findCollectionByNameOrId("_pb_users_auth_")

  collection.fields.add(new Field({
    type: "date",
    name: "last_login",
    required: false,
    presentable: false,
    min: "",
    max: ""
  }))

  app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("_pb_users_auth_")

  collection.fields.removeByName("last_login")

  app.save(collection)
})
