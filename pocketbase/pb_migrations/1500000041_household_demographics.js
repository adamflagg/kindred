/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create household_demographics table
 * Dependencies: households, person_custom_values, household_custom_values
 *
 * Consolidates HH- custom fields from person_custom_values and
 * household_custom_values into a proper household-level table.
 *
 * Fields from person_custom_values (HH- prefix) go to _summer columns:
 * - HH-Name of Congregation -> congregation_summer
 * - HH-Name of JCC -> jcc_summer
 * - HH-special living arrangements -> custody_summer
 *
 * Fields from household_custom_values go to _family columns:
 * - Synagogue -> congregation_family
 * - Center -> jcc_family
 * - Custody Issues -> custody_family
 * - Board -> board_member
 *
 * Computed by Go: pocketbase/sync/household_demographics.go
 */

migrate((app) => {
  // Get households collection for relation
  const householdsCol = app.findCollectionByNameOrId("households");

  const collection = new Collection({
    type: "base",
    name: "household_demographics",
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: null,  // Sync only
    updateRule: null,
    deleteRule: null,
    fields: [
      // === Core Identity ===
      {
        type: "relation",
        name: "household",
        required: true,
        presentable: false,
        collectionId: householdsCol.id,
        cascadeDelete: false,
        minSelect: null,
        maxSelect: 1
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

      // === Family Description (multi-select stored as text) ===
      {
        type: "text",
        name: "family_description",
        required: false,
        presentable: false,
        min: 0,
        max: 2000,
        pattern: ""
      },
      {
        type: "text",
        name: "family_description_other",
        required: false,
        presentable: false,
        min: 0,
        max: 1000,
        pattern: ""
      },

      // === Jewish Identity ===
      {
        type: "text",
        name: "jewish_affiliation",
        required: false,
        presentable: false,
        min: 0,
        max: 500,
        pattern: ""
      },
      {
        type: "text",
        name: "jewish_affiliation_other",
        required: false,
        presentable: false,
        min: 0,
        max: 500,
        pattern: ""
      },
      {
        type: "text",
        name: "jewish_identities",
        required: false,
        presentable: false,
        min: 0,
        max: 2000,
        pattern: ""
      },

      // === Congregation - BOTH sources (summer vs family camp) ===
      {
        type: "text",
        name: "congregation_summer",
        required: false,
        presentable: false,
        min: 0,
        max: 300,
        pattern: ""
      },
      {
        type: "text",
        name: "congregation_family",
        required: false,
        presentable: false,
        min: 0,
        max: 300,
        pattern: ""
      },

      // === JCC - BOTH sources ===
      {
        type: "text",
        name: "jcc_summer",
        required: false,
        presentable: false,
        min: 0,
        max: 300,
        pattern: ""
      },
      {
        type: "text",
        name: "jcc_family",
        required: false,
        presentable: false,
        min: 0,
        max: 300,
        pattern: ""
      },

      // === Demographics ===
      {
        type: "bool",
        name: "military_family",
        required: false,
        presentable: false
      },
      {
        type: "bool",
        name: "parent_immigrant",
        required: false,
        presentable: false
      },
      {
        type: "text",
        name: "parent_immigrant_origin",
        required: false,
        presentable: false,
        min: 0,
        max: 1000,
        pattern: ""
      },

      // === Custody/Living Situation - BOTH sources ===
      {
        type: "text",
        name: "custody_summer",
        required: false,
        presentable: false,
        min: 0,
        max: 5000,
        pattern: ""
      },
      {
        type: "text",
        name: "custody_family",
        required: false,
        presentable: false,
        min: 0,
        max: 5000,
        pattern: ""
      },
      {
        type: "bool",
        name: "has_custody_considerations",
        required: false,
        presentable: false
      },

      // === Away During Camp (Seasonal) ===
      {
        type: "bool",
        name: "away_during_camp",
        required: false,
        presentable: false
      },
      {
        type: "text",
        name: "away_location",
        required: false,
        presentable: false,
        min: 0,
        max: 500,
        pattern: ""
      },
      {
        type: "text",
        name: "away_phone",
        required: false,
        presentable: false,
        min: 0,
        max: 50,
        pattern: ""
      },
      {
        type: "text",
        name: "away_from_date",
        required: false,
        presentable: false,
        min: 0,
        max: 20,
        pattern: ""
      },
      {
        type: "text",
        name: "away_return_date",
        required: false,
        presentable: false,
        min: 0,
        max: 20,
        pattern: ""
      },

      // === Metadata ===
      {
        type: "text",
        name: "form_filler",
        required: false,
        presentable: false,
        min: 0,
        max: 200,
        pattern: ""
      },
      {
        type: "bool",
        name: "board_member",
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
      "CREATE UNIQUE INDEX `idx_household_demographics_hh_year` ON `household_demographics` (`household`, `year`)",
      "CREATE INDEX `idx_household_demographics_year` ON `household_demographics` (`year`)"
    ]
  });

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("household_demographics");
  app.delete(collection);
});
