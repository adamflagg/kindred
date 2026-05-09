/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create geo_overrides collection
 *
 * Stores user-defined overrides for geographic data normalization.
 * Override types:
 *   - alias:     Maps a raw_value to a canonical_name (e.g. typo → correct)
 *   - canonical: Defines/updates the canonical entry with coordinates
 *   - merge:     Redirects one canonical_name into another via merged_into
 *   - rejected:  Blocklist entries
 *
 * Used by the geo normalization pipeline to apply human corrections
 * before or after automated normalization. Access is restricted to the
 * metrics.geo permission (admins or users with that cached permission).
 */

migrate((app) => {
  const metricsGeo = '@request.auth.is_admin = true || @request.auth.cached_permissions ~ "metrics.geo"'

  const collection = new Collection({
    type: "base",
    name: "geo_overrides",
    listRule: metricsGeo,
    viewRule: metricsGeo,
    createRule: metricsGeo,
    updateRule: metricsGeo,
    deleteRule: metricsGeo,
    fields: [
      // Category: city, school, or congregation
      {
        type: "select",
        name: "category",
        required: true,
        presentable: true,
        values: ["city", "school", "congregation"],
        maxSelect: 1
      },
      // Override type: alias, canonical, merge, or rejected
      {
        type: "select",
        name: "override_type",
        required: true,
        presentable: true,
        values: ["alias", "canonical", "merge", "rejected"],
        maxSelect: 1
      },
      // The raw/original value (for alias type)
      {
        type: "text",
        name: "raw_value",
        required: false,
        presentable: false,
        min: 0,
        max: 500,
        pattern: ""
      },
      // The canonical/normalized name
      {
        type: "text",
        name: "canonical_name",
        required: true,
        presentable: true,
        min: 0,
        max: 500,
        pattern: ""
      },
      // City (for location context)
      {
        type: "text",
        name: "city",
        required: false,
        presentable: false,
        min: 0,
        max: 200,
        pattern: ""
      },
      // State (for location context)
      {
        type: "text",
        name: "state",
        required: false,
        presentable: false,
        min: 0,
        max: 50,
        pattern: ""
      },
      // Latitude (-90 to 90)
      {
        type: "number",
        name: "lat",
        required: false,
        presentable: false,
        min: -90,
        max: 90,
        onlyInt: false
      },
      // Longitude (-180 to 180)
      {
        type: "number",
        name: "lng",
        required: false,
        presentable: false,
        min: -180,
        max: 180,
        onlyInt: false
      },
      // Target canonical name for merge type
      {
        type: "text",
        name: "merged_into",
        required: false,
        presentable: false,
        min: 0,
        max: 500,
        pattern: ""
      },
      // Free-form notes
      {
        type: "text",
        name: "notes",
        required: false,
        presentable: false,
        min: 0,
        max: 2000,
        pattern: ""
      },
      // Year scope
      {
        type: "number",
        name: "year",
        required: true,
        presentable: false,
        min: 2010,
        max: 2100,
        onlyInt: true
      },
      // Auto timestamps
      {
        type: "autodate",
        name: "created",
        required: false,
        presentable: false,
        onCreate: true,
        onUpdate: false
      },
      {
        type: "autodate",
        name: "updated",
        required: false,
        presentable: false,
        onCreate: true,
        onUpdate: true
      },
      // Result of automated nominatim lookup for this override
      {
        type: "select",
        name: "nominatim_status",
        required: false,
        values: ["resolved", "no_result", "ambiguous"],
        maxSelect: 1
      },
      // Country (for location context)
      {
        type: "text",
        name: "address_country",
        required: false,
        presentable: false,
        min: 0,
        max: 100
      }
    ],
    indexes: [
      // Lookup by category and year
      "CREATE INDEX `idx_geo_overrides_category_year` ON `geo_overrides` (`category`, `year`)",
      // Unique alias constraint: one raw_value per category+year (only for alias type with non-empty raw_value)
      "CREATE UNIQUE INDEX `idx_geo_overrides_alias` ON `geo_overrides` (`category`, `raw_value`, `year`) WHERE `override_type` = 'alias' AND `raw_value` != ''",
      // Lookup by canonical name
      "CREATE INDEX `idx_geo_overrides_canonical` ON `geo_overrides` (`category`, `canonical_name`, `year`)"
    ]
  });

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("geo_overrides");
  app.delete(collection);
});
