/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create staff_applications table
 * Dependencies: staff, person_custom_values
 *
 * Extracts App-* custom fields for staff application data.
 * Contains 40 fields covering work availability, qualifications,
 * position preferences, essays, references, and reflection prompts.
 *
 * Unique key: (person_id, year) - one record per staff applicant per year
 * Computed by Go: pocketbase/sync/staff_applications.go
 */

migrate((app) => {
  const staffCol = app.findCollectionByNameOrId("staff");

  const collection = new Collection({
    type: "base",
    name: "staff_applications",
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

      // === Work Availability ===
      {
        type: "text",
        name: "can_work_dates",
        required: false,
        presentable: false,
        min: 0,
        max: 500,
        pattern: ""
      },
      {
        type: "text",
        name: "cant_work_explain",
        required: false,
        presentable: false,
        min: 0,
        max: 1000,
        pattern: ""
      },
      {
        type: "text",
        name: "work_dates_supervisor",
        required: false,
        presentable: false,
        min: 0,
        max: 500,
        pattern: ""
      },
      {
        type: "text",
        name: "work_dates_wild",
        required: false,
        presentable: false,
        min: 0,
        max: 500,
        pattern: ""
      },
      {
        type: "text",
        name: "work_dates_driver",
        required: false,
        presentable: false,
        min: 0,
        max: 500,
        pattern: ""
      },

      // === Qualifications ===
      {
        type: "text",
        name: "work_expectations",
        required: false,
        presentable: false,
        min: 0,
        max: 2000,
        pattern: ""
      },
      {
        type: "text",
        name: "qualifications",
        required: false,
        presentable: false,
        min: 0,
        max: 5000,
        pattern: ""
      },
      {
        type: "text",
        name: "qualification_changes",
        required: false,
        presentable: false,
        min: 0,
        max: 2000,
        pattern: ""
      },

      // === Position Preferences ===
      {
        type: "text",
        name: "position_pref_1",
        required: false,
        presentable: false,
        min: 0,
        max: 200,
        pattern: ""
      },
      {
        type: "text",
        name: "position_pref_2",
        required: false,
        presentable: false,
        min: 0,
        max: 200,
        pattern: ""
      },
      {
        type: "text",
        name: "position_pref_3",
        required: false,
        presentable: false,
        min: 0,
        max: 200,
        pattern: ""
      },

      // === Essays ===
      {
        type: "text",
        name: "why_tawonga",
        required: false,
        presentable: false,
        min: 0,
        max: 5000,
        pattern: ""
      },
      {
        type: "text",
        name: "why_work_again",
        required: false,
        presentable: false,
        min: 0,
        max: 5000,
        pattern: ""
      },
      {
        type: "text",
        name: "jewish_community",
        required: false,
        presentable: false,
        min: 0,
        max: 2000,
        pattern: ""
      },
      {
        type: "text",
        name: "three_rules",
        required: false,
        presentable: false,
        min: 0,
        max: 5000,
        pattern: ""
      },
      {
        type: "text",
        name: "autobiography",
        required: false,
        presentable: false,
        min: 0,
        max: 5000,
        pattern: ""
      },
      {
        type: "text",
        name: "community_means",
        required: false,
        presentable: false,
        min: 0,
        max: 5000,
        pattern: ""
      },
      {
        type: "text",
        name: "working_across_differences",
        required: false,
        presentable: false,
        min: 0,
        max: 5000,
        pattern: ""
      },

      // === Personal Info ===
      {
        type: "text",
        name: "languages",
        required: false,
        presentable: false,
        min: 0,
        max: 500,
        pattern: ""
      },
      {
        type: "text",
        name: "dietary_needs",
        required: false,
        presentable: false,
        min: 0,
        max: 200,
        pattern: ""
      },
      {
        type: "text",
        name: "dietary_needs_other",
        required: false,
        presentable: false,
        min: 0,
        max: 500,
        pattern: ""
      },
      {
        type: "bool",
        name: "over_21",
        required: false,
        presentable: false
      },

      // === Reference ===
      {
        type: "text",
        name: "ref_1_name",
        required: false,
        presentable: false,
        min: 0,
        max: 200,
        pattern: ""
      },
      {
        type: "text",
        name: "ref_1_phone",
        required: false,
        presentable: false,
        min: 0,
        max: 50,
        pattern: ""
      },
      {
        type: "text",
        name: "ref_1_email",
        required: false,
        presentable: false,
        min: 0,
        max: 200,
        pattern: ""
      },
      {
        type: "text",
        name: "ref_1_relationship",
        required: false,
        presentable: false,
        min: 0,
        max: 100,
        pattern: ""
      },
      {
        type: "text",
        name: "ref_1_years",
        required: false,
        presentable: false,
        min: 0,
        max: 50,
        pattern: ""
      },

      // === Reflection Prompts ===
      {
        type: "text",
        name: "stress_situation",
        required: false,
        presentable: false,
        min: 0,
        max: 2000,
        pattern: ""
      },
      {
        type: "text",
        name: "stress_response",
        required: false,
        presentable: false,
        min: 0,
        max: 2000,
        pattern: ""
      },
      {
        type: "text",
        name: "spiritual_moment",
        required: false,
        presentable: false,
        min: 0,
        max: 2000,
        pattern: ""
      },
      {
        type: "text",
        name: "activity_program",
        required: false,
        presentable: false,
        min: 0,
        max: 2000,
        pattern: ""
      },
      {
        type: "text",
        name: "someone_admire",
        required: false,
        presentable: false,
        min: 0,
        max: 2000,
        pattern: ""
      },
      {
        type: "text",
        name: "since_camp",
        required: false,
        presentable: false,
        min: 0,
        max: 2000,
        pattern: ""
      },
      {
        type: "text",
        name: "wish_knew",
        required: false,
        presentable: false,
        min: 0,
        max: 2000,
        pattern: ""
      },
      {
        type: "text",
        name: "last_summer_learned",
        required: false,
        presentable: false,
        min: 0,
        max: 2000,
        pattern: ""
      },
      {
        type: "text",
        name: "favorite_camper_moment",
        required: false,
        presentable: false,
        min: 0,
        max: 2000,
        pattern: ""
      },
      {
        type: "text",
        name: "closest_friend",
        required: false,
        presentable: false,
        min: 0,
        max: 2000,
        pattern: ""
      },
      {
        type: "text",
        name: "tawonga_makes_think",
        required: false,
        presentable: false,
        min: 0,
        max: 2000,
        pattern: ""
      },
      {
        type: "text",
        name: "advice_would_give",
        required: false,
        presentable: false,
        min: 0,
        max: 2000,
        pattern: ""
      },
      {
        type: "text",
        name: "how_look_at_camp",
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
      "CREATE UNIQUE INDEX `idx_staff_applications_unique` ON `staff_applications` (`person_id`, `year`)",
      "CREATE INDEX `idx_staff_applications_staff` ON `staff_applications` (`staff`)",
      "CREATE INDEX `idx_staff_applications_year` ON `staff_applications` (`year`)"
    ]
  });

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("staff_applications");
  app.delete(collection);
});
