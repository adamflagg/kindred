/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Enable cascadeDelete on remaining orphan-blocking relations
 *
 * Extends migration 1500000059 which fixed 5 derived-table relations.
 * This migration fixes the remaining 6 relations where child tables have
 * required references with cascadeDelete=false to parent tables that perform
 * orphan deletion during sync.
 *
 * Without cascadeDelete, deleting an orphaned parent record fails because
 * PocketBase blocks the delete when a child has a required reference to it.
 *
 * Cross-year safety: All parent tables are year-scoped (separate PB records
 * per year). Cascade operates on PB IDs, not CampMinder IDs.
 *
 * Affected relations:
 * - bunk_plans.bunk -> bunks
 * - bunk_plans.session -> camp_sessions
 * - camper_dietary.attendee -> attendees
 * - camper_transportation.attendee -> attendees
 * - locked_group_members.attendee -> attendees
 * - staff_vehicle_info.staff -> staff
 *
 * Note: original_bunk_requests.requester trimmed — final cascadeDelete: true
 * baked into merged CREATE migration #020.
 * Note: quest_registrations.attendee trimmed — final cascadeDelete: true
 * baked into merged CREATE migration #045.
 * Note: staff_applications.staff trimmed — final cascadeDelete: true
 * baked into merged CREATE migration #046.
 */

migrate((app) => {
  const bunksCol = app.findCollectionByNameOrId("bunks")
  const sessionsCol = app.findCollectionByNameOrId("camp_sessions")
  const attendeesCol = app.findCollectionByNameOrId("attendees")
  const staffCol = app.findCollectionByNameOrId("staff")

  // 1. bunk_plans.bunk -> bunks
  const bunkPlans = app.findCollectionByNameOrId("bunk_plans")
  bunkPlans.fields.add(new Field({
    type: "relation",
    name: "bunk",
    required: true,
    presentable: true,
    collectionId: bunksCol.id,
    cascadeDelete: true,
    minSelect: null,
    maxSelect: 1
  }))
  // 2. bunk_plans.session -> camp_sessions
  bunkPlans.fields.add(new Field({
    type: "relation",
    name: "session",
    required: true,
    presentable: true,
    collectionId: sessionsCol.id,
    cascadeDelete: true,
    minSelect: null,
    maxSelect: 1
  }))
  app.save(bunkPlans)

  // 3. camper_dietary.attendee -> attendees
  const camperDietary = app.findCollectionByNameOrId("camper_dietary")
  camperDietary.fields.add(new Field({
    type: "relation",
    name: "attendee",
    required: true,
    presentable: false,
    collectionId: attendeesCol.id,
    cascadeDelete: true,
    minSelect: null,
    maxSelect: 1
  }))
  app.save(camperDietary)

  // 4. camper_transportation.attendee -> attendees
  const camperTransport = app.findCollectionByNameOrId("camper_transportation")
  camperTransport.fields.add(new Field({
    type: "relation",
    name: "attendee",
    required: true,
    presentable: false,
    collectionId: attendeesCol.id,
    cascadeDelete: true,
    minSelect: null,
    maxSelect: 1
  }))
  app.save(camperTransport)

  // 5. locked_group_members.attendee -> attendees
  const lockedGroupMembers = app.findCollectionByNameOrId("locked_group_members")
  lockedGroupMembers.fields.add(new Field({
    type: "relation",
    name: "attendee",
    required: true,
    presentable: true,
    collectionId: attendeesCol.id,
    cascadeDelete: true,
    minSelect: null,
    maxSelect: 1
  }))
  app.save(lockedGroupMembers)

  // 6. staff_vehicle_info.staff -> staff
  const staffVehicle = app.findCollectionByNameOrId("staff_vehicle_info")
  staffVehicle.fields.add(new Field({
    type: "relation",
    name: "staff",
    required: true,
    presentable: false,
    collectionId: staffCol.id,
    cascadeDelete: true,
    minSelect: null,
    maxSelect: 1
  }))
  app.save(staffVehicle)

}, (app) => {
  const bunksCol = app.findCollectionByNameOrId("bunks")
  const sessionsCol = app.findCollectionByNameOrId("camp_sessions")
  const attendeesCol = app.findCollectionByNameOrId("attendees")
  const staffCol = app.findCollectionByNameOrId("staff")

  // Revert all to cascadeDelete: false

  const bunkPlans = app.findCollectionByNameOrId("bunk_plans")
  bunkPlans.fields.add(new Field({
    type: "relation", name: "bunk", required: true, presentable: true,
    collectionId: bunksCol.id, cascadeDelete: false, minSelect: null, maxSelect: 1
  }))
  bunkPlans.fields.add(new Field({
    type: "relation", name: "session", required: true, presentable: true,
    collectionId: sessionsCol.id, cascadeDelete: false, minSelect: null, maxSelect: 1
  }))
  app.save(bunkPlans)

  const camperDietary = app.findCollectionByNameOrId("camper_dietary")
  camperDietary.fields.add(new Field({
    type: "relation", name: "attendee", required: true, presentable: false,
    collectionId: attendeesCol.id, cascadeDelete: false, minSelect: null, maxSelect: 1
  }))
  app.save(camperDietary)

  const camperTransport = app.findCollectionByNameOrId("camper_transportation")
  camperTransport.fields.add(new Field({
    type: "relation", name: "attendee", required: true, presentable: false,
    collectionId: attendeesCol.id, cascadeDelete: false, minSelect: null, maxSelect: 1
  }))
  app.save(camperTransport)

  const lockedGroupMembers = app.findCollectionByNameOrId("locked_group_members")
  lockedGroupMembers.fields.add(new Field({
    type: "relation", name: "attendee", required: true, presentable: true,
    collectionId: attendeesCol.id, cascadeDelete: false, minSelect: null, maxSelect: 1
  }))
  app.save(lockedGroupMembers)

  const staffVehicle = app.findCollectionByNameOrId("staff_vehicle_info")
  staffVehicle.fields.add(new Field({
    type: "relation", name: "staff", required: true, presentable: false,
    collectionId: staffCol.id, cascadeDelete: false, minSelect: null, maxSelect: 1
  }))
  app.save(staffVehicle)
})
