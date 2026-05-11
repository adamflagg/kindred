/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    try {
      const config = app.findFirstRecordByFilter(
        "config",
        'category = "tour" && config_key = "staleness_days"'
      )
      if (config) app.delete(config)
    } catch {
      // already absent
    }

    try {
      const section = app.findFirstRecordByFilter(
        "config_sections",
        'section_key = "ui-preferences"'
      )
      if (section) app.delete(section)
    } catch {
      // already absent
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
