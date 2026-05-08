/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: drop ``constraint.cabin_capacity.*`` config rows + the
 * ``cabin-capacity`` section row, replaced by hardcoded constants in
 * ``bunking/solver/constants.py`` (Phase 2 cabin-capacity cleanup).
 *
 * Idempotent: safe to re-run; missing rows are skipped.
 */
migrate(
  (app) => {
    const configKeys = ["max", "standard", "mode", "penalty"]
    for (const key of configKeys) {
      try {
        const record = app.findFirstRecordByFilter(
          "config",
          `category = "constraint" && subcategory = "cabin_capacity" && config_key = "${key}"`,
        )
        if (record) app.delete(record)
      } catch {
        // already gone — ignore
      }
    }

    try {
      const section = app.findFirstRecordByFilter(
        "config_sections",
        'section_key = "cabin-capacity"',
      )
      if (section) app.delete(section)
    } catch {
      // already gone — ignore
    }
  },
  (app) => {
    // Down: re-create the rows with the original seeded values + section.
    // (Used only for rollback; will not match the live constants
    // bunking/solver/constants.py.)
    const configCollection = app.findCollectionByNameOrId("config")
    const seeds = [
      {
        config_key: "max",
        value: 14,
        description: "Maximum cabin capacity (with override)",
        metadata: { friendly_name: "Maximum Cabin Size", section: "cabin-capacity" },
      },
      {
        config_key: "standard",
        value: 12,
        description: "Standard cabin capacity",
        metadata: { friendly_name: "Standard Cabin Size", section: "cabin-capacity" },
      },
      {
        config_key: "mode",
        value: "hard",
        description: "Cabin capacity constraint mode (hard/soft)",
        metadata: { friendly_name: "Cabin Capacity Mode", section: "cabin-capacity" },
      },
      {
        config_key: "penalty",
        value: 50000,
        description: "Penalty for cabin capacity violations",
        metadata: { friendly_name: "Over-Capacity Penalty", section: "cabin-capacity" },
      },
    ]

    for (const seed of seeds) {
      let existing
      try {
        existing = app.findFirstRecordByFilter(
          "config",
          `category = "constraint" && subcategory = "cabin_capacity" && config_key = "${seed.config_key}"`,
        )
      } catch {
        existing = null
      }
      if (!existing) {
        const record = new Record(configCollection)
        record.set("category", "constraint")
        record.set("subcategory", "cabin_capacity")
        record.set("config_key", seed.config_key)
        record.set("value", seed.value)
        record.set("description", seed.description)
        record.set("metadata", seed.metadata)
        app.save(record)
      }
    }

    const sectionsCollection = app.findCollectionByNameOrId("config_sections")
    let existingSection
    try {
      existingSection = app.findFirstRecordByFilter(
        "config_sections",
        'section_key = "cabin-capacity"',
      )
    } catch {
      existingSection = null
    }
    if (!existingSection) {
      const section = new Record(sectionsCollection)
      section.set("section_key", "cabin-capacity")
      section.set("title", "Cabin Capacity Rules")
      section.set("description", "Configure cabin size limits and overflow handling")
      section.set("display_order", 3)
      section.set("expanded_by_default", false)
      app.save(section)
    }
  },
)
