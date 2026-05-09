/// <reference path="../pb_data/types.d.ts" />

/**
 * Migration: Create enrollment_snapshots collection
 *
 * Stores per-session enrollment snapshots (active, waitlisted, cancelled
 * counts plus per-gender breakdowns) keyed by (snapshot_datetime,
 * session_cm_id, year). Used by the velocity/metrics pipeline to track
 * enrollment trends without recomputing from attendees on every read.
 *
 * snapshot_datetime stores actual UTC timestamps so multiple snapshots
 * per day are allowed (manual runs add rows instead of overwriting).
 *
 * Access is admin-only — sensitive aggregate data not exposed to the
 * frontend; FastAPI metrics endpoints read via admin auth.
 */
migrate((app) => {
  const sessionsCol = app.findCollectionByNameOrId("camp_sessions")

  const adminOnly = '@request.auth.is_admin = true'

  const collection = new Collection({
    name: "enrollment_snapshots",
    type: "base",
    system: false,
    listRule: adminOnly,
    viewRule: adminOnly,
    createRule: adminOnly,
    updateRule: adminOnly,
    deleteRule: adminOnly,
    fields: [
      {
        type: "date",
        name: "snapshot_datetime",
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
        presentable: false,
        min: 1,
        max: null,
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
        required: false,
        presentable: false,
        min: null,
        max: null,
        onlyInt: true,
      },
      {
        type: "number",
        name: "waitlisted_count",
        required: false,
        presentable: false,
        min: null,
        max: null,
        onlyInt: true,
      },
      {
        type: "number",
        name: "cancelled_count",
        required: false,
        presentable: false,
        min: null,
        max: null,
        onlyInt: true,
      },
      {
        type: "number",
        name: "enrolled_male_count",
        required: false,
        presentable: false,
        min: null,
        max: null,
        onlyInt: true,
      },
      {
        type: "number",
        name: "enrolled_female_count",
        required: false,
        presentable: false,
        min: null,
        max: null,
        onlyInt: true,
      },
      {
        type: "number",
        name: "waitlisted_male_count",
        required: false,
        presentable: false,
        min: null,
        max: null,
        onlyInt: true,
      },
      {
        type: "number",
        name: "waitlisted_female_count",
        required: false,
        presentable: false,
        min: null,
        max: null,
        onlyInt: true,
      },
      {
        type: "number",
        name: "cancelled_male_count",
        required: false,
        presentable: false,
        min: null,
        max: null,
        onlyInt: true,
      },
      {
        type: "number",
        name: "cancelled_female_count",
        required: false,
        presentable: false,
        min: null,
        max: null,
        onlyInt: true,
      },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_enrollment_snapshots_unique ON enrollment_snapshots(snapshot_datetime, session_cm_id, year)",
      "CREATE INDEX idx_enrollment_snapshots_year_session ON enrollment_snapshots(year, session_cm_id)",
    ],
  })

  app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("enrollment_snapshots")
  app.delete(collection)
})
