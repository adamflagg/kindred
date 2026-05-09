/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create normalized_mappings collection
 *
 * Stores per-(person, session, category) mappings from original geographic
 * values to normalized/canonical values (cities, schools, congregations).
 *
 * Computed by Go: pocketbase/sync/normalize_geographic.go
 */

migrate((app) => {
  const personsCol = app.findCollectionByNameOrId("persons");
  const sessionsCol = app.findCollectionByNameOrId("camp_sessions");

  const adminOnly = '@request.auth.is_admin = true';
  const metricsGeo = '@request.auth.is_admin = true || @request.auth.cached_permissions ~ "metrics.geo"';

  const collection = new Collection({
    type: "base",
    name: "normalized_mappings",
    listRule: metricsGeo,
    viewRule: metricsGeo,
    createRule: adminOnly,
    updateRule: adminOnly,
    deleteRule: adminOnly,
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
      },
      // Person and session relations — one row per (person, session, category)
      {
        type: "relation",
        name: "person",
        required: false,
        presentable: false,
        collectionId: personsCol.id,
        cascadeDelete: false,
        minSelect: null,
        maxSelect: 1
      },
      {
        type: "relation",
        name: "session",
        required: false,
        presentable: false,
        collectionId: sessionsCol.id,
        cascadeDelete: false,
        minSelect: null,
        maxSelect: 1
      },
      // Raw address fields preserved alongside normalized values for drilldown
      {
        type: "text",
        name: "address_state",
        required: false,
        presentable: false,
        min: 0,
        max: 50
      },
      {
        type: "text",
        name: "address_country",
        required: false,
        presentable: false,
        min: 0,
        max: 100
      },
      {
        type: "text",
        name: "address_city",
        required: false,
        presentable: false,
        min: 0,
        max: 200
      }
    ],
    indexes: [
      // Lookup index for finding all originals that map to a normalized value
      "CREATE INDEX `idx_norm_lookup` ON `normalized_mappings` (`category`, `normalized_value`, `year`)",
      // Year index for filtering
      "CREATE INDEX `idx_norm_year` ON `normalized_mappings` (`year`)",
      // Unique constraint: (person, session, category)
      "CREATE UNIQUE INDEX IF NOT EXISTS `idx_norm_person_session` ON `normalized_mappings` (`person`, `session`, `category`)",
      // Index for session filtering (common query pattern)
      "CREATE INDEX IF NOT EXISTS `idx_norm_session_category` ON `normalized_mappings` (`session`, `category`, `year`)"
    ]
  });

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("normalized_mappings");
  app.delete(collection);
});
