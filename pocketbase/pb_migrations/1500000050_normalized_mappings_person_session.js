/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Add person and session relations to normalized_mappings
 *
 * Changes the normalized_mappings table to store one row per (person, session, category)
 * instead of one row per (original_value, category, year).
 *
 * This enables:
 * - Session-aware filtering for registration metrics
 * - Consistent counts between "Show sources" and main list
 * - Person-level congregation data from person_custom_values
 *
 * Schema changes:
 * - Add: person relation (nullable during migration)
 * - Add: session relation (nullable during migration)
 * - Update: unique index from (category, original_value, year) to (person, session, category)
 * - Add: session filtering index
 *
 * NOTE: This migration deletes all existing normalized_mappings data because
 * the old format (one row per original_value) is incompatible with the new format
 * (one row per person+session). Run normalize-geographic sync after migration.
 */

migrate((app) => {
  const collection = app.findCollectionByNameOrId("normalized_mappings");
  const personsCol = app.findCollectionByNameOrId("persons");
  const sessionsCol = app.findCollectionByNameOrId("camp_sessions");

  // Delete all existing records - old format is incompatible with new schema
  // The sync will repopulate with fresh data in the new format
  const existingRecords = app.findRecordsByFilter(collection.id, "1=1", "", 0, 0);
  for (const record of existingRecords) {
    app.delete(record);
  }

  // Add person relation field
  collection.fields.add(new Field({
    type: "relation",
    name: "person",
    required: false,  // Nullable to support edge cases
    presentable: false,
    collectionId: personsCol.id,
    cascadeDelete: false,
    minSelect: null,
    maxSelect: 1
  }));

  // Add session relation field
  collection.fields.add(new Field({
    type: "relation",
    name: "session",
    required: false,  // Nullable to support edge cases
    presentable: false,
    collectionId: sessionsCol.id,
    cascadeDelete: false,
    minSelect: null,
    maxSelect: 1
  }));

  // Remove old unique index (category, original_value, year)
  // Note: We keep idx_norm_lookup for backwards compatibility with source lookups
  collection.indexes = collection.indexes.filter(idx =>
    !idx.includes("idx_norm_unique")
  );

  // Add new indexes
  collection.indexes.push(
    // New unique constraint: (person, session, category)
    "CREATE UNIQUE INDEX IF NOT EXISTS `idx_norm_person_session` ON `normalized_mappings` (`person`, `session`, `category`)",

    // Index for session filtering (common query pattern)
    "CREATE INDEX IF NOT EXISTS `idx_norm_session_category` ON `normalized_mappings` (`session`, `category`, `year`)"
  );

  app.save(collection);
}, (app) => {
  // Down migration: remove new fields and indexes
  const collection = app.findCollectionByNameOrId("normalized_mappings");

  // Remove new indexes
  collection.indexes = collection.indexes.filter(idx =>
    !idx.includes("idx_norm_person_session") &&
    !idx.includes("idx_norm_session_category")
  );

  // Restore old unique index
  collection.indexes.push(
    "CREATE UNIQUE INDEX `idx_norm_unique` ON `normalized_mappings` (`category`, `original_value`, `year`)"
  );

  // Remove relation fields
  collection.fields.removeByName("person");
  collection.fields.removeByName("session");

  app.save(collection);
});
