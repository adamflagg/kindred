/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Add household relations and CamperDetails fields to persons
 * Dependencies: persons, households
 *
 * Adds:
 * - principal_household: relation to households (person's own household as head/adult)
 * - primary_childhood_household: relation to households (where child primarily lives)
 * - alternate_childhood_household: relation to households (secondary home, e.g., divorced parents)
 * - division_id: CampMinder division ID
 * - partition_id: CampMinder partition ID (grade grouping)
 * - lead_date: Lead/inquiry date from CampMinder
 * - tshirt_size: T-shirt size from CampMinder
 *
 * Note: household_id (legacy integer) already exists and is kept for backward compatibility
 */

migrate((app) => {
  const collection = app.findCollectionByNameOrId("persons");
  const householdsCol = app.findCollectionByNameOrId("households");

  // Add principal_household relation field (person's own household as head/adult)
  collection.fields.add(new Field({
    type: "relation",
    name: "principal_household",
    required: false,
    presentable: false,
    system: false,
    collectionId: householdsCol.id,
    cascadeDelete: false,
    minSelect: null,
    maxSelect: 1
  }));

  // Add primary_childhood_household relation field (where child primarily lives)
  collection.fields.add(new Field({
    type: "relation",
    name: "primary_childhood_household",
    required: false,
    presentable: false,
    system: false,
    collectionId: householdsCol.id,
    cascadeDelete: false,
    minSelect: null,
    maxSelect: 1
  }));

  // Add alternate_childhood_household relation field (secondary home)
  collection.fields.add(new Field({
    type: "relation",
    name: "alternate_childhood_household",
    required: false,
    presentable: false,
    system: false,
    collectionId: householdsCol.id,
    cascadeDelete: false,
    minSelect: null,
    maxSelect: 1
  }));

  // Add division_id field
  collection.fields.add(new Field({
    type: "number",
    name: "division_id",
    required: false,
    presentable: false,
    system: false,
    options: {
      min: null,
      max: null,
      noDecimal: true
    }
  }));

  // Add partition_id field
  collection.fields.add(new Field({
    type: "number",
    name: "partition_id",
    required: false,
    presentable: false,
    system: false,
    options: {
      min: null,
      max: null,
      noDecimal: true
    }
  }));

  // Add lead_date field
  collection.fields.add(new Field({
    type: "text",
    name: "lead_date",
    required: false,
    presentable: false,
    system: false,
    options: {
      min: null,
      max: null,
      pattern: ""
    }
  }));

  // Add tshirt_size field
  collection.fields.add(new Field({
    type: "text",
    name: "tshirt_size",
    required: false,
    presentable: false,
    system: false,
    options: {
      min: null,
      max: 50,
      pattern: ""
    }
  }));

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("persons");

  collection.fields.removeByName("principal_household");
  collection.fields.removeByName("primary_childhood_household");
  collection.fields.removeByName("alternate_childhood_household");
  collection.fields.removeByName("division_id");
  collection.fields.removeByName("partition_id");
  collection.fields.removeByName("lead_date");
  collection.fields.removeByName("tshirt_size");

  app.save(collection);
});
