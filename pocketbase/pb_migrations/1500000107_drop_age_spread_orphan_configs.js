/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: drop the three dead age_spread config rows.
 *
 * Phase 2 (Age Spread) collapsed:
 *  - ``spread.max_age_months`` (sync-side filter; never reached the solver
 *    because the solver read a phantom ``constraint.age_spread.months`` key
 *    instead — see decisions doc)
 *  - ``constraint.age_spread.penalty`` (only consumed by the soft path, which
 *    is now deleted; in practice the soft path fired on ~6% of bunks and
 *    became infeasibility once collapsed to hard)
 *  - ``constraint.age_spread.preferred_months`` (paired with preferred_bonus
 *    to give tight cabins an objective boost; the threshold is now the
 *    hardcoded ``PREFERRED_AGE_SPREAD_MONTHS = 18`` constant, bumped from
 *    the prior seed of 12 per staff intent)
 *
 * into ``MAX_AGE_SPREAD_MONTHS = 24`` and ``PREFERRED_AGE_SPREAD_MONTHS = 18``
 * in ``bunking/solver/constants.py``.
 * ``constraint.age_spread.preferred_bonus`` is KEPT as the lone runtime knob
 * in this domain.
 *
 * Idempotent: re-running after rows are gone is a no-op.
 *
 * Down-migration restores the rows with the pre-cleanup seeded values so a
 * rollback returns the config table to its prior state. Metadata fields
 * mirror the seed migration's metadata-builder so the admin GUI re-recognizes
 * the rows after rollback.
 */
// Build a filter that matches both NULL and "" subcategory for 2-part keys.
const subcategoryFilter = (subcategory) =>
  subcategory === null || subcategory === ""
    ? "subcategory = null"
    : `subcategory = "${subcategory}"`

migrate(
  (app) => {
    const targets = [
      { category: "spread", subcategory: null, config_key: "max_age_months" },
      { category: "constraint", subcategory: "age_spread", config_key: "penalty" },
      { category: "constraint", subcategory: "age_spread", config_key: "preferred_months" },
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
      // Delete runs OUTSIDE the catch so real delete errors (permissions, FK,
      // runtime) surface instead of being silently swallowed.
      if (record) app.delete(record)
    }
  },
  (app) => {
    // Down: re-create the three rows with original seeded values so rollback
    // restores the pre-cleanup state.
    const configCollection = app.findCollectionByNameOrId("config")
    const seeds = [
      {
        category: "spread",
        subcategory: null,
        config_key: "max_age_months",
        value: 24,
        description: "Maximum age difference in months allowed in bunks and bunk requests",
        metadata: {
          data_type: "integer",
          source: "default_config",
          default_value: 24,
          min_value: 12,
          max_value: 48,
          friendly_name: "Max Age Difference (months)",
          tooltip: "Maximum age difference in months allowed in bunks and bunk requests",
          section: "age-grade",
          business_category: "solver",
          component_type: "slider",
          component_config: {},
        },
      },
      {
        category: "constraint",
        subcategory: "age_spread",
        config_key: "penalty",
        value: 1500,
        description: "Penalty for age spread violations",
        metadata: {
          data_type: "integer",
          source: "default_config",
          default_value: 1500,
          min_value: 0,
          max_value: 10000,
          friendly_name: "Age Spread Violation Penalty",
          tooltip: "Penalty weight for exceeding age spread limit",
          section: "age-grade",
          business_category: "solver",
          component_type: "slider",
          component_config: {},
        },
      },
      {
        category: "constraint",
        subcategory: "age_spread",
        config_key: "preferred_months",
        value: 12,
        description:
          "Preferred age spread in months — cabins at or below this spread earn a bonus (0 = disabled)",
        metadata: {
          data_type: "integer",
          source: "default_config",
          default_value: 12,
          min_value: 0,
          max_value: 60,
          friendly_name: "Preferred Age Spread (months)",
          tooltip:
            "Cabins at or below this spread earn a bonus (0 = disabled). Must be less than Max Age Difference.",
          section: "age-grade",
          business_category: "solver",
          component_type: "number",
          component_config: { min: 0, max: 60, step: 1, suffix: " months" },
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
