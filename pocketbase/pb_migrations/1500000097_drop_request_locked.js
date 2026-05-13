/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Drop request_locked field from bunk_requests
 *
 * Per issue #1373, the lock provided no real protection beyond what the
 * unique constraint and source_field distinction already give us, while
 * creating UI traps when sync paths transitioned rows out of staff-blessed
 * state without clearing the lock.
 *
 * Existing rows with request_locked=true (~35 in prod at migration time)
 * lose the bit; staff edits and approvals continue to persist via status,
 * disposition_reason, and requestee_id.
 */
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId("bunk_requests")
    collection.fields.removeByName("request_locked")
    app.save(collection)
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("bunk_requests")
    collection.fields.add(
      new Field({
        name: "request_locked",
        type: "bool",
        required: false,
        unique: false,
      })
    )
    app.save(collection)
  }
)
