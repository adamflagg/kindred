/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create camper_transportation table
 * Dependencies: attendees, person_custom_values
 *
 * Extracts BUS-* custom fields for camper transportation info.
 * Includes legacy "Bus to/From Camp" field fallback.
 *
 * Unique key: (person_id, session_id, year) - one record per camper per session
 * Computed by Go: pocketbase/sync/camper_transportation.go
 */

migrate((app) => {
  const attendeesCol = app.findCollectionByNameOrId("attendees");

  const collection = new Collection({
    type: "base",
    name: "camper_transportation",
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      // === Core Identity ===
      {
        type: "relation",
        name: "attendee",
        required: true,
        presentable: false,
        collectionId: attendeesCol.id,
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
        name: "session_id",
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

      // === Transportation Method ===
      {
        type: "text",
        name: "to_camp_method",
        required: false,
        presentable: false,
        min: 0,
        max: 200,
        pattern: ""
      },
      {
        type: "text",
        name: "from_camp_method",
        required: false,
        presentable: false,
        min: 0,
        max: 200,
        pattern: ""
      },

      // === Dropoff Info ===
      {
        type: "text",
        name: "dropoff_name",
        required: false,
        presentable: false,
        min: 0,
        max: 200,
        pattern: ""
      },
      {
        type: "text",
        name: "dropoff_phone",
        required: false,
        presentable: false,
        min: 0,
        max: 50,
        pattern: ""
      },
      {
        type: "text",
        name: "dropoff_relationship",
        required: false,
        presentable: false,
        min: 0,
        max: 100,
        pattern: ""
      },

      // === Pickup Info ===
      {
        type: "text",
        name: "pickup_name",
        required: false,
        presentable: false,
        min: 0,
        max: 200,
        pattern: ""
      },
      {
        type: "text",
        name: "pickup_phone",
        required: false,
        presentable: false,
        min: 0,
        max: 50,
        pattern: ""
      },
      {
        type: "text",
        name: "pickup_relationship",
        required: false,
        presentable: false,
        min: 0,
        max: 100,
        pattern: ""
      },

      // === Alternate Pickup 1 ===
      {
        type: "text",
        name: "alt_pickup_1_name",
        required: false,
        presentable: false,
        min: 0,
        max: 200,
        pattern: ""
      },
      {
        type: "text",
        name: "alt_pickup_1_phone",
        required: false,
        presentable: false,
        min: 0,
        max: 50,
        pattern: ""
      },
      {
        type: "text",
        name: "alt_pickup_1_relationship",
        required: false,
        presentable: false,
        min: 0,
        max: 100,
        pattern: ""
      },

      // === Alternate Pickup 2 ===
      {
        type: "text",
        name: "alt_pickup_2_name",
        required: false,
        presentable: false,
        min: 0,
        max: 200,
        pattern: ""
      },
      {
        type: "text",
        name: "alt_pickup_2_phone",
        required: false,
        presentable: false,
        min: 0,
        max: 50,
        pattern: ""
      },

      // === Metadata ===
      {
        type: "bool",
        name: "used_legacy_fields",
        required: false,
        presentable: false
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
      "CREATE UNIQUE INDEX `idx_camper_transportation_unique` ON `camper_transportation` (`person_id`, `session_id`, `year`)",
      "CREATE INDEX `idx_camper_transportation_attendee` ON `camper_transportation` (`attendee`)",
      "CREATE INDEX `idx_camper_transportation_year` ON `camper_transportation` (`year`)"
    ]
  });

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("camper_transportation");
  app.delete(collection);
});
