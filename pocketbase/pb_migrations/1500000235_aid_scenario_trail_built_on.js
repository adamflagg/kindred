/// <reference path="../pb_data/types.d.ts" />
/**
 * aid_scenario_trail.built_on_version: the rules version a Scenarios draft was started on (owner 10-07, "sure").
 * A kept option records it as its origin, so a draft kept after a mid-session approval no longer claims the newer
 * version and can't bring older tables back through Make … the Rules Draft. Additive: 0 on every existing row means
 * "not recorded" (the old behaviour: the version in effect when it is read). No backfill.
 */
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId("aid_scenario_trail")
    collection.fields.add(
      new Field({ type: "number", name: "built_on_version", required: false, presentable: false, min: 0, max: null, onlyInt: true })
    )
    app.save(collection)
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("aid_scenario_trail")
    collection.fields.removeByName("built_on_version")
    app.save(collection)
  }
)
