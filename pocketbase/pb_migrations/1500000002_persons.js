/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create persons collection
 * Dependencies: households, divisions, person_tag_defs
 *
 * IMPORTANT: Uses fixed collection ID so dependent migrations can reference
 * it directly without findCollectionByNameOrId (which fails in fresh DB).
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
    system: false,
    fields: [
      {
        name: "cm_id",
        type: "number",
        required: true,
        presentable: false,
        system: false,
        options: {
          min: null,
          max: null,
          noDecimal: true
        }
      },
      {
        name: "first_name",
        type: "text",
        required: true,
        presentable: true,
        system: false,
        options: {
          min: null,
          max: null,
          pattern: ""
        }
      },
      {
        name: "last_name",
        type: "text",
        required: true,
        presentable: true,
        system: false,
        options: {
          min: null,
          max: null,
          pattern: ""
        }
      },
      {
        name: "preferred_name",
        type: "text",
        required: false,
        presentable: false,
        system: false,
        options: {
          min: null,
          max: null,
          pattern: ""
        }
      },
      {
        name: "birthdate",
        type: "text",
        required: false,
        presentable: false,
        system: false,
        options: {
          min: null,
          max: null,
          pattern: ""
        }
      },
      {
        name: "gender",
        type: "text",
        required: false,
        presentable: false,
        system: false,
        options: {
          min: null,
          max: 10,
          pattern: ""
        }
      },
      {
        name: "grade",
        type: "number",
        required: false,
        presentable: false,
        system: false,
        options: {
          min: null,
          max: null,
          noDecimal: true
        }
      },
      {
        name: "age",
        type: "number",
        required: false,
        presentable: false,
        system: false,
        options: {
          min: null,
          max: null,
          noDecimal: true
        }
      },
      {
        name: "school",
        type: "text",
        required: false,
        presentable: false,
        system: false,
        options: {
          min: null,
          max: null,
          pattern: ""
        }
      },
      {
        name: "years_at_camp",
        type: "number",
        required: false,
        presentable: false,
        system: false,
        options: {
          min: null,
          max: null,
          noDecimal: true
        }
      },
      {
        name: "last_year_attended",
        type: "number",
        required: false,
        presentable: false,
        system: false,
        options: {
          min: null,
          max: null,
          noDecimal: true
        }
      },
      {
        name: "gender_identity_id",
        type: "number",
        required: false,
        presentable: false,
        system: false,
        options: {
          min: null,
          max: null,
          noDecimal: true
        }
      },
      {
        name: "gender_identity_name",
        type: "text",
        required: false,
        presentable: false,
        system: false,
        options: {
          min: null,
          max: null,
          pattern: ""
        }
      },
      {
        name: "gender_identity_write_in",
        type: "text",
        required: false,
        presentable: false,
        system: false,
        options: {
          min: null,
          max: null,
          pattern: ""
        }
      },
      {
        name: "gender_pronoun_id",
        type: "number",
        required: false,
        presentable: false,
        system: false,
        options: {
          min: null,
          max: null,
          noDecimal: true
        }
      },
      {
        name: "gender_pronoun_name",
        type: "text",
        required: false,
        presentable: false,
        system: false,
        options: {
          min: null,
          max: null,
          pattern: ""
        }
      },
      {
        name: "gender_pronoun_write_in",
        type: "text",
        required: false,
        presentable: false,
        system: false,
        options: {
          min: null,
          max: null,
          pattern: ""
        }
      },
      {
        name: "phone_numbers",
        type: "json",
        required: false,
        presentable: false,
        system: false,
        options: {
          maxSize: 2000000
        }
      },
      {
        name: "email_addresses",
        type: "json",
        required: false,
        presentable: false,
        system: false,
        options: {
          maxSize: 2000000
        }
      },
      {
        name: "address",
        type: "json",
        required: false,
        presentable: false,
        system: false,
        options: {
          maxSize: 2000000
        }
      },
      {
        name: "household_id",
        type: "number",
        required: false,
        presentable: false,
        system: false,
        options: {
          min: null,
          max: null,
          noDecimal: true
        }
      },
      {
        type: "relation",
        name: "primary_childhood_household",
        required: false,
        presentable: false,
        system: false,
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
        system: false,
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
        system: false,
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
        system: false,
        options: {
          min: null,
          max: null,
          noDecimal: true
        }
      },
      {
        name: "lead_date",
        type: "text",
        required: false,
        presentable: false,
        system: false,
        options: {
          min: null,
          max: null,
          pattern: ""
        }
      },
      {
        name: "tshirt_size",
        type: "text",
        required: false,
        presentable: false,
        system: false,
        options: {
          min: null,
          max: 50,
          pattern: ""
        }
      },
      {
        type: "relation",
        name: "tags",
        required: false,
        presentable: false,
        system: false,
        collectionId: tagDefsCol.id,
        cascadeDelete: true,
        minSelect: null,
        maxSelect: 999
      },
      {
        name: "is_camper",
        type: "bool",
        required: false,
        presentable: false,
        system: false,
        options: {}
      },
      {
        name: "raw_data",
        type: "json",
        required: false,
        presentable: false,
        system: false,
        options: {
          maxSize: 2000000
        }
      },
      {
        name: "parent_names",
        type: "json",
        required: false,
        presentable: false,
        system: false,
        options: {
          maxSize: 2000000
        }
      },
      {
        name: "year",
        type: "number",
        required: true,
        presentable: false,
        system: false,
        options: {
          min: null,
          max: null,
          noDecimal: true
        }
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
      "CREATE INDEX idx_persons_family ON persons (household_id)"
    ],
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.id != ""',
    options: {}
  })

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("persons")
  return app.delete(collection)
})