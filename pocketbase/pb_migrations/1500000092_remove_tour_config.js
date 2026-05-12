/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // 1. Drop the tour staleness config row. Wrap only the find in try/catch
    //    so delete errors propagate (mirrors the down migration's pattern).
    let config = null
    try {
      config = app.findFirstRecordByFilter(
        "config",
        'category = "tour" && config_key = "staleness_days"'
      )
    } catch {
      // already absent
    }
    if (config) app.delete(config)

    // 2. Drop the ui-preferences section only if no other config rows still
    //    reference it via metadata.section. Today nothing else does, but the
    //    guard future-proofs against any sibling config landing here later.
    let section = null
    try {
      section = app.findFirstRecordByFilter(
        "config_sections",
        'section_key = "ui-preferences"'
      )
    } catch {
      // already absent
    }
    if (section) {
      let sectionHasOtherRefs
      try {
        const remaining = app.findRecordsByFilter(
          "config",
          'metadata.section = "ui-preferences"',
          "",
          1,
          0
        )
        sectionHasOtherRefs = remaining.length > 0
      } catch {
        // If the JSON-path filter is unsupported in some build, err on the
        // side of preserving the section rather than silently deleting it.
        sectionHasOtherRefs = true
      }
      if (!sectionHasOtherRefs) app.delete(section)
    }
  },
  (app) => {
    const sectionsCollection = app.findCollectionByNameOrId("config_sections")

    let existingSection
    try {
      existingSection = app.findFirstRecordByFilter(
        "config_sections",
        'section_key = "ui-preferences"'
      )
    } catch {
      existingSection = null
    }

    if (!existingSection) {
      const section = new Record(sectionsCollection)
      section.set("section_key", "ui-preferences")
      section.set("title", "User Interface")
      section.set("description", "Tour and display preferences")
      section.set("display_order", 50)
      section.set("expanded_by_default", true)
      app.save(section)
    }

    const configCollection = app.findCollectionByNameOrId("config")

    let existingConfig
    try {
      existingConfig = app.findFirstRecordByFilter(
        "config",
        'category = "tour" && config_key = "staleness_days"'
      )
    } catch {
      existingConfig = null
    }

    if (!existingConfig) {
      const record = new Record(configCollection)
      record.set("category", "tour")
      record.set("subcategory", "")
      record.set("config_key", "staleness_days")
      record.set("value", 30)
      record.set("description", "Days before shared tour intros replay on 'Tour This Page'")
      record.set("metadata", {
        friendly_name: "Tour Staleness Threshold",
        tooltip:
          "How many days before the shared analytics intro steps are re-shown when a user clicks 'Tour This Page'. Lower values refresh knowledge more often.",
        data_type: "integer",
        source: "default_config",
        default_value: 30,
        min_value: 7,
        max_value: 365,
        section: "ui-preferences",
        display_order: 1,
        component_type: "number",
        component_config: { min: 7, max: 365, step: 1, suffix: " days" },
        business_category: "general",
      })
      app.save(record)
    }
  }
)
