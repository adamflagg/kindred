/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create camper_dietary table
 * Dependencies: attendees, person_custom_values
 *
 * Extracts Family Medical-* custom fields for dietary/allergy info.
 *
 * Unique key: (person_id, year) - one record per camper per year
 * Computed by Go: pocketbase/sync/camper_dietary.go
 */

migrate((app) => {
  const attendeesCol = app.findCollectionByNameOrId("attendees");

  const collection = new Collection({
    type: "base",
    name: "camper_dietary",
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
        name: "year",
        required: true,
        presentable: false,
        min: 2010,
        max: 2100,
        onlyInt: true
      },

      // === Dietary Needs ===
      {
        type: "bool",
        name: "has_dietary_needs",
        required: false,
        presentable: false
      },
      {
        type: "text",
        name: "dietary_explanation",
        required: false,
        presentable: false,
        min: 0,
        max: 1000,
        pattern: ""
      },

      // === Allergies ===
      {
        type: "bool",
        name: "has_allergies",
        required: false,
        presentable: false
      },
      {
        type: "text",
        name: "allergy_info",
        required: false,
        presentable: false,
        min: 0,
        max: 2000,
        pattern: ""
      },

      // === Additional Medical ===
      {
        type: "text",
        name: "additional_medical",
        required: false,
        presentable: false,
        min: 0,
        max: 2000,
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
      "CREATE UNIQUE INDEX `idx_camper_dietary_unique` ON `camper_dietary` (`person_id`, `year`)",
      "CREATE INDEX `idx_camper_dietary_attendee` ON `camper_dietary` (`attendee`)",
      "CREATE INDEX `idx_camper_dietary_year` ON `camper_dietary` (`year`)",
      "CREATE INDEX `idx_camper_dietary_has_allergies` ON `camper_dietary` (`year`, `has_allergies`)"
    ]
  });

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("camper_dietary");
  app.delete(collection);
});
