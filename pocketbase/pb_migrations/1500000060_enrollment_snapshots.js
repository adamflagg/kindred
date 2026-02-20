/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const sessionsCol = app.findCollectionByNameOrId("camp_sessions")

  const collection = new Collection({
    name: "enrollment_snapshots",
    type: "base",
    system: false,
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      {
        type: "date",
        name: "snapshot_date",
        required: true,
        min: "",
        max: "",
      },
      {
        type: "number",
        name: "year",
        required: true,
        min: 2010,
        max: 2100,
        onlyInt: true,
      },
      {
        type: "number",
        name: "session_cm_id",
        required: true,
        min: 0,
        max: 0,
        onlyInt: true,
      },
      {
        type: "relation",
        name: "session",
        required: false,
        collectionId: sessionsCol.id,
        cascadeDelete: false,
        minSelect: null,
        maxSelect: 1,
      },
      {
        type: "number",
        name: "enrolled_count",
        required: true,
        min: 0,
        max: 0,
        onlyInt: true,
      },
      {
        type: "number",
        name: "waitlisted_count",
        required: true,
        min: 0,
        max: 0,
        onlyInt: true,
      },
      {
        type: "number",
        name: "cancelled_count",
        required: true,
        min: 0,
        max: 0,
        onlyInt: true,
      },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_enrollment_snapshots_unique ON enrollment_snapshots(snapshot_date, session_cm_id, year)",
      "CREATE INDEX idx_enrollment_snapshots_year_session ON enrollment_snapshots(year, session_cm_id)",
    ],
  })

  app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("enrollment_snapshots")
  app.delete(collection)
})
