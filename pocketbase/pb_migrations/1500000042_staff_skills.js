/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create staff_skills collection
 * Dependencies: persons, custom_field_defs
 *
 * Derived table that extracts Skills- fields from person_custom_values
 * into a normalized, queryable structure. One row per staff-skill-year.
 * Enables queries like "who can teach archery?" for activity assignment.
 *
 * Computed by Go: pocketbase/sync/staff_skills.go
 * Exported to Google Sheets: {year}-staff-skills
 *
 * Proficiency levels parsed from pipe-delimited multi-select:
 *   Int. = Intermediate
 *   Exp. = Experienced
 *   Teach = Can teach this skill
 *   Cert. = Certified
 *
 * Notes fields (Skills-would like to acquire, Skills-Skill Notes) have
 * all booleans set to false and raw_value contains the text.
 */

const COLLECTION_ID_STAFF_SKILLS = "col_staff_skills";

migrate((app) => {
  const personsCol = app.findCollectionByNameOrId("persons");

  const collection = new Collection({
    id: COLLECTION_ID_STAFF_SKILLS,
    type: "base",
    name: "staff_skills",
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.id != ""',
    fields: [
      // Person identification (CampMinder ID for sync lookup)
      {
        type: "number",
        name: "person_id",
        required: true,
        presentable: false,
        min: 1,
        max: null,
        onlyInt: true
      },
      // PocketBase relation for joins/UI
      {
        type: "relation",
        name: "person",
        required: false,
        presentable: false,
        collectionId: personsCol.id,
        cascadeDelete: false,
        minSelect: null,
        maxSelect: 1
      },

      // Skill identification
      {
        type: "number",
        name: "skill_cm_id",
        required: true,
        presentable: false,
        min: 1,
        max: null,
        onlyInt: true
      },
      {
        type: "text",
        name: "skill_name",
        required: true,
        presentable: true,
        min: 1,
        max: 200,
        pattern: ""
      },

      // Proficiency levels (parsed from pipe-delimited multi-select)
      {
        type: "bool",
        name: "is_intermediate",
        required: false,
        presentable: false
      },
      {
        type: "bool",
        name: "is_experienced",
        required: false,
        presentable: false
      },
      {
        type: "bool",
        name: "can_teach",
        required: false,
        presentable: false
      },
      {
        type: "bool",
        name: "is_certified",
        required: false,
        presentable: false
      },
      // Original value (notes fields can be long)
      {
        type: "text",
        name: "raw_value",
        required: false,
        presentable: false,
        min: 0,
        max: 5000,
        pattern: ""
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

      // Denormalized staff info (for exports/queries without joins)
      {
        type: "text",
        name: "first_name",
        required: false,
        presentable: true,
        min: 0,
        max: 100,
        pattern: ""
      },
      {
        type: "text",
        name: "last_name",
        required: false,
        presentable: true,
        min: 0,
        max: 100,
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
      // Unique: one skill per person per year
      "CREATE UNIQUE INDEX `idx_staff_skills_unique` ON `staff_skills` (`person_id`, `skill_cm_id`, `year`)",

      // Query by skill (for assignment planning)
      "CREATE INDEX `idx_staff_skills_skill` ON `staff_skills` (`skill_name`, `year`)",

      // Query by person
      "CREATE INDEX `idx_staff_skills_person` ON `staff_skills` (`person_id`, `year`)",

      // Query by teachable skills (common query for activity assignments)
      "CREATE INDEX `idx_staff_skills_can_teach` ON `staff_skills` (`can_teach`, `skill_name`, `year`)",

      // PB relation index
      "CREATE INDEX `idx_staff_skills_person_rel` ON `staff_skills` (`person`)"
    ]
  });

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("staff_skills");
  app.delete(collection);
});
