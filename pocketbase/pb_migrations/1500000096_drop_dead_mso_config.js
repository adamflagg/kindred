/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: drop the three dead ``constraint.must_satisfy_one.{enabled,
 * fallback_to_age, ignore_impossible_requests}`` config rows. The Python
 * code paths that read them have been removed in the same PR; their off-
 * states were either dead-code (``enabled``), broken (``fallback_to_age``
 * silently breaks age-only-request coverage), or actively wrong
 * (``ignore_impossible_requests`` injects guaranteed false soft-violations).
 *
 * KEPT: ``constraint.must_satisfy_one.penalty`` (the lone tunable knob —
 * staff can still tune how aggressively the optimizer chases coverage).
 *
 * The ``core-constraints`` section row is KEPT — it still holds the
 * remaining tunable (``penalty``).
 *
 * Idempotent: safe to re-run; missing rows are skipped.
 */
migrate(
  (app) => {
    const configKeys = ["enabled", "fallback_to_age", "ignore_impossible_requests"]
    for (const key of configKeys) {
      let record
      try {
        record = app.findFirstRecordByFilter(
          "config",
          `category = "constraint" && subcategory = "must_satisfy_one" && config_key = "${key}"`,
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
    // Down: re-create the three rows with the original seeded values from
    // 1500000011_config.js so a rollback restores the pre-cleanup state.
    const configCollection = app.findCollectionByNameOrId("config")
    const seeds = [
      {
        config_key: "enabled",
        value: 1,
        description: "Whether every camper must have at least one request satisfied",
        metadata: {
          friendly_name: "Require One Request Satisfied",
          section: "core-constraints",
          tooltip: "Whether every camper must have at least one bunk request satisfied",
          type: "int",
          min: 0,
          max: 1,
        },
      },
      {
        config_key: "fallback_to_age",
        value: 1,
        description: "Fall back to age preference if no other requests",
        metadata: {
          friendly_name: "Use Age Preference as Fallback",
          section: "core-constraints",
          tooltip: "If no specific requests, count age preference as satisfying the requirement",
          type: "int",
          min: 0,
          max: 1,
        },
      },
      {
        config_key: "ignore_impossible_requests",
        value: 1,
        description: "Ignore requests for people not in the session (prevents solver failure)",
        metadata: {
          friendly_name: "Ignore Out-of-Session Requests",
          section: "core-constraints",
          tooltip: "Ignore requests for campers not attending the same session",
          type: "int",
          min: 0,
          max: 1,
        },
      },
    ]

    for (const seed of seeds) {
      let existing
      try {
        existing = app.findFirstRecordByFilter(
          "config",
          `category = "constraint" && subcategory = "must_satisfy_one" && config_key = "${seed.config_key}"`,
        )
      } catch {
        existing = null
      }
      if (existing) continue

      const record = new Record(configCollection)
      record.set("category", "constraint")
      record.set("subcategory", "must_satisfy_one")
      record.set("config_key", seed.config_key)
      record.set("value", seed.value)
      record.set("description", seed.description)
      record.set("metadata", seed.metadata)
      app.save(record)
    }
  },
)
