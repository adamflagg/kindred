/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: drop the four dead Grade Ratio / Age-Grade Flow config rows and the
 * now-empty "flow-cohesion" config_sections row.
 *
 * Phase 2 (Grade Ratio domain) collapsed — none ever tuned at runtime (live
 * config DB: all four ``updated == created``):
 *  - ``constraint.grade_ratio.max_percentage`` → ``MAX_SINGLE_GRADE_PERCENTAGE`` (67)
 *  - ``constraint.grade_ratio.penalty``        → ``GRADE_RATIO_PENALTY`` (5000)
 *  - ``constraint.age_grade_flow.weight``      → ``AGE_GRADE_FLOW_WEIGHT`` (300)
 *  - ``constraint.grade_cohesion.weight``      → DELETED (confirmed orphan; no
 *    constraint module, evaluator, validator, or frontend ever read it)
 *
 * into ``bunking/solver/constants.py``. The validator's parallel literal 67 now
 * imports ``MAX_SINGLE_GRADE_PERCENTAGE``.
 *
 * The "flow-cohesion" config_sections row held only the two now-gone keys, so it
 * is dropped too (an empty collapsible header otherwise lingers in the admin GUI).
 *
 * Idempotent: re-running after rows are gone is a no-op (findFirstRecordByFilter
 * throws on no match; we swallow only the lookup, not the delete).
 *
 * Down-migration restores the four config rows with their original seeded values
 * + metadata and re-creates the flow-cohesion section, so a rollback restores the
 * pre-cleanup state and the admin GUI re-recognizes the rows.
 */
migrate(
  (app) => {
    // All four keys are 3-part (category=constraint, non-null subcategory).
    const targets = [
      { subcategory: "grade_ratio", config_key: "max_percentage" },
      { subcategory: "grade_ratio", config_key: "penalty" },
      { subcategory: "age_grade_flow", config_key: "weight" },
      { subcategory: "grade_cohesion", config_key: "weight" },
    ]
    for (const t of targets) {
      let record
      try {
        record = app.findFirstRecordByFilter(
          "config",
          `category = "constraint" && subcategory = "${t.subcategory}" && config_key = "${t.config_key}"`,
        )
      } catch {
        // already gone — ignore (findFirstRecordByFilter throws on no match)
      }
      // Delete runs OUTSIDE the catch so real delete errors (permissions, FK,
      // runtime) surface instead of being silently swallowed.
      if (record) app.delete(record)
    }

    // Drop the now-empty "flow-cohesion" config_sections row.
    let section
    try {
      section = app.findFirstRecordByFilter("config_sections", 'section_key = "flow-cohesion"')
    } catch {
      // already gone — ignore
    }
    if (section) app.delete(section)
  },
  (app) => {
    // Down: re-create the four config rows with original seeded values + metadata
    // from 1500000011_config.js so rollback restores the pre-cleanup state.
    const configCollection = app.findCollectionByNameOrId("config")
    const seeds = [
      {
        subcategory: "grade_ratio",
        config_key: "max_percentage",
        value: 67,
        description: "Maximum percentage of any single grade in a multi-grade cabin",
        metadata: {
          data_type: "integer",
          source: "default_config",
          default_value: 67,
          min_value: 50,
          max_value: 100,
          friendly_name: "Max Single Grade Percentage",
          tooltip: "Maximum percentage of cabin that can be from a single grade",
          section: "age-grade",
          business_category: "solver",
          component_type: "slider",
          component_config: { min: 0, max: 100, step: 1, showValue: true, suffix: "%" },
        },
      },
      {
        subcategory: "grade_ratio",
        config_key: "penalty",
        value: 5000,
        description: "Penalty for grade ratio violations",
        metadata: {
          data_type: "integer",
          source: "default_config",
          default_value: 5000,
          min_value: 0,
          max_value: 50000,
          friendly_name: "Grade Ratio Violation Penalty",
          tooltip: "Penalty weight for exceeding grade ratio limit",
          section: "age-grade",
          business_category: "solver",
          component_type: "slider",
          component_config: { min: 0, max: 10000, step: 100, showValue: true },
        },
      },
      {
        subcategory: "age_grade_flow",
        config_key: "weight",
        value: 300,
        description: "Weight for age-grade flow constraint",
        metadata: {
          data_type: "integer",
          source: "default_config",
          default_value: 300,
          min_value: 0,
          max_value: 10000,
          friendly_name: "Age/Grade Flow Weight",
          tooltip:
            "Bonus weight for placing campers in bunks matching their target grade. Uses distribution-based targeting (not pairwise).",
          section: "flow-cohesion",
          business_category: "solver",
          component_type: "slider",
          component_config: { min: 0, max: 10, step: 0.1, showValue: true, precision: 1 },
        },
      },
      {
        subcategory: "grade_cohesion",
        config_key: "weight",
        value: 5,
        description: "Weight for grade cohesion in cabins",
        metadata: {
          data_type: "integer",
          source: "default_config",
          default_value: 5,
          min_value: 0,
          max_value: 100,
          friendly_name: "Grade Cohesion Weight",
          tooltip: "Keep same grades together in adjacent cabins",
          section: "flow-cohesion",
          business_category: "solver",
          component_type: "slider",
          component_config: { min: 0, max: 10, step: 0.1, showValue: true, precision: 1 },
        },
      },
    ]

    for (const seed of seeds) {
      let existing
      try {
        existing = app.findFirstRecordByFilter(
          "config",
          `category = "constraint" && subcategory = "${seed.subcategory}" && config_key = "${seed.config_key}"`,
        )
      } catch {
        existing = null
      }
      if (existing) continue

      const record = new Record(configCollection)
      record.set("category", "constraint")
      record.set("subcategory", seed.subcategory)
      record.set("config_key", seed.config_key)
      record.set("value", seed.value)
      record.set("description", seed.description)
      record.set("metadata", seed.metadata)
      app.save(record)
    }

    // Re-create the flow-cohesion section (original values from 1500000012).
    let existingSection
    try {
      existingSection = app.findFirstRecordByFilter("config_sections", 'section_key = "flow-cohesion"')
    } catch {
      existingSection = null
    }
    if (!existingSection) {
      const sectionsCollection = app.findCollectionByNameOrId("config_sections")
      const section = new Record(sectionsCollection)
      section.set("section_key", "flow-cohesion")
      section.set("title", "Cabin Flow & Cohesion")
      section.set("description", "Encourage logical cabin arrangements")
      section.set("display_order", 7)
      section.set("expanded_by_default", false)
      app.save(section)
    }
  },
)
