/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create normalized_mappings collection
 *
 * Stores mapping from original values to normalized/canonical values
 * for geographic data (cities, schools, congregations).
 *
 * Used by normalize_geographic sync job to:
 * 1. Track all original → normalized mappings with confidence scores
 * 2. Support fuzzy clustering of similar values
 * 3. Enable analytics on data quality and normalization coverage
 *
 * Computed by Go: pocketbase/sync/normalize_geographic.go
 */

migrate((app) => {
  const collection = new Collection({
    type: "base",
    name: "normalized_mappings",
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
      // The normalized/canonical value
      {
        type: "text",
        name: "normalized_value",
        required: true,
        presentable: true,
        min: 0,
        max: 500,
        pattern: ""
      },
      // The original value from source data
      {
        type: "text",
        name: "original_value",
        required: true,
        presentable: false,
        min: 0,
        max: 500,
        pattern: ""
      },
      // Count of records with this original value
      {
        type: "number",
        name: "occurrence_count",
        required: false,
        presentable: false,
        min: 0,
        max: 999999,
        onlyInt: true
      },
      // Confidence score for the normalization (0.0 - 1.0)
      // 1.0 = exact match, lower = fuzzy match
      {
        type: "number",
        name: "confidence",
        required: false,
        presentable: false,
        min: 0,
        max: 1,
        onlyInt: false
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
      }
    ],
    indexes: [
      // Unique constraint on (category, original_value, year)
      "CREATE UNIQUE INDEX `idx_norm_unique` ON `normalized_mappings` (`category`, `original_value`, `year`)",
      // Lookup index for finding all originals that map to a normalized value
      "CREATE INDEX `idx_norm_lookup` ON `normalized_mappings` (`category`, `normalized_value`, `year`)",
      // Year index for filtering
      "CREATE INDEX `idx_norm_year` ON `normalized_mappings` (`year`)"
    ]
  });

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("normalized_mappings");
  app.delete(collection);
});
