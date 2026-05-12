/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: drop ``constraint.cabin_minimum_occupancy.{enabled, min,
 * preferred, force_all_used}`` config rows. They are replaced by hardcoded
 * constants in ``bunking/solver/constants.py``:
 *   - MIN_BUNK_OCCUPANCY = 8        (was: cabin_minimum_occupancy.min)
 *   - PREFERRED_BUNK_OCCUPANCY = 10 (was: cabin_minimum_occupancy.preferred)
 *
 * The ``enabled`` and ``force_all_used`` toggles were dead — the constraint
 * is a staff invariant and always runs. The ``penalty`` row is KEPT as the
 * lone tunable knob in this domain.
 *
 * The ``cabin-occupancy`` section row is KEPT (it still holds the one
 * remaining tunable, ``penalty``).
 *
 * Idempotent: safe to re-run; missing rows are skipped.
 */
migrate(
  (app) => {
    const configKeys = ["enabled", "min", "preferred", "force_all_used"]
    for (const key of configKeys) {
      try {
        const record = app.findFirstRecordByFilter(
          "config",
          `category = "constraint" && subcategory = "cabin_minimum_occupancy" && config_key = "${key}"`,
        )
        if (record) app.delete(record)
      } catch {
        // already gone — ignore
      }
    }
  },
  (app) => {
    // Down: re-create the rows with the original seeded values. (Used only
    // for rollback; will not match the live constants in
    // bunking/solver/constants.py.)
    const configCollection = app.findCollectionByNameOrId("config")
    const seeds = [
      {
        config_key: "enabled",
        value: 1,
        description: "Enable minimum occupancy constraint (1=enabled, 0=disabled)",
        metadata: {
          friendly_name: "Enable Minimum Occupancy",
          section: "cabin-occupancy",
          tooltip: "Enable minimum occupancy constraint for non-AG bunks",
          type: "int",
          min: 0,
          max: 1,
        },
      },
      {
        config_key: "min",
        value: 8,
        description: "Hard minimum: if bunk has any campers, must have at least this many",
        metadata: {
          friendly_name: "Hard Minimum Campers",
          section: "cabin-occupancy",
          tooltip: "Hard minimum: if bunk has any campers, must have at least this many",
          type: "int",
          min: 1,
          max: 12,
        },
      },
      {
        config_key: "preferred",
        value: 10,
        description: "Soft preferred: penalize bunks with fewer than this many campers",
        metadata: {
          friendly_name: "Preferred Minimum Campers",
          section: "cabin-occupancy",
          tooltip: "Soft preferred: penalize bunks with fewer than this many campers",
          type: "int",
          min: 1,
          max: 12,
        },
      },
      {
        config_key: "force_all_used",
        value: 1,
        description: "Force all cabins to be used when enough campers exist (1=enabled)",
        metadata: {
          friendly_name: "Force All Cabins Used",
          section: "cabin-occupancy",
          tooltip: "Force all cabins to be used when enough campers exist",
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
          `category = "constraint" && subcategory = "cabin_minimum_occupancy" && config_key = "${seed.config_key}"`,
        )
      } catch {
        existing = null
      }
      if (existing) continue

      const record = new Record(configCollection)
      record.set("category", "constraint")
      record.set("subcategory", "cabin_minimum_occupancy")
      record.set("config_key", seed.config_key)
      record.set("value", seed.value)
      record.set("description", seed.description)
      record.set("metadata", seed.metadata)
      app.save(record)
    }
  },
)
