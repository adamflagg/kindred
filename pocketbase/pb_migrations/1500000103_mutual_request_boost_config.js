/// <reference path="../pb_data/types.d.ts" />

/**
 * Seed objective.mutual_request_boost config row for Stream 4 (#1382).
 *
 * Adds a single objective-category config row controlling the multiplier
 * applied to bunk_with requests where both directions exist (A→B AND B→A
 * both filed as bunk_with). Always on; default 2.0; set to 1.0 to disable
 * the boost in-place without touching code. Range [0.0, 10.0] matches the
 * existing source_multipliers entries.
 *
 * Idempotent — re-running the migration is a no-op.
 */
migrate(
  (app) => {
    let existing
    try {
      existing = app.findFirstRecordByFilter(
        "config",
        `category = "objective" && config_key = "mutual_request_boost"`,
      )
    } catch {
      existing = null
    }
    if (existing) return

    const configCollection = app.findCollectionByNameOrId("config")
    const record = new Record(configCollection)
    record.set("category", "objective")
    record.set("subcategory", "")
    record.set("config_key", "mutual_request_boost")
    record.set("value", 2.0)
    record.set(
      "description",
      "Multiplier applied to bunk_with requests when both directions exist (A→B AND B→A both filed as bunk_with). Always on; set to 1.0 to disable the boost without removing the code path. Stacks multiplicatively with source_multipliers and diminishing-returns weights.",
    )
    record.set("metadata", {
      data_type: "float",
      source: "default_config",
      default_value: 2.0,
      min_value: 0.0,
      max_value: 10.0,
      friendly_name: "Mutual Request Boost",
      tooltip:
        "Extra weight when both families name each other as bunk-with picks. 2.0 doubles the request's objective score; 1.0 disables the boost.",
      section: "request-weighting",
      display_order: 2,
      business_category: "solver",
      component_type: "number",
      component_config: {},
    })
    app.save(record)
  },
  (app) => {
    let record
    try {
      record = app.findFirstRecordByFilter(
        "config",
        `category = "objective" && config_key = "mutual_request_boost"`,
      )
    } catch {
      return
    }
    if (record) app.delete(record)
  },
)
