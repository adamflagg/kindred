/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create family camp derived tables
 * Dependencies: households, person_custom_values, household_custom_values
 *
 * Creates 3 derived tables from custom values for family camp data:
 * - family_camp_adults: Adult attendees with details (deduped across children)
 * - family_camp_registrations: Registration details per household/year
 * - family_camp_medical: Medical/dietary info blobs per household/year
 *
 * Computed by Go: pocketbase/sync/family_camp_derived.go
 */

migrate((app) => {
  // Get households collection for relation
  const householdsCol = app.findCollectionByNameOrId("households");

  // ============================================================================
  // Table 1: family_camp_adults
  // ============================================================================
  const adultsCollection = new Collection({
    type: "base",
    name: "family_camp_adults",
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.id != ""',
    fields: [
      // Household relation
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
      // Year scope
      {
        type: "number",
        name: "year",
        required: true,
        presentable: false,
        min: 2010,
        max: 2100,
        onlyInt: true
      },
      // Adult number (1-5)
      {
        type: "number",
        name: "adult_number",
        required: true,
        presentable: true,
        min: 1,
        max: 5,
        onlyInt: true
      },
      // Adult details - all v0.23+ direct properties
      {
        type: "text",
        name: "name",
        required: false,
        presentable: true,
        min: 0,
        max: 500,
        pattern: ""
      },
      {
        type: "text",
        name: "first_name",
        required: false,
        presentable: false,
        min: 0,
        max: 200,
        pattern: ""
      },
      {
        type: "text",
        name: "last_name",
        required: false,
        presentable: false,
        min: 0,
        max: 200,
        pattern: ""
      },
      {
        type: "text",
        name: "email",
        required: false,
        presentable: false,
        min: 0,
        max: 500,
        pattern: ""
      },
      {
        type: "text",
        name: "pronouns",
        required: false,
        presentable: false,
        min: 0,
        max: 100,
        pattern: ""
      },
      {
        type: "text",
        name: "gender",
        required: false,
        presentable: false,
        min: 0,
        max: 100,
        pattern: ""
      },
      {
        type: "text",
        name: "date_of_birth",
        required: false,
        presentable: false,
        min: 0,
        max: 50,
        pattern: ""
      },
      {
        type: "text",
        name: "relationship_to_camper",
        required: false,
        presentable: false,
        min: 0,
        max: 200,
        pattern: ""
      },
      // Auto timestamps
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
      "CREATE UNIQUE INDEX `idx_fc_adults_unique` ON `family_camp_adults` (`household`, `year`, `adult_number`)",
      "CREATE INDEX `idx_fc_adults_year` ON `family_camp_adults` (`year`)"
    ]
  });

  app.save(adultsCollection);

  // ============================================================================
  // Table 2: family_camp_registrations
  // ============================================================================
  const registrationsCollection = new Collection({
    type: "base",
    name: "family_camp_registrations",
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.id != ""',
    fields: [
      // Household relation
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
      // Year scope
      {
        type: "number",
        name: "year",
        required: true,
        presentable: false,
        min: 2010,
        max: 2100,
        onlyInt: true
      },
      // Registration details
      {
        type: "text",
        name: "cabin_assignment",
        required: false,
        presentable: true,
        min: 0,
        max: 200,
        pattern: ""
      },
      {
        type: "text",
        name: "share_cabin_preference",
        required: false,
        presentable: false,
        min: 0,
        max: 500,
        pattern: ""
      },
      {
        type: "text",
        name: "shared_cabin_with",
        required: false,
        presentable: false,
        min: 0,
        max: 500,
        pattern: ""
      },
      {
        type: "text",
        name: "arrival_eta",
        required: false,
        presentable: false,
        min: 0,
        max: 200,
        pattern: ""
      },
      {
        type: "text",
        name: "special_occasions",
        required: false,
        presentable: false,
        min: 0,
        max: 1000,
        pattern: ""
      },
      {
        type: "text",
        name: "goals",
        required: false,
        presentable: false,
        min: 0,
        max: 2000,
        pattern: ""
      },
      {
        type: "text",
        name: "notes",
        required: false,
        presentable: false,
        min: 0,
        max: 5000,
        pattern: ""
      },
      {
        type: "bool",
        name: "needs_accommodation",
        required: false,
        presentable: false
      },
      {
        type: "bool",
        name: "opt_out_vip",
        required: false,
        presentable: false
      },
      // Auto timestamps
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
      "CREATE UNIQUE INDEX `idx_fc_reg_unique` ON `family_camp_registrations` (`household`, `year`)",
      "CREATE INDEX `idx_fc_reg_cabin` ON `family_camp_registrations` (`cabin_assignment`)"
    ]
  });

  app.save(registrationsCollection);

  // ============================================================================
  // Table 3: family_camp_medical
  // ============================================================================
  const medicalCollection = new Collection({
    type: "base",
    name: "family_camp_medical",
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.id != ""',
    fields: [
      // Household relation
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
      // Year scope
      {
        type: "number",
        name: "year",
        required: true,
        presentable: false,
        min: 2010,
        max: 2100,
        onlyInt: true
      },
      // Medical/dietary blob fields
      {
        type: "text",
        name: "cpap_info",
        required: false,
        presentable: false,
        min: 0,
        max: 5000,
        pattern: ""
      },
      {
        type: "text",
        name: "physician_info",
        required: false,
        presentable: false,
        min: 0,
        max: 5000,
        pattern: ""
      },
      {
        type: "text",
        name: "special_needs_info",
        required: false,
        presentable: false,
        min: 0,
        max: 10000,
        pattern: ""
      },
      {
        type: "text",
        name: "allergy_info",
        required: false,
        presentable: false,
        min: 0,
        max: 10000,
        pattern: ""
      },
      {
        type: "text",
        name: "dietary_info",
        required: false,
        presentable: false,
        min: 0,
        max: 10000,
        pattern: ""
      },
      {
        type: "text",
        name: "additional_info",
        required: false,
        presentable: false,
        min: 0,
        max: 10000,
        pattern: ""
      },
      // Auto timestamps
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
      "CREATE UNIQUE INDEX `idx_fc_med_unique` ON `family_camp_medical` (`household`, `year`)"
    ]
  });

  app.save(medicalCollection);
}, (app) => {
  // Delete in reverse order
  const medicalCol = app.findCollectionByNameOrId("family_camp_medical");
  app.delete(medicalCol);

  const registrationsCol = app.findCollectionByNameOrId("family_camp_registrations");
  app.delete(registrationsCol);

  const adultsCol = app.findCollectionByNameOrId("family_camp_adults");
  app.delete(adultsCol);
});
