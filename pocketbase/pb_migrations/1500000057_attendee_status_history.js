/// <reference path="../pb_data/types.d.ts" />

/**
 * Migration: Create attendee_status_history collection
 *
 * Tracks status changes for attendees detected during sync.
 * Used by the waitlist analysis feature to identify:
 * - Previously waitlisted campers who were accepted (enrolled)
 * - Previously waitlisted campers who declined (cancelled/withdrawn/dismissed)
 */
migrate((app) => {
  const personsCol = app.findCollectionByNameOrId("persons")
  const sessionsCol = app.findCollectionByNameOrId("camp_sessions")

  const statusValues = [
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
  ]

  const collection = new Collection({
    name: "attendee_status_history",
    type: "base",
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.is_admin = true',
    updateRule: '@request.auth.is_admin = true',
    deleteRule: '@request.auth.is_admin = true',
    fields: [
      {
        type: "number",
        name: "person_id",
        required: true,
        presentable: false,
        min: null,
        max: null,
        onlyInt: true
      },
      {
        type: "relation",
        name: "person",
        required: false,
        presentable: false,
        collectionId: personsCol.id,
        cascadeDelete: false,
        minSelect: null,
        maxSelect: 1
      },
      {
        type: "relation",
        name: "session",
        required: true,
        presentable: false,
        collectionId: sessionsCol.id,
        cascadeDelete: false,
        minSelect: null,
        maxSelect: 1
      },
      {
        type: "select",
        name: "old_status",
        required: true,
        presentable: false,
        values: statusValues,
        maxSelect: 1
      },
      {
        type: "select",
        name: "new_status",
        required: true,
        presentable: false,
        values: statusValues,
        maxSelect: 1
      },
      {
        type: "date",
        name: "detected_at",
        required: true,
        presentable: false,
        min: "",
        max: ""
      },
      {
        type: "number",
        name: "year",
        required: true,
        presentable: false,
        min: 2010,
        max: 2100,
        onlyInt: true
      }
    ],
    indexes: [
      "CREATE INDEX idx_ash_old_status_year ON attendee_status_history (old_status, year)",
      "CREATE INDEX idx_ash_person_session_year ON attendee_status_history (person_id, session, year)"
    ]
  })

  app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("attendee_status_history")
  app.delete(collection)
})
