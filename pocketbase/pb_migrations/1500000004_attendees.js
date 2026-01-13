/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create attendees collection
 * Dependencies: camp_sessions (1500000001), persons (1500000005)
 *
 * Uses dynamic collection lookups via findCollectionByNameOrId().
 * Dependencies must be created in earlier migrations.
 */

migrate((app) => {
  // Dynamic lookups - these collections were created in earlier migrations
  const personsCol = app.findCollectionByNameOrId("persons")
  const sessionsCol = app.findCollectionByNameOrId("camp_sessions")

  const collection = new Collection({
    name: "attendees",
    type: "base",
    system: false,
    fields: [
      {
        name: "person_id",
        type: "number",
        system: false,
        required: true,
        unique: false,
        options: {
          min: null,
          max: null,
          noDecimal: true
        }
      },
      {
        name: "person",
        type: "relation",
        system: false,
        required: false,
        presentable: false,
        collectionId: personsCol.id,
        cascadeDelete: false,
        minSelect: null,
        maxSelect: 1
      },
      {
        name: "status",
        type: "select",
        system: false,
        required: false,
        unique: false,
        values: [
          "enrolled",
          "applied",
          "waitlisted",
          "left_early",
          "cancelled",
          "dismissed",
          "inquiry",
          "withdrawn",
          "incomplete",
          "unknown"
        ],
        maxSelect: 1
      },
      {
        name: "status_id",
        type: "number",
        system: false,
        required: false,
        unique: false,
        options: {
          min: null,
          max: null,
          noDecimal: true
        }
      },
      {
        name: "year",
        type: "number",
        system: false,
        required: true,
        unique: false,
        options: {
          min: null,
          max: null,
          noDecimal: true
        }
      },
      {
        name: "enrollment_date",
        type: "date",
        system: false,
        required: false,
        unique: false,
        options: {
          min: "",
          max: ""
        }
      },
      {
        name: "is_active",
        type: "bool",
        system: false,
        required: false,
        unique: false,
        options: {}
      },
      {
        name: "session",
        type: "relation",
        system: false,
        required: true,
        presentable: false,
        collectionId: sessionsCol.id,
        cascadeDelete: false,
        minSelect: null,
        maxSelect: 1
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
      "CREATE INDEX `idx_CTOLST0M8l` ON `attendees` (`person`)",
      "CREATE UNIQUE INDEX `idx_ZT5KuF3OgF` ON `attendees` (`person_id`, `year`, `session`)"
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
  const collection = app.findCollectionByNameOrId("attendees")
  return app.delete(collection)
})
