/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId("geo_overrides")

    collection.fields.add(
      new Field({
        name: "nominatim_status",
        type: "select",
        required: false,
        values: ["resolved", "no_result", "ambiguous"],
        maxSelect: 1,
      })
    )

    app.save(collection)
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("geo_overrides")

    collection.fields.removeByName("nominatim_status")

    app.save(collection)
  }
)
