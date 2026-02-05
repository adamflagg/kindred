/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create geo_aliases collection
 *
 * Stores manual canonical mappings that override fuzzy matching.
 * Examples:
 *   - SF -> San Francisco (city abbreviation)
 *   - LA -> Los Angeles (city abbreviation)
 *   - Cong -> Congregation (congregation prefix)
 *
 * These aliases are checked BEFORE fuzzy matching in the normalization pipeline.
 * This allows administrators to handle edge cases that fuzzy matching misses.
 *
 * Used by: bunking/geo_normalizer/ (Python) and pocketbase/sync/normalize_geographic.go
 */

migrate((app) => {
  const collection = new Collection({
    type: "base",
    name: "geo_aliases",
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.id != ""',
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
      // The alias (the value to match)
      // Case-insensitive matching will be applied
      {
        type: "text",
        name: "alias",
        required: true,
        presentable: true,
        min: 1,
        max: 200,
        pattern: ""
      },
      // The canonical value (what the alias maps to)
      {
        type: "text",
        name: "canonical",
        required: true,
        presentable: true,
        min: 1,
        max: 200,
        pattern: ""
      },
      // Optional note explaining the alias
      {
        type: "text",
        name: "note",
        required: false,
        presentable: false,
        min: 0,
        max: 500,
        pattern: ""
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
      }
    ],
    indexes: [
      // Unique constraint on (category, alias) - each alias can only have one canonical
      "CREATE UNIQUE INDEX `idx_geo_alias_unique` ON `geo_aliases` (`category`, `alias`)",
      // Index for looking up by category
      "CREATE INDEX `idx_geo_alias_category` ON `geo_aliases` (`category`)"
    ]
  });

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("geo_aliases");
  app.delete(collection);
});
