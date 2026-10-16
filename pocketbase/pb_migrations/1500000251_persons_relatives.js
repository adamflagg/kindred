/// <reference path="../pb_data/types.d.ts" />
/**
 * persons.relatives: CampMinder's Relatives for a person, as [{cm_id, is_guardian, is_primary}] in
 * CampMinder's order (epic #3207 decision 44: stop dropping the primary flag; IsPrimary is true when
 * that relative is "parent 1"). A later caregiver drill-down uses it for a true primary-first order;
 * parent_names keeps the mailing-title order. Ids and flags only, no names. Additive and nullable:
 * rows fill on the next persons sync. No backfill.
 */
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId("persons")
    collection.fields.add(
      new Field({ type: "json", name: "relatives", required: false, presentable: false, maxSize: 200000 })
    )
    app.save(collection)
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("persons")
    collection.fields.removeByName("relatives")
    app.save(collection)
  }
)
