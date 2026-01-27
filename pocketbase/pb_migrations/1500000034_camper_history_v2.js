/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Add 6 new fields to camper_history collection
 * Dependencies: camper_history (1500000033)
 *
 * Adds fields for enhanced retention/registration analysis:
 * - household_id: For family groupings and VLOOKUP to household data
 * - gender: Direct retention analysis by gender
 * - division_name: Age group analysis
 * - enrollment_date: Registration velocity analysis (earliest date for year)
 * - status: Aggregated enrollment status
 * - synagogue: Retention analysis by synagogue (from household_custom_values)
 */

migrate((app) => {
  const collection = app.findCollectionByNameOrId("camper_history");

  // Add household_id - CampMinder household ID for family groupings
  collection.fields.add(new Field({
    type: "number",
    name: "household_id",
    required: false,
    presentable: false,
    min: 0,
    max: 0,  // 0 = unlimited
    onlyInt: true
  }));

  // Add gender - from persons.gender
  collection.fields.add(new Field({
    type: "text",
    name: "gender",
    required: false,
    presentable: false,
    min: 0,
    max: 20,
    pattern: ""
  }));

  // Add division_name - resolved from divisions via persons.division
  collection.fields.add(new Field({
    type: "text",
    name: "division_name",
    required: false,
    presentable: false,
    min: 0,
    max: 100,
    pattern: ""
  }));

  // Add enrollment_date - earliest enrollment date for the year
  collection.fields.add(new Field({
    type: "text",
    name: "enrollment_date",
    required: false,
    presentable: false,
    min: 0,
    max: 30,
    pattern: ""
  }));

  // Add status - aggregated enrollment status (enrolled if any, else first)
  collection.fields.add(new Field({
    type: "text",
    name: "status",
    required: false,
    presentable: false,
    min: 0,
    max: 50,
    pattern: ""
  }));

  // Add synagogue - from household_custom_values lookup
  collection.fields.add(new Field({
    type: "text",
    name: "synagogue",
    required: false,
    presentable: false,
    min: 0,
    max: 200,
    pattern: ""
  }));

  // Add index on household_id for family grouping queries
  collection.indexes.push(
    "CREATE INDEX `idx_camper_history_household` ON `camper_history` (`household_id`)"
  );

  // Add index on status for filtering
  collection.indexes.push(
    "CREATE INDEX `idx_camper_history_status` ON `camper_history` (`status`)"
  );

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("camper_history");

  // Remove indexes first
  collection.indexes = collection.indexes.filter(idx =>
    !idx.includes("idx_camper_history_household") &&
    !idx.includes("idx_camper_history_status")
  );

  // Remove fields
  collection.fields.removeByName("synagogue");
  collection.fields.removeByName("status");
  collection.fields.removeByName("enrollment_date");
  collection.fields.removeByName("division_name");
  collection.fields.removeByName("gender");
  collection.fields.removeByName("household_id");

  app.save(collection);
});
