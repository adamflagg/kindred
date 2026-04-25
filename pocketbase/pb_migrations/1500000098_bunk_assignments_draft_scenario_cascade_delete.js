/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: cascadeDelete=true on bunk_assignments_draft.scenario
 *
 * Draft bunk assignments are scoped to a scenario (see migration
 * 1500000022) — they have no meaning if the parent scenario is gone. When
 * cascadeDelete was false, deleting a scenario from the UI required a
 * frontend pre-delete loop over every draft row (N serial HTTP DELETEs
 * against PocketBase), which took several seconds on real sessions and
 * contributed to the "list vanishes behind the confirmation modal"
 * report from staff testing.
 *
 * Flipping this relation to cascadeDelete: true collapses the N+1
 * client-side deletes into a single server-side cascade. Companion
 * frontend change drops the pre-delete loop from useDeleteScenario.
 */

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId("bunk_assignments_draft")
    const scenariosCol = app.findCollectionByNameOrId("saved_scenarios")

    // fields.add() with an existing name upserts the field definition.
    // All other properties match migration 1500000022 exactly; only
    // cascadeDelete changes.
    collection.fields.add(
      new Field({
        type: "relation",
        name: "scenario",
        required: false,
        presentable: false,
        collectionId: scenariosCol.id,
        cascadeDelete: true,
        minSelect: null,
        maxSelect: 1,
      })
    )

    app.save(collection)
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("bunk_assignments_draft")
    const scenariosCol = app.findCollectionByNameOrId("saved_scenarios")

    collection.fields.add(
      new Field({
        type: "relation",
        name: "scenario",
        required: false,
        presentable: false,
        collectionId: scenariosCol.id,
        cascadeDelete: false,
        minSelect: null,
        maxSelect: 1,
      })
    )

    app.save(collection)
  }
)
