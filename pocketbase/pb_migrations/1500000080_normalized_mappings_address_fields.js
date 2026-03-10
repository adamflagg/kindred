/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId("normalized_mappings")

    collection.fields.add(new Field({
      type: "text",
      name: "address_state",
      required: false,
      presentable: false,
      min: 0,
      max: 50
    }))

    collection.fields.add(new Field({
      type: "text",
      name: "address_country",
      required: false,
      presentable: false,
      min: 0,
      max: 100
    }))

    app.save(collection)
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("normalized_mappings")
    collection.fields.removeByName("address_state")
    collection.fields.removeByName("address_country")
    app.save(collection)
  }
)
