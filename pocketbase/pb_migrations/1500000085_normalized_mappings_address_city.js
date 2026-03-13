/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Add address_city to normalized_mappings
 *
 * Stores the raw persons.address_city alongside each normalized mapping
 * so drilldown queries can display the original city value.
 */

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId("normalized_mappings")

    collection.fields.add(new Field({
      type: "text",
      name: "address_city",
      required: false,
      presentable: false,
      min: 0,
      max: 200
    }))

    app.save(collection)
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("normalized_mappings")
    collection.fields.removeByName("address_city")
    app.save(collection)
  }
)
