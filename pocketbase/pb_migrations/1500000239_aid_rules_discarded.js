/// <reference path="../pb_data/types.d.ts" />
/**
 * aid_rules.discarded: a rules draft thrown away with Discard draft (owner 2026-10-08). The version is kept, not
 * deleted: a scenario that names it as its origin still loads it by number, the change log still replays it, and the
 * next version never reuses its number. Every read of "the season's versions" leaves it out
 * (AidRulesRepository.list_versions). Additive: false on every existing row. No backfill.
 */
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId("aid_rules")
    collection.fields.add(new Field({ type: "bool", name: "discarded", required: false, presentable: false }))
    app.save(collection)
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("aid_rules")
    collection.fields.removeByName("discarded")
    app.save(collection)
  }
)
