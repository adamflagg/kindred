/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create persons collection
 * Dependencies: households, divisions, person_tag_defs
 *
 * Stores person records from CampMinder with demographic info, contact details,
 * household relationships, and tag associations. Year-scoped for data isolation.
 */

const COLLECTION_ID_PERSONS = "col_persons";

migrate((app) => {
  const householdsCol = app.findCollectionByNameOrId("households");
  const divisionsCol = app.findCollectionByNameOrId("divisions");
  const tagDefsCol = app.findCollectionByNameOrId("person_tag_defs");

  const collection = new Collection({
    id: COLLECTION_ID_PERSONS,
    name: "persons",
    type: "base",
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.is_admin = true',
    updateRule: '@request.auth.is_admin = true',
    deleteRule: '@request.auth.is_admin = true',
    fields: [
      {
        name: "cm_id",
        type: "number",
        required: true,
        presentable: false,
        min: null,
        max: null,
        onlyInt: true
      },
      {
        name: "first_name",
        type: "text",
        required: true,
        presentable: true,
        min: 0,
        max: 0,
        pattern: ""
      },
      {
        name: "last_name",
        type: "text",
        required: true,
        presentable: true,
        min: 0,
        max: 0,
        pattern: ""
      },
      {
        name: "preferred_name",
        type: "text",
        required: false,
        presentable: false,
        min: 0,
        max: 0,
        pattern: ""
      },
      {
        name: "birthdate",
        type: "text",
        required: false,
        presentable: false,
        min: 0,
        max: 0,
        pattern: ""
      },
      {
        name: "gender",
        type: "text",
        required: false,
        presentable: false,
        min: 0,
        max: 0,
        pattern: ""
      },
      {
        name: "grade",
        type: "number",
        required: false,
        presentable: false,
        min: null,
        max: null,
        onlyInt: true
      },
      {
        name: "age",
        type: "number",
        required: false,
        presentable: false,
        min: null,
        max: null,
        onlyInt: false
      },
      {
        name: "school",
        type: "text",
        required: false,
        presentable: false,
        min: 0,
        max: 0,
        pattern: ""
      },
      {
        name: "years_at_camp",
        type: "number",
        required: false,
        presentable: false,
        min: null,
        max: null,
        onlyInt: true
      },
      {
        name: "last_year_attended",
        type: "number",
        required: false,
        presentable: false,
        min: null,
        max: null,
        onlyInt: true
      },
      {
        name: "cm_lead_date",
        type: "text",
        required: false,
        presentable: false,
        min: 0,
        max: 50,
        pattern: ""
      },
      {
        name: "gender_identity_id",
        type: "number",
        required: false,
        presentable: false,
        min: null,
        max: null,
        onlyInt: true
      },
      {
        name: "gender_identity_name",
        type: "text",
        required: false,
        presentable: false,
        min: 0,
        max: 0,
        pattern: ""
      },
      {
        name: "gender_identity_write_in",
        type: "text",
        required: false,
        presentable: false,
        min: 0,
        max: 0,
        pattern: ""
      },
      {
        name: "gender_pronoun_id",
        type: "number",
        required: false,
        presentable: false,
        min: null,
        max: null,
        onlyInt: true
      },
      {
        name: "gender_pronoun_name",
        type: "text",
        required: false,
        presentable: false,
        min: 0,
        max: 0,
        pattern: ""
      },
      {
        name: "gender_pronoun_write_in",
        type: "text",
        required: false,
        presentable: false,
        min: 0,
        max: 0,
        pattern: ""
      },
      {
        type: "relation",
        name: "household",
        required: false,
        presentable: false,
        collectionId: householdsCol.id,
        cascadeDelete: false,
        minSelect: null,
        maxSelect: 1
      },
      {
        name: "household_id",
        type: "number",
        required: false,
        presentable: false,
        min: null,
        max: null,
        onlyInt: true
      },
      {
        type: "relation",
        name: "primary_childhood_household",
        required: false,
        presentable: false,
        collectionId: householdsCol.id,
        cascadeDelete: false,
        minSelect: null,
        maxSelect: 1
      },
      {
        type: "relation",
        name: "alternate_childhood_household",
        required: false,
        presentable: false,
        collectionId: householdsCol.id,
        cascadeDelete: false,
        minSelect: null,
        maxSelect: 1
      },
      {
        type: "relation",
        name: "division",
        required: false,
        presentable: false,
        collectionId: divisionsCol.id,
        cascadeDelete: false,
        minSelect: null,
        maxSelect: 1
      },
      {
        name: "partition_id",
        type: "number",
        required: false,
        presentable: false,
        min: null,
        max: null,
        onlyInt: true
      },
      {
        name: "lead_date",
        type: "text",
        required: false,
        presentable: false,
        min: 0,
        max: 0,
        pattern: ""
      },
      {
        name: "tshirt_size",
        type: "text",
        required: false,
        presentable: false,
        min: 0,
        max: 0,
        pattern: ""
      },
      {
        type: "relation",
        name: "tags",
        required: false,
        presentable: false,
        collectionId: tagDefsCol.id,
        cascadeDelete: true,
        minSelect: null,
        maxSelect: 999
      },
      {
        name: "is_camper",
        type: "bool",
        required: false,
        presentable: false
      },
      {
        name: "raw_data",
        type: "json",
        required: false,
        presentable: false,
        maxSize: 0
      },
      {
        name: "parent_names",
        type: "json",
        required: false,
        presentable: false,
        maxSize: 0
      },
      {
        name: "year",
        type: "number",
        required: true,
        presentable: false,
        min: null,
        max: null,
        onlyInt: true
      },
      {
        type: "autodate",
        name: "created",
        required: false,
        presentable: false,
        onCreate: true,
        onUpdate: false
      },
      {
        type: "autodate",
        name: "updated",
        required: false,
        presentable: false,
        onCreate: true,
        onUpdate: true
      },
      {
        type: "text",
        name: "address_city",
        required: false,
        presentable: false,
        min: 0,
        max: 200,
        pattern: ""
      },
      {
        type: "text",
        name: "address_state",
        required: false,
        presentable: false,
        min: 0,
        max: 50,
        pattern: ""
      },
      {
        type: "email",
        name: "primary_email",
        required: false,
        presentable: false,
        exceptDomains: [],
        onlyDomains: []
      },
      {
        type: "email",
        name: "secondary_email",
        required: false,
        presentable: false,
        exceptDomains: [],
        onlyDomains: []
      },
      {
        type: "text",
        name: "normalized_school",
        required: false,
        presentable: false,
        min: 0,
        max: 500,
        pattern: ""
      },
      {
        type: "text",
        name: "normalized_city",
        required: false,
        presentable: false,
        min: 0,
        max: 500,
        pattern: ""
      },
      {
        type: "text",
        name: "normalized_congregation",
        required: false,
        presentable: false,
        min: 0,
        max: 500,
        pattern: ""
      }
    ],
    indexes: [
      "CREATE UNIQUE INDEX `idx_persons_campminder` ON `persons` (`cm_id`, `year`)",
      "CREATE INDEX idx_persons_family ON persons (household)"
    ]
  });

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("persons");
  app.delete(collection);
});
