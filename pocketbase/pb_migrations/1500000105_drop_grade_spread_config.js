/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: drop the three dead grade_spread config rows.
 *
 * Phase 2 (Grade Spread) collapsed:
 *  - ``spread.max_grade`` (sync-side filter; never reached the solver because
 *    the solver read a phantom ``constraint.grade_spread.max_spread`` key
 *    instead — see decisions doc)
 *  - ``constraint.grade_spread.mode`` (seeded "soft" but production ran "hard"
 *    via admin GUI override; never flipped back)
 *  - ``constraint.grade_spread.penalty`` (only consumed by the soft path, which
 *    is deleted; never fired in observed solver logs)
 *
 * into ``MAX_UNIQUE_GRADES_PER_BUNK = 2`` in ``bunking/solver/constants.py``.
 *
 * Idempotent: re-running after rows are gone is a no-op.
 *
 * Down-migration restores the rows with the original seeded values from
 * ``1500000011_config.js`` so a rollback restores the pre-cleanup state.
 * Metadata fields mirror the seed migration's metadata-builder so the admin
 * GUI re-recognizes the rows after rollback.
 */
// Build a filter that matches both NULL and "" subcategory for 2-part keys.
// The seed migration (1500000011_config.js) stores 2-part keys with
// subcategory = NULL (transformKey returns subcategory: null for 2-part keys);
// in SQLite, ``subcategory = ""`` does NOT match NULL. Mirror the seed
// migration's pattern so this drop is symmetric with the create.
const subcategoryFilter = (subcategory) =>
  subcategory === null || subcategory === ""
    ? "subcategory = null"
    : `subcategory = "${subcategory}"`

migrate(
  (app) => {
    const targets = [
      { category: "spread", subcategory: null, config_key: "max_grade" },
      { category: "constraint", subcategory: "grade_spread", config_key: "mode" },
      { category: "constraint", subcategory: "grade_spread", config_key: "penalty" },
    ]
    for (const t of targets) {
      let record
      try {
        record = app.findFirstRecordByFilter(
          "config",
          `category = "${t.category}" && ${subcategoryFilter(t.subcategory)} && config_key = "${t.config_key}"`,
        )
      } catch {
        // already gone — ignore (findFirstRecordByFilter throws on no match)
      }
      // Delete runs OUTSIDE the catch so real delete errors (permissions,
      // FK, runtime) surface instead of being silently swallowed.
      if (record) app.delete(record)
    }
  },
  (app) => {
    // Down: re-create the three rows with original seeded values from
    // 1500000011_config.js so rollback restores the pre-cleanup state.
    const configCollection = app.findCollectionByNameOrId("config")
    const seeds = [
      {
        category: "spread",
        subcategory: null,
        config_key: "max_grade",
        value: 2,
        description: "Maximum grade spread allowed in bunks and bunk requests",
        metadata: {
          data_type: "integer",
          source: "default_config",
          default_value: 2,
          min_value: 1,
          max_value: 5,
          friendly_name: "Max Grade Spread",
          tooltip:
            "Maximum grade difference allowed in bunks and bunk requests (e.g., 2 means 6th and 7th grade only)",
          section: "age-grade",
          business_category: "solver",
          component_type: "number",
          component_config: { min: 0, max: 5, step: 1, suffix: " grades" },
        },
      },
      {
        category: "constraint",
        subcategory: "grade_spread",
        config_key: "mode",
        value: "soft",
        description: "Grade spread constraint mode (hard/soft)",
        metadata: {
          data_type: "string",
          source: "default_config",
          default_value: "soft",
          friendly_name: "Grade Spread Mode",
          tooltip: "Hard constraint prevents exceeding, soft adds penalty",
          section: "age-grade",
          business_category: "solver",
          component_type: "select",
          component_config: { options: ["hard", "soft"] },
        },
      },
      {
        category: "constraint",
        subcategory: "grade_spread",
        config_key: "penalty",
        value: 3000,
        description: "Penalty for grade spread violations",
        metadata: {
          data_type: "integer",
          source: "default_config",
          default_value: 3000,
          min_value: 0,
          max_value: 10000,
          friendly_name: "Grade Spread Violation Penalty",
          tooltip: "Penalty weight for exceeding grade spread limit",
          section: "age-grade",
          business_category: "solver",
          component_type: "slider",
          component_config: {},
        },
      },
    ]

    for (const seed of seeds) {
      let existing
      try {
        existing = app.findFirstRecordByFilter(
          "config",
          `category = "${seed.category}" && ${subcategoryFilter(seed.subcategory)} && config_key = "${seed.config_key}"`,
        )
      } catch {
        existing = null
      }
      if (existing) continue

      const record = new Record(configCollection)
      record.set("category", seed.category)
      record.set("subcategory", seed.subcategory)
      record.set("config_key", seed.config_key)
      record.set("value", seed.value)
      record.set("description", seed.description)
      record.set("metadata", seed.metadata)
      app.save(record)
    }
  },
)
