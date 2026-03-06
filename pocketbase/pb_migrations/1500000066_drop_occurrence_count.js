/// <reference path="../pb_data/types.d.ts" />

// Drop the vestigial occurrence_count field from normalized_mappings.
// With the person+session schema (1 row = 1 person in 1 session),
// counts are computed by counting rows, not reading this field.
migrate((app) => {
  const collection = app.findCollectionByNameOrId("normalized_mappings")
  collection.fields.removeByName("occurrence_count")
  app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("normalized_mappings")
  collection.fields.add(new Field({
    type: "number",
    name: "occurrence_count",
    required: false,
    presentable: false,
    min: 0,
    max: 999999,
    onlyInt: true
  }))
  app.save(collection)
})
