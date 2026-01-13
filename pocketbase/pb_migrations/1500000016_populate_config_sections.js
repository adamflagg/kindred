/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("config_sections");
  
  const sections = [
    {
      section_key: "core-constraints",
      title: "Core Request Policies",
      description: "Essential rules for satisfying camper requests",
      display_order: 2,
      expanded_by_default: false
    },
    {
      section_key: "cabin-capacity",
      title: "Cabin Capacity Rules",
      description: "Configure cabin size limits and overflow handling",
      display_order: 3,
      expanded_by_default: false
    },
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
      section_key: "ai-processing",
      title: "AI Processing",
      description: "Configure AI-powered request parsing and analysis",
      display_order: 11,
      expanded_by_default: false
    },
    {
      section_key: "batch-processing",
      title: "Batch Processing Weights",
      description: "Fine-tune constraint weights for batch solving",
      display_order: 12,
      expanded_by_default: false
    },
    {
      section_key: "penalties",
      title: "Violation Penalties",
      description: "Configure penalties for various constraint violations",
      display_order: 13,
      expanded_by_default: false
    },
    {
      section_key: "spread-controls",
      title: "Spread Controls",
      description: "Advanced spread penalty configuration",
      display_order: 14,
      expanded_by_default: false
    },
    {
      section_key: "system-settings",
      title: "System Settings",
      description: "Configure system-wide settings",
      display_order: 15,
      expanded_by_default: false
    },
    // AI-specific sections - clearly separated from solver sections
    {
      section_key: "ai-model-settings",
      title: "AI Model Configuration",
      description: "Configure AI provider, model selection, and processing parameters",
      display_order: 20,
      expanded_by_default: false
    },
    {
      section_key: "ai-confidence-thresholds",
      title: "AI Confidence Thresholds",
      description: "Set confidence levels for automatic acceptance, validation, and rejection",
      display_order: 21,
      expanded_by_default: false
    },
    {
      section_key: "ai-name-matching",
      title: "AI Name Matching",
      description: "Configure fuzzy matching, phonetic matching, and name resolution rules",
      display_order: 22,
      expanded_by_default: false
    },
    {
      section_key: "ai-confidence-scoring",
      title: "AI Confidence Scoring",
      description: "Weights and parameters for calculating request confidence scores",
      display_order: 23,
      expanded_by_default: false
    },
    {
      section_key: "ai-validation-rules",
      title: "AI Validation Rules",
      description: "Spread validation, manual review triggers, and field parsing rules",
      display_order: 25,
      expanded_by_default: false
    },
    {
      section_key: "ai-batch-processing",
      title: "AI Batch Processing",
      description: "Batch size, rate limiting, and concurrent processing settings",
      display_order: 26,
      expanded_by_default: false
    }
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

  return null;
}, (app) => {
  // Rollback: Delete all sections
  const collection = app.findCollectionByNameOrId("config_sections");
  if (collection) {
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
  }
  
  return null;
});