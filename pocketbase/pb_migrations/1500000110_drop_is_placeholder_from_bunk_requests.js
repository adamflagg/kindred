/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: drop the redundant `is_placeholder` bool from `bunk_requests`.
 *
 * `is_placeholder` was a boolean shadow of `request_type == 'age_preference'`
 * — equivalent by construction and empirically (2,917 rows, 0 counterexamples).
 * The Python model now derives `is_age_preference` from `request_type`; nothing
 * reads the column. See #1245.
 */
migrate((app) => {
  const collection = app.findCollectionByNameOrId("bunk_requests")
  const field = collection.fields.getByName("is_placeholder")
  if (field) {
    collection.fields.removeById(field.id)
    app.save(collection)
  }
}, (app) => {
  // Down: re-add the field exactly as 1500000018 defined it.
  const collection = app.findCollectionByNameOrId("bunk_requests")
  collection.fields.add(new Field({
    name: "is_placeholder",
    type: "bool",
    required: false,
  }))
  app.save(collection)
})
