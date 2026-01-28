/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Drop redundant cm_* fields from persons table
 *
 * These fields are duplicates:
 * - cm_years_at_camp: identical to years_at_camp (both from CampMinder YearsAtCamp)
 * - cm_last_year_attended: identical to last_year_attended (uncapped version, but unused)
 *
 * The years_at_camp and last_year_attended fields remain and are the canonical source.
 */

migrate((app) => {
  const collection = app.findCollectionByNameOrId("persons");

  // Remove redundant fields
  collection.fields.removeByName("cm_years_at_camp");
  collection.fields.removeByName("cm_last_year_attended");

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("persons");

  // Re-add fields for rollback
  collection.fields.add(new Field({
    name: "cm_years_at_camp",
    type: "number",
    required: false,
    presentable: false,
    min: 0,
    max: 100,
    onlyInt: true
  }));

  collection.fields.add(new Field({
    name: "cm_last_year_attended",
    type: "number",
    required: false,
    presentable: false,
    min: 0,
    max: 2100,
    onlyInt: true
  }));

  app.save(collection);
});
