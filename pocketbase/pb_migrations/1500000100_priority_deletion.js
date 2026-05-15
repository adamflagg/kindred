/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: delete priority + priority_locked from bunk_requests; replace
 * with is_first_requested. Swap diminishing-returns config rows for the
 * single objective.enable_first_boost debug toggle.
 *
 * Per the solver-config-it decision (docs/reference/solver-config-decisions.md
 * — Bunk Request Priority + Diminishing Returns domain). Closes #1432
 * (the unreachable `>=8` hard NOT_BUNK_WITH branch deletes alongside the
 * column it gates on).
 *
 * Schema changes (bunk_requests):
 *   - DROP column priority (1-10 ghost, producer caps at 4)
 *   - DROP column priority_locked (orphan — no backend reader)
 *   - DROP index idx_bunk_requests_priority
 *   - ADD column is_first_requested (bool, default false)
 *   - ADD index idx_bunk_requests_is_first_requested
 *
 * Backfill: is_first_requested defaults to false for every existing row.
 * The next sync run will recompute correctly from csv_position + keyword
 * scan. No best-effort backfill from priority>=4 — wife confirmed this
 * gives a less-honest interim state than a clean false.
 *
 * Config row changes:
 *   - DELETE objective.enable_diminishing_returns
 *   - DELETE objective.first_request_multiplier
 *   - DELETE objective.second_request_multiplier
 *   - DELETE objective.third_plus_request_multiplier
 *   - INSERT objective.enable_first_boost (bool, default true) — kept as a
 *     runtime knob so the debug solver can A/B "is the first-pick boost
 *     why we're not at 100% optimized" in later stages.
 *
 * Down-migration restores the pre-PR state from the original seed values
 * in 1500000011_config.js and 1500000018_bunk_requests.js so rollback is
 * clean.
 */
migrate(
  (app) => {
    // --- bunk_requests schema ---
    const collection = app.findCollectionByNameOrId("bunk_requests")

    collection.fields.removeByName("priority")
    collection.fields.removeByName("priority_locked")

    collection.fields.add(
      new Field({
        name: "is_first_requested",
        type: "bool",
        required: false,
        unique: false,
      }),
    )

    // Replace the priority index with is_first_requested; preserve all
    // other indexes intact. Filter is exact-match on the legacy index name.
    collection.indexes = collection.indexes.filter(
      (idx) => !idx.includes("idx_bunk_requests_priority"),
    )
    collection.indexes.push(
      "CREATE INDEX idx_bunk_requests_is_first_requested ON bunk_requests (is_first_requested)",
    )

    app.save(collection)

    // --- config rows ---
    const dropKeys = [
      "enable_diminishing_returns",
      "first_request_multiplier",
      "second_request_multiplier",
      "third_plus_request_multiplier",
    ]
    for (const key of dropKeys) {
      let record
      try {
        record = app.findFirstRecordByFilter(
          "config",
          `category = "objective" && config_key = "${key}"`,
        )
      } catch {
        // already gone — idempotent
      }
      if (record) app.delete(record)
    }

    // Add the single retained debug toggle, only if missing (idempotent).
    let existing
    try {
      existing = app.findFirstRecordByFilter(
        "config",
        `category = "objective" && config_key = "enable_first_boost"`,
      )
    } catch {
      existing = null
    }
    if (!existing) {
      const configCollection = app.findCollectionByNameOrId("config")
      const record = new Record(configCollection)
      record.set("category", "objective")
      record.set("subcategory", "")
      record.set("config_key", "enable_first_boost")
      record.set("value", 1)
      record.set(
        "description",
        "When true, the request flagged 'first pick' by the sync producer (csv-position 1 OR has priority keyword) is sorted to slot 0 of the diminishing-returns stack. When false, slot 0 falls to insertion order — useful for A/B-testing whether the first-pick boost actually improves outcomes.",
      )
      record.set("metadata", {
        data_type: "integer",
        source: "default_config",
        default_value: 1,
        min_value: 0,
        max_value: 1,
        friendly_name: "Enable First-Pick Boost",
        tooltip:
          "Give the family's first picked friend the slot-0 multiplier in the objective. Toggle off to A/B-test whether the boost helps.",
        section: "request-weighting",
        display_order: 1,
        business_category: "solver",
        component_type: "toggle",
        component_config: {},
      })
      app.save(record)
    }
  },
  (app) => {
    // --- bunk_requests schema rollback ---
    const collection = app.findCollectionByNameOrId("bunk_requests")

    collection.fields.removeByName("is_first_requested")
    collection.indexes = collection.indexes.filter(
      (idx) => !idx.includes("idx_bunk_requests_is_first_requested"),
    )

    collection.fields.add(
      new Field({
        name: "priority",
        type: "number",
        required: false,
        unique: false,
        min: 1,
        max: 10,
        onlyInt: true,
      }),
    )
    collection.fields.add(
      new Field({
        name: "priority_locked",
        type: "bool",
        required: false,
        unique: false,
      }),
    )
    collection.indexes.push(
      "CREATE INDEX idx_bunk_requests_priority ON bunk_requests (priority)",
    )

    app.save(collection)

    // --- config rows rollback ---
    let firstBoost
    try {
      firstBoost = app.findFirstRecordByFilter(
        "config",
        `category = "objective" && config_key = "enable_first_boost"`,
      )
    } catch {
      firstBoost = null
    }
    if (firstBoost) app.delete(firstBoost)

    const restored = [
      {
        key: "enable_diminishing_returns",
        value: 1,
        description:
          "Reduce weight for multiple satisfied requests from same camper (prevents gaming)",
        min_value: 0,
        max_value: 1,
        friendly_name: "Enable Diminishing Returns",
        tooltip:
          "Reduce weight for multiple satisfied requests from same camper (prevents gaming)",
        display_order: 1,
        component_type: "toggle",
      },
      {
        key: "first_request_multiplier",
        value: 10,
        description: "Multiplier for first satisfied request",
        min_value: 1,
        max_value: 10,
        friendly_name: "First Request Multiplier",
        tooltip: "Weight multiplier for first satisfied request",
        display_order: 2,
        component_type: "slider",
      },
      {
        key: "second_request_multiplier",
        value: 5,
        description: "Multiplier for second satisfied request",
        min_value: 1,
        max_value: 10,
        friendly_name: "Second Request Multiplier",
        tooltip: "Weight multiplier for second satisfied request",
        display_order: 3,
        component_type: "slider",
      },
      {
        key: "third_plus_request_multiplier",
        value: 1,
        description:
          "Multiplier for third and subsequent satisfied requests",
        min_value: 1,
        max_value: 10,
        friendly_name: "Third+ Request Multiplier",
        tooltip:
          "Weight multiplier for third and subsequent satisfied requests",
        display_order: 4,
        component_type: "slider",
      },
    ]

    const configCollection = app.findCollectionByNameOrId("config")
    for (const entry of restored) {
      let existing
      try {
        existing = app.findFirstRecordByFilter(
          "config",
          `category = "objective" && config_key = "${entry.key}"`,
        )
      } catch {
        existing = null
      }
      if (existing) continue

      const record = new Record(configCollection)
      record.set("category", "objective")
      record.set("subcategory", "")
      record.set("config_key", entry.key)
      record.set("value", entry.value)
      record.set("description", entry.description)
      record.set("metadata", {
        data_type: "integer",
        source: "default_config",
        default_value: entry.value,
        min_value: entry.min_value,
        max_value: entry.max_value,
        friendly_name: entry.friendly_name,
        tooltip: entry.tooltip,
        section: "request-weighting",
        display_order: entry.display_order,
        business_category: "solver",
        component_type: entry.component_type,
        component_config: {},
      })
      app.save(record)
    }
  },
)
