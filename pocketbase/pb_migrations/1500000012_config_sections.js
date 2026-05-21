/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create config_sections collection
 * Dependencies: None
 *
 * Creates the config_sections collection for organizing configuration UI sections
 * and populates it with default section definitions.
 */

migrate((app) => {
  // Create config_sections collection
  const collection = new Collection({
    id: "col_config_sections",
    name: "config_sections",
    type: "base",
    fields: [
      {
        name: "section_key",
        type: "text",
        required: true,
        presentable: true,
        options: {
          min: null,
          max: 100,
          pattern: ""
        }
      },
      {
        name: "title",
        type: "text",
        required: true,
        presentable: false,
        options: {
          min: null,
          max: 255,
          pattern: ""
        }
      },
      {
        name: "description",
        type: "text",
        required: false,
        presentable: false,
        options: {
          min: null,
          max: 1000,
          pattern: ""
        }
      },
      {
        name: "display_order",
        type: "number",
        required: true,
        presentable: false,
        min: 0,
        max: null,
        onlyInt: true
      },
      {
        name: "expanded_by_default",
        type: "bool",
        required: false,
        presentable: false
      },
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
      "CREATE UNIQUE INDEX idx_config_sections_key ON config_sections (section_key)",
      "CREATE INDEX idx_config_sections_order ON config_sections (display_order)"
    ],
    listRule: '@request.auth.is_admin = true',
    viewRule: '@request.auth.is_admin = true',
    createRule: '@request.auth.is_admin = true',
    updateRule: '@request.auth.is_admin = true',
    deleteRule: '@request.auth.is_admin = true',
    options: {}
  });

  app.save(collection);

  // ============================================================
  // Populate config_sections with default section definitions
  // ============================================================

  const sections = [
    {
      section_key: "core-constraints",
      title: "Core Request Policies",
      description: "Essential rules for satisfying camper requests",
      display_order: 2,
      expanded_by_default: false
    },
    // section_key: "cabin-capacity" removed in Phase 2 cleanup (constants in
    // bunking/solver/constants.py instead).
    {
      section_key: "age-grade",
      title: "Age & Grade Policies",
      description: "Set limits for age and grade mixing in cabins",
      display_order: 4,
      expanded_by_default: false
    },
    {
      section_key: "level-progression",
      title: "Level Progression",
      description: "Rules for returning campers and bunk level assignments",
      display_order: 6,
      expanded_by_default: false
    },
    {
      section_key: "flow-cohesion",
      title: "Cabin Flow & Cohesion",
      description: "Encourage logical cabin arrangements",
      display_order: 7,
      expanded_by_default: false
    },
    {
      section_key: "request-weighting",
      title: "Request Source Importance",
      description: "Adjust the relative importance of different request sources",
      display_order: 8,
      expanded_by_default: false
    },
    {
      section_key: "solver-execution",
      title: "Solver Execution",
      description: "Configure how the solver runs and applies results",
      display_order: 9,
      expanded_by_default: false
    },
    {
      section_key: "smart-resolution",
      title: "Smart Name Resolution (NetworkX)",
      description: "AI-powered social graph analysis for resolving ambiguous requests",
      display_order: 10,
      expanded_by_default: false
    },
    {
      section_key: "cabin-occupancy",
      title: "Cabin Minimum Occupancy",
      description: "Soft penalty weight for under-filled bunks (hard floor 8 and preferred target 10 are hardcoded)",
      display_order: 13,
      expanded_by_default: false
    },
    // 7 AI-specific sections removed in the AI Config (Unified) Phase 2
    // cleanup along with the underlying `category='ai'` config rows. See drop
    // migration `1500000109_drop_ai_configs.js`.
  ];

  // Insert each section
  sections.forEach(sectionData => {
    // Check if section already exists
    let existing = null;
    try {
      existing = app.findFirstRecordByFilter(
        "config_sections",
        `section_key = "${sectionData.section_key}"`
      );
    } catch (_e) {
      // Record doesn't exist, which is expected
    }

    if (!existing) {
      const record = new Record(collection);
      record.set("section_key", sectionData.section_key);
      record.set("title", sectionData.title);
      record.set("description", sectionData.description);
      record.set("display_order", sectionData.display_order);
      record.set("expanded_by_default", sectionData.expanded_by_default);

      app.save(record);
    }
  });

}, (app) => {
  // Rollback: Delete all section records first, then delete collection
  try {
    const sections = app.findRecordsByFilter(
      "config_sections",
      "",
      "",
      0,
      0
    );

    sections.forEach((section) => {
      app.delete(section);
    });
  } catch (_e) {
    console.log("Error deleting section records during rollback:", _e);
  }

  // Delete the collection
  const collection = app.findCollectionByNameOrId("config_sections");
  app.delete(collection);
});
