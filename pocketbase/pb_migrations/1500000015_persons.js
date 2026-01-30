/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create persons collection
 * Dependencies: households, divisions, person_tag_defs
 *
 * Stores person records from CampMinder with demographic info, contact details,
 * household relationships, and tag associations. Year-scoped for data isolation.
 *
 * CONSOLIDATED: Includes changes from migrations 38, 41 (drop cm_fields, age decimal)
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
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.id != ""',
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
        max: 0,  // 0 = unlimited (matches current running state)
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
      // NOTE: cm_years_at_camp and cm_last_year_attended removed (redundant with above fields)
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
        name: "phone_numbers",
        type: "json",
        required: false,
        presentable: false,
        maxSize: 0  // 0 = unlimited (matches current running state)
      },
      {
        name: "email_addresses",
        type: "json",
        required: false,
        presentable: false,
        maxSize: 0  // 0 = unlimited (matches current running state)
      },
      {
        name: "address",
        type: "json",
        required: false,
        presentable: false,
        maxSize: 0  // 0 = unlimited (matches current running state)
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
        max: 0,  // 0 = unlimited (matches current running state)
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
        maxSize: 0  // 0 = unlimited (matches current running state)
      },
      {
        name: "parent_names",
        type: "json",
        required: false,
        presentable: false,
        maxSize: 0  // 0 = unlimited (matches current running state)
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
