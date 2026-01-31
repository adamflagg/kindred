/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create staff_vehicle_info table
 * Dependencies: staff, person_custom_values
 *
 * Extracts SVI-* custom fields for staff vehicle information.
 * Contains 8 fields covering driving plans and vehicle details.
 *
 * Unique key: (person_id, year) - one record per staff member per year
 * Computed by Go: pocketbase/sync/staff_vehicle_info.go
 */

migrate((app) => {
  const staffCol = app.findCollectionByNameOrId("staff");

  const collection = new Collection({
    type: "base",
    name: "staff_vehicle_info",
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      // === Core Identity ===
      {
        type: "relation",
        name: "staff",
        required: true,
        presentable: false,
        collectionId: staffCol.id,
        cascadeDelete: false,
        minSelect: null,
        maxSelect: 1
      },
      {
        type: "number",
        name: "person_id",
        required: true,
        presentable: false,
        min: 1,
        max: 999999999,
        onlyInt: true
      },
      {
        type: "number",
        name: "year",
        required: true,
        presentable: false,
        min: 2010,
        max: 2100,
        onlyInt: true
      },

      // === Driving to Camp ===
      {
        type: "bool",
        name: "driving_to_camp",
        required: false,
        presentable: false
      },
      {
        type: "text",
        name: "how_getting_to_camp",
        required: false,
        presentable: false,
        min: 0,
        max: 500,
        pattern: ""
      },

      // === Bringing Others ===
      {
        type: "bool",
        name: "can_bring_others",
        required: false,
        presentable: false
      },
      {
        type: "text",
        name: "driver_name",
        required: false,
        presentable: false,
        min: 0,
        max: 200,
        pattern: ""
      },
      {
        type: "text",
        name: "which_friend",
        required: false,
        presentable: false,
        min: 0,
        max: 200,
        pattern: ""
      },

      // === Vehicle Info ===
      {
        type: "text",
        name: "vehicle_make",
        required: false,
        presentable: false,
        min: 0,
        max: 100,
        pattern: ""
      },
      {
        type: "text",
        name: "vehicle_model",
        required: false,
        presentable: false,
        min: 0,
        max: 100,
        pattern: ""
      },
      {
        type: "text",
        name: "license_plate",
        required: false,
        presentable: false,
        min: 0,
        max: 20,
        pattern: ""
      },

      // === Timestamps ===
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
      "CREATE UNIQUE INDEX `idx_staff_vehicle_info_unique` ON `staff_vehicle_info` (`person_id`, `year`)",
      "CREATE INDEX `idx_staff_vehicle_info_staff` ON `staff_vehicle_info` (`staff`)",
      "CREATE INDEX `idx_staff_vehicle_info_year` ON `staff_vehicle_info` (`year`)"
    ]
  });

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("staff_vehicle_info");
  app.delete(collection);
});
