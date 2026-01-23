/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("col_person_tag_defs")

  // update collection data
  unmarshal({
    "indexes": [
      "CREATE UNIQUE INDEX `idx_person_tag_defs_name_year` ON `person_tag_defs` (`name`)"
    ],
    "name": "person_tag_defs"
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("col_person_tag_defs")

  // update collection data
  unmarshal({
    "indexes": [
      "CREATE UNIQUE INDEX `idx_person_tag_defs_name_year` ON `person_tag_definitions` (`name`)"
    ],
    "name": "person_tag_definitions"
  }, collection)

  return app.save(collection)
})
