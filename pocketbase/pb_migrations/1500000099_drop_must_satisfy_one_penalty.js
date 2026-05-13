/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: drop the ``constraint.must_satisfy_one.penalty`` config row.
 *
 * Stage 4 (#1379) replaced the soft must_satisfy_one constraint (per-camper
 * NewBoolVar + 2 reified OnlyEnforceIf linears + soft_constraint_violations
 * registration) with a HARD CP-SAT constraint over Material-Parent (MP)
 * requests only. The penalty knob is therefore dead config — schema entry
 * and loader weight-mapping were removed in the same PR.
 *
 * Idempotent: re-running after the row is gone is a no-op.
 *
 * Down-migration restores the row with its original seeded value (100000)
 * from 1500000011_config.js so a rollback restores the pre-Stage-4 state.
 * Metadata mirrors the seed migration's metadata-builder fields so the
 * admin GUI recognizes the restored row.
 */
migrate(
  (app) => {
    let record
    try {
      record = app.findFirstRecordByFilter(
        "config",
        `category = "constraint" && subcategory = "must_satisfy_one" && config_key = "penalty"`,
      )
    } catch {
      // already gone — ignore (findFirstRecordByFilter throws on no match)
    }
    // Delete runs OUTSIDE the catch so real delete errors (permissions,
    // FK, runtime) surface instead of being silently swallowed.
    if (record) app.delete(record)
  },
  (app) => {
    // Down: re-create the penalty row with the original seeded value from
    // 1500000011_config.js. Mirrors the metadata shape of the seed-time row
    // (data_type, source, default_value, min/max, friendly_name, tooltip,
    // section, display_order, business_category, component_type/config)
    // so the admin GUI continues to render the row after rollback.
    let existing
    try {
      existing = app.findFirstRecordByFilter(
        "config",
        `category = "constraint" && subcategory = "must_satisfy_one" && config_key = "penalty"`,
      )
    } catch {
      existing = null
    }
    if (existing) return

    const configCollection = app.findCollectionByNameOrId("config")
    const record = new Record(configCollection)
    record.set("category", "constraint")
    record.set("subcategory", "must_satisfy_one")
    record.set("config_key", "penalty")
    record.set("value", 100000)
    record.set("description", "How heavily the optimizer penalizes leaving a camper without any requests fulfilled. Higher = tries harder to satisfy everyone.")
    record.set("metadata", {
      data_type: "integer",
      source: "default_config",
      default_value: 100000,
      min_value: 0,
      max_value: 500000,
      friendly_name: "Request Satisfaction Penalty",
      tooltip: "Penalty for leaving a camper with no requests satisfied (higher = optimizer tries harder)",
      section: "core-constraints",
      display_order: 4,
      business_category: "solver",
      component_type: "slider",
      component_config: {},
    })
    app.save(record)
  },
)
