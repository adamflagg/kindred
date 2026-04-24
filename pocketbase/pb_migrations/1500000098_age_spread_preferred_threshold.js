/// <reference path="../pb_data/types.d.ts" />

// Migration: Add 12mo preferred age-spread threshold config keys
//
// Adds two new solver config entries under the existing "age-grade" section:
//   constraint.age_spread.preferred_months  – soft preferred threshold in months (default 12)
//   constraint.age_spread.preferred_bonus   – bonus weight for cabins within the threshold (default 500)
//
// Both keys are in the same "age-grade" admin section as the existing
// constraint.age_spread.penalty and spread.max_age_months keys.

migrate(
  (app) => {
    const configCollection = app.findCollectionByNameOrId("config")

    const newConfigs = [
      {
        category: "constraint",
        subcategory: "age_spread",
        config_key: "preferred_months",
        value: 12,
        description: "Preferred age spread in months — cabins at or below this spread earn a bonus (0 = disabled)",
        metadata: {
          friendly_name: "Preferred Age Spread (months)",
          tooltip:
            "Cabins whose max−min age spread is at or below this threshold earn a bonus in the objective function, " +
            "encouraging tighter age groupings without preventing wider spreads. " +
            "Set to 0 to disable the preferred threshold. Must be less than Max Age Difference to have any effect.",
          data_type: "integer",
          source: "default_config",
          default_value: 12,
          min_value: 0,
          max_value: 60,
          section: "age-grade",
          display_order: 22,
          component_type: "number",
          component_config: {
            min: 0,
            max: 60,
            step: 1,
            suffix: " months",
          },
          business_category: "solver",
        },
      },
      {
        category: "constraint",
        subcategory: "age_spread",
        config_key: "preferred_bonus",
        value: 500,
        description: "Bonus weight for cabins whose age spread is within the preferred threshold",
        metadata: {
          friendly_name: "Preferred Age Spread Bonus",
          tooltip:
            "Objective-function bonus added for each cabin whose age spread is at or below the Preferred Age Spread " +
            "threshold. Higher values make the solver try harder to form tight age groups. " +
            "Has no effect when Preferred Age Spread is 0 or equals Max Age Difference.",
          data_type: "integer",
          source: "default_config",
          default_value: 500,
          min_value: 0,
          max_value: 10000,
          section: "age-grade",
          display_order: 23,
          component_type: "slider",
          component_config: {
            min: 0,
            max: 10000,
            step: 100,
            showValue: true,
          },
          business_category: "solver",
        },
      },
    ]

    for (const cfg of newConfigs) {
      // Idempotent: skip if already exists
      let existing
      try {
        existing = app.findFirstRecordByFilter(
          "config",
          `category = "${cfg.category}" && subcategory = "${cfg.subcategory}" && config_key = "${cfg.config_key}"`
        )
      } catch {
        existing = null
      }

      if (!existing) {
        const record = new Record(configCollection)
        record.set("category", cfg.category)
        record.set("subcategory", cfg.subcategory)
        record.set("config_key", cfg.config_key)
        record.set("value", cfg.value)
        record.set("description", cfg.description)
        record.set("metadata", cfg.metadata)
        app.save(record)
      }
    }
  },
  (app) => {
    // Rollback: delete the two new records
    const toDelete = [
      { subcategory: "age_spread", key: "preferred_months" },
      { subcategory: "age_spread", key: "preferred_bonus" },
    ]

    for (const item of toDelete) {
      try {
        const record = app.findFirstRecordByFilter(
          "config",
          `category = "constraint" && subcategory = "${item.subcategory}" && config_key = "${item.key}"`
        )
        if (record) app.delete(record)
      } catch {
        // already gone — ignore
      }
    }
  }
)
