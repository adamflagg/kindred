/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Enable cascadeDelete on remaining orphan-blocking relations
 *
 * Extends migration 1500000059 which fixed 5 derived-table relations.
 * This migration fixes the remaining 4 relations where child tables have
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
 * - staff_vehicle_info.staff -> staff
 *
 * Note: original_bunk_requests.requester trimmed — final cascadeDelete: true
 * baked into merged CREATE migration #020.
 * Note: quest_registrations.attendee trimmed — final cascadeDelete: true
 * baked into merged CREATE migration #045.
 * Note: staff_applications.staff trimmed — final cascadeDelete: true
 * baked into merged CREATE migration #046.
 * Note: bunk_plans.bunk + bunk_plans.session trimmed — final cascadeDelete: true
 * baked into merged CREATE migration #017.
 * Note: camper_dietary.attendee trimmed — final cascadeDelete: true
 * baked into merged CREATE migration #044.
 * Note: camper_transportation.attendee trimmed — final cascadeDelete: true
 * baked into merged CREATE migration #043.
 * Note: locked_group_members.attendee trimmed — final cascadeDelete: true
 * baked into merged CREATE migration #025.
 */

migrate((app) => {
  const staffCol = app.findCollectionByNameOrId("staff")

  // 4. staff_vehicle_info.staff -> staff
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
  const staffCol = app.findCollectionByNameOrId("staff")

  // Revert all to cascadeDelete: false

  const staffVehicle = app.findCollectionByNameOrId("staff_vehicle_info")
  staffVehicle.fields.add(new Field({
    type: "relation", name: "staff", required: true, presentable: false,
    collectionId: staffCol.id, cascadeDelete: false, minSelect: null, maxSelect: 1
  }))
  app.save(staffVehicle)
})
