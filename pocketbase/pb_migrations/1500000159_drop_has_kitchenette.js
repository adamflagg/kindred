/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: drop the redundant `has_kitchenette` bool from `lodging_units`.
 *
 * OWNER RULING (kindred#2390): "staff has decided a kitchen and a kitchenette
 * are equivalent... kitchens are kitchens. there aren't enough to split hairs,
 * and they may all be kitchenette's honestly." `has_kitchenette` was added by
 * 1500000137 to REFINE `has_kitchen` — "narrows has_kitchen" — never to
 * contradict it, so a consumer reading only `has_kitchen` was already correct.
 * The column's only remaining job was flagging 4 of the 22 kitchen units as
 * smaller, a distinction staff no longer act on.
 *
 * Verified against production (`pocketbase/pb_data/data-prod.db`,
 * `lodging_units`, 118 rows): `has_kitchenette = 1` occurs ONLY where
 * `has_kitchen = 1` (4 rows), and there is no `has_kitchenette = 1 AND
 * has_kitchen = 0` row. This is a pure column drop — no data migration, no
 * backfill, because collapsing the two changes zero verdicts.
 */
migrate((app) => {
  const collection = app.findCollectionByNameOrId("lodging_units")
  const field = collection.fields.getByName("has_kitchenette")
  if (field) {
    collection.fields.removeById(field.id)
    app.save(collection)
  }
}, (app) => {
  // Down: re-add the field exactly as 1500000137 defined it.
  const collection = app.findCollectionByNameOrId("lodging_units")
  collection.fields.add(new Field({
    type: "bool",
    name: "has_kitchenette",
    required: false,
    presentable: false,
  }))
  app.save(collection)
})
