/// <reference path="../pb_data/types.d.ts" />

/**
 * Backfill the kept ``constraint.age_spread.preferred_bonus`` config row.
 *
 * Root cause: this key was introduced (required=True, no code default) by
 * standalone migration ``1500000098_age_spread_preferred_threshold.js`` (#1021,
 * 2026-04-27), which is the only migration that INSERTS it into an existing DB.
 * Consolidation #1275 (2026-05-10) deleted 098 and folded its seed into the
 * from-scratch canonical seed ``1500000011_config.js``. Migration 011 had long
 * since been applied in prod, so editing it never re-runs — and any DB that did
 * not apply 098 during its 13-day lifetime never received the row. The later
 * solver-config-it cleanup (``1500000107_drop_age_spread_orphan_configs.js``)
 * correctly KEEPS preferred_bonus but adds no "ensure it exists" step.
 *
 * Result: ``ConfigLoader`` raises "Required config key
 * 'constraint.age_spread.preferred_bonus' not found in database" and the solver
 * cannot run. This migration self-heals such DBs and protects any other env
 * that missed 098.
 *
 * The seeded value/metadata mirror exactly what a fresh ``1500000011`` install
 * produces for this key, so the admin GUI treats the backfilled row identically.
 *
 * Idempotent: on a healthy DB (row already present) this is a no-op.
 *
 * Down: intentionally a NO-OP. This is a corrective backfill of a REQUIRED key,
 * not a net-new feature row — deleting it on rollback would re-introduce the
 * exact "config key not found" outage this migration fixes.
 */
migrate(
  (app) => {
    let existing
    try {
      existing = app.findFirstRecordByFilter(
        "config",
        `category = "constraint" && subcategory = "age_spread" && config_key = "preferred_bonus"`,
      )
    } catch {
      existing = null
    }
    if (existing) return

    const configCollection = app.findCollectionByNameOrId("config")
    const record = new Record(configCollection)
    record.set("category", "constraint")
    record.set("subcategory", "age_spread")
    record.set("config_key", "preferred_bonus")
    record.set("value", 500)
    record.set(
      "description",
      "Bonus weight for cabins whose age spread is within the preferred threshold",
    )
    record.set("metadata", {
      data_type: "integer",
      source: "default_config",
      default_value: 500,
      min_value: 0,
      max_value: 10000,
      friendly_name: "Preferred Age Spread Bonus",
      tooltip:
        "Objective bonus for each cabin within the preferred age spread. Higher = solver tries harder to form tight age groups.",
      section: "age-grade",
      // Only key remaining in the age-grade section after Age Spread Phase 2.
      display_order: 1,
      business_category: "solver",
      component_type: "slider",
      component_config: { min: 0, max: 10000, step: 100, showValue: true },
    })
    app.save(record)
  },
  (_app) => {
    // No-op: see header. preferred_bonus is a required solver config; removing
    // it on rollback would re-break the solver.
  },
)
