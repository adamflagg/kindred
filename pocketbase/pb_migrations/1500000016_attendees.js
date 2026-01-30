/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create attendees collection
 * Dependencies: persons, camp_sessions
 *
 * Links persons to camp sessions with enrollment status. Year-scoped to prevent
 * data contamination when CampMinder reuses session IDs across years.
 *
 * CONSOLIDATED: Includes changes from migration 1500000040 (add "none" status)
 */

const COLLECTION_ID_ATTENDEES = "col_attendees";

migrate((app) => {
  const personsCol = app.findCollectionByNameOrId("persons");
  const sessionsCol = app.findCollectionByNameOrId("camp_sessions");

  const collection = new Collection({
    id: COLLECTION_ID_ATTENDEES,
    name: "attendees",
    type: "base",
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.id != ""',
    fields: [
      {
        name: "person_id",
        type: "number",
        required: true,
        presentable: false,
        min: null,
        max: null,
        onlyInt: true
      },
      {
        name: "person",
        type: "relation",
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
        required: false,
        presentable: false,
        values: [
          "none",
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
        required: false,
        presentable: false,
        min: null,
        max: null,
        onlyInt: true
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
        name: "enrollment_date",
        type: "date",
        required: false,
        presentable: false,
        min: "",
        max: ""
      },
      {
        name: "is_active",
        type: "bool",
        required: false,
        presentable: false
      },
      {
        name: "session",
        type: "relation",
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
      "CREATE INDEX `idx_attendees_person` ON `attendees` (`person`)",
      "CREATE UNIQUE INDEX `idx_attendees_unique` ON `attendees` (`person_id`, `year`, `session`)"
    ]
  });

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("attendees");
  app.delete(collection);
});
