/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId("bunk_requests")

    collection.fields.add(new Field({
      type: "bool",
      name: "priority_keyword_detected",
      required: false,
      presentable: false,
    }))

    app.save(collection)
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("bunk_requests")

    collection.fields.removeByName("priority_keyword_detected")

    app.save(collection)
  }
)
