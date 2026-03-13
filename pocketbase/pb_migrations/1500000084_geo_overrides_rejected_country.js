/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Add address_country to geo_overrides and "rejected" override type
 *
 * - Adds address_country text column for country context on overrides
 * - Adds "rejected" to override_type select values for blocklist entries
 */

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId("geo_overrides")

    // Add address_country text field
    collection.fields.add(new Field({
      type: "text",
      name: "address_country",
      required: false,
      presentable: false,
      min: 0,
      max: 100
    }))

    // Update override_type to include "rejected"
    collection.fields.add(new Field({
      type: "select",
      name: "override_type",
      required: true,
      presentable: true,
      values: ["alias", "canonical", "merge", "rejected"],
      maxSelect: 1
    }))

    app.save(collection)
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("geo_overrides")

    collection.fields.removeByName("address_country")

    // Revert override_type to original values
    collection.fields.add(new Field({
      type: "select",
      name: "override_type",
      required: true,
      presentable: true,
      values: ["alias", "canonical", "merge"],
      maxSelect: 1
    }))

    app.save(collection)
  }
)
