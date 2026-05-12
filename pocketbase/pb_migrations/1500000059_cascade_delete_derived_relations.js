/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Enable cascadeDelete on derived table relations
 *
 * When persons/households sync deletes orphaned records (no longer in
 * CampMinder), PocketBase blocks the delete because derived tables have
 * required relations with cascadeDelete=false.
 *
 * These tables are all computed/regenerated from custom values syncs.
 * If the source person/household is gone, derived data should cascade-delete.
 *
 * Affected relations:
 * - family_camp_registrations.household -> households
 *
 * Note: family_camp_adults trimmed — final cascadeDelete=true baked into
 * merged CREATE migration #035.
 * Note: family_camp_medical trimmed — final cascadeDelete=true baked into
 * merged CREATE migration #035.
 */

migrate((app) => {
  const householdsCol = app.findCollectionByNameOrId("households");

  // 1. family_camp_registrations.household
  const fcRegs = app.findCollectionByNameOrId("family_camp_registrations");
  fcRegs.fields.add(new Field({
    type: "relation",
    name: "household",
    required: true,
    presentable: false,
    collectionId: householdsCol.id,
    cascadeDelete: true,
    minSelect: null,
    maxSelect: 1
  }));
  app.save(fcRegs);

}, (app) => {
  const householdsCol = app.findCollectionByNameOrId("households");

  const fcRegs = app.findCollectionByNameOrId("family_camp_registrations");
  fcRegs.fields.add(new Field({
    type: "relation",
    name: "household",
    required: true,
    presentable: false,
    collectionId: householdsCol.id,
    cascadeDelete: false,
    minSelect: null,
    maxSelect: 1
  }));
  app.save(fcRegs);
});
