/// <reference path="../pb_data/types.d.ts" />
// Add normalized geographic columns to persons table.
// These are populated by the normalize_geographic sync and used by
// drilldown service for consistent school/city/synagogue matching.
// The CampMinder persons sync ignores these (not in compareFields).

migrate((app) => {
  const collection = app.findCollectionByNameOrId("persons")

  collection.fields.add(new Field({
    type: "text",
    name: "normalized_school",
    required: false,
    presentable: false,
    min: 0,
    max: 500,
    pattern: ""
  }))

  collection.fields.add(new Field({
    type: "text",
    name: "normalized_city",
    required: false,
    presentable: false,
    min: 0,
    max: 500,
    pattern: ""
  }))

  collection.fields.add(new Field({
    type: "text",
    name: "normalized_congregation",
    required: false,
    presentable: false,
    min: 0,
    max: 500,
    pattern: ""
  }))

  app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("persons")
  collection.fields.removeByName("normalized_school")
  collection.fields.removeByName("normalized_city")
  collection.fields.removeByName("normalized_congregation")
  app.save(collection)
})
