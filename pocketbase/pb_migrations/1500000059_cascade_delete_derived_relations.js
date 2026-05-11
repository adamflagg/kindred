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
 * - household_demographics.household -> households
 * - family_camp_adults.household -> households
 * - family_camp_registrations.household -> households
 * - family_camp_medical.household -> households
 */

migrate((app) => {
  const householdsCol = app.findCollectionByNameOrId("households");

  // 1. household_demographics.household
  const hhDemo = app.findCollectionByNameOrId("household_demographics");
  hhDemo.fields.add(new Field({
    type: "relation",
    name: "household",
    required: true,
    presentable: false,
    collectionId: householdsCol.id,
    cascadeDelete: true,
    minSelect: null,
    maxSelect: 1
  }));
  app.save(hhDemo);

  // 2. family_camp_adults.household
  const fcAdults = app.findCollectionByNameOrId("family_camp_adults");
  fcAdults.fields.add(new Field({
    type: "relation",
    name: "household",
    required: true,
    presentable: false,
    collectionId: householdsCol.id,
    cascadeDelete: true,
    minSelect: null,
    maxSelect: 1
  }));
  app.save(fcAdults);

  // 3. family_camp_registrations.household
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

  // 4. family_camp_medical.household
  const fcMed = app.findCollectionByNameOrId("family_camp_medical");
  fcMed.fields.add(new Field({
    type: "relation",
    name: "household",
    required: true,
    presentable: false,
    collectionId: householdsCol.id,
    cascadeDelete: true,
    minSelect: null,
    maxSelect: 1
  }));
  app.save(fcMed);

}, (app) => {
  const householdsCol = app.findCollectionByNameOrId("households");

  const hhDemo = app.findCollectionByNameOrId("household_demographics");
  hhDemo.fields.add(new Field({
    type: "relation",
    name: "household",
    required: true,
    presentable: false,
    collectionId: householdsCol.id,
    cascadeDelete: false,
    minSelect: null,
    maxSelect: 1
  }));
  app.save(hhDemo);

  const fcAdults = app.findCollectionByNameOrId("family_camp_adults");
  fcAdults.fields.add(new Field({
    type: "relation",
    name: "household",
    required: true,
    presentable: false,
    collectionId: householdsCol.id,
    cascadeDelete: false,
    minSelect: null,
    maxSelect: 1
  }));
  app.save(fcAdults);

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

  const fcMed = app.findCollectionByNameOrId("family_camp_medical");
  fcMed.fields.add(new Field({
    type: "relation",
    name: "household",
    required: true,
    presentable: false,
    collectionId: householdsCol.id,
    cascadeDelete: false,
    minSelect: null,
    maxSelect: 1
  }));
  app.save(fcMed);
});
