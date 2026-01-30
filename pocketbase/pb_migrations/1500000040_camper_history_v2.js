/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Rework camper_history to non-deduplicated, multi-year structure
 *
 * BREAKING CHANGE: Schema changes from one row per (person_id, year) to
 * one row per (person_id, session_cm_id, year).
 *
 * This enables:
 * - Session-specific queries without joins
 * - Pre-joined person demographics to eliminate expand lookups
 * - Context-aware retention metrics (summer vs family)
 * - No redundant prior_year columns (query the table directly)
 *
 * Fields ADDED:
 * - session_cm_id: CampMinder session ID
 * - session: PB relation to camp_sessions
 * - person: PB relation to persons
 * - session_name: Denormalized session name
 * - session_type: Select field with all session types
 * - age: CampMinder's persons.age value
 * - bunk_cm_id: CampMinder bunk ID
 * - is_returning_summer: Attended summer-type session in prior year
 * - is_returning_family: Attended family/adult session in prior year
 * - first_year_summer: First year attended summer-type session
 * - first_year_family: First year attended family/adult session
 *
 * Fields RENAMED:
 * - bunks -> bunk_name (single value per record now)
 *
 * Fields REMOVED:
 * - sessions (replaced by single session_name per row)
 * - session_types (text) -> replaced by session_type (select)
 * - prior_year_sessions (query table for year-1 instead)
 * - prior_year_bunks (query table for year-1 instead)
 * - is_returning -> replaced by is_returning_summer, is_returning_family
 * - first_year_attended -> replaced by first_year_summer, first_year_family
 *
 * Unique index changes:
 * - OLD: (person_id, year)
 * - NEW: (person_id, session_cm_id, year)
 *
 * Computed by Go: pocketbase/sync/camper_history.go
 */

migrate((app) => {
  const collection = app.findCollectionByNameOrId("camper_history");
  const personsCol = app.findCollectionByNameOrId("persons");
  const sessionsCol = app.findCollectionByNameOrId("camp_sessions");

  // =========================================================================
  // Step 1: Add new fields
  // =========================================================================

  // Session identification
  collection.fields.add(new Field({
    type: "number",
    name: "session_cm_id",
    required: true,
    presentable: false,
    min: 1,
    max: 0,  // 0 = unlimited
    onlyInt: true
  }));

  collection.fields.add(new Field({
    type: "relation",
    name: "session",
    required: false,
    presentable: false,
    collectionId: sessionsCol.id,
    cascadeDelete: false,
    minSelect: null,
    maxSelect: 1
  }));

  collection.fields.add(new Field({
    type: "text",
    name: "session_name",
    required: false,
    presentable: false,
    min: 0,
    max: 200,
    pattern: ""
  }));

  // Session type as select field (matches camp_sessions enum)
  collection.fields.add(new Field({
    type: "select",
    name: "session_type",
    required: false,
    presentable: false,
    values: ["main", "embedded", "ag", "family", "quest", "training", "bmitzvah", "tli", "adult", "school", "hebrew", "teen", "other"],
    maxSelect: 1
  }));

  // Person relation
  collection.fields.add(new Field({
    type: "relation",
    name: "person",
    required: false,
    presentable: false,
    collectionId: personsCol.id,
    cascadeDelete: false,
    minSelect: null,
    maxSelect: 1
  }));

  // Age from persons table
  collection.fields.add(new Field({
    type: "number",
    name: "age",
    required: false,
    presentable: false,
    min: 0,
    max: 120,
    onlyInt: false  // Allow decimal ages
  }));

  // Bunk CM ID
  collection.fields.add(new Field({
    type: "number",
    name: "bunk_cm_id",
    required: false,
    presentable: false,
    min: 0,
    max: 0,  // 0 = unlimited
    onlyInt: true
  }));

  // Renamed field: bunks -> bunk_name (single value per record)
  collection.fields.add(new Field({
    type: "text",
    name: "bunk_name",
    required: false,
    presentable: false,
    min: 0,
    max: 100,
    pattern: ""
  }));

  // Context-aware retention fields
  collection.fields.add(new Field({
    type: "bool",
    name: "is_returning_summer",
    required: false,
    presentable: false
  }));

  collection.fields.add(new Field({
    type: "bool",
    name: "is_returning_family",
    required: false,
    presentable: false
  }));

  collection.fields.add(new Field({
    type: "number",
    name: "first_year_summer",
    required: false,
    presentable: false,
    min: 2010,
    max: 2100,
    onlyInt: true
  }));

  collection.fields.add(new Field({
    type: "number",
    name: "first_year_family",
    required: false,
    presentable: false,
    min: 0,  // 0 = never attended family
    max: 2100,
    onlyInt: true
  }));

  app.save(collection);

  // =========================================================================
  // Step 2: Migrate data from old fields to new fields
  // This is a data migration step - copy bunks to bunk_name, etc.
  // =========================================================================
  const db = app.db();

  // Copy bunks to bunk_name (for records that have data)
  db.newQuery(`
    UPDATE camper_history
    SET bunk_name = bunks
    WHERE bunks IS NOT NULL AND bunks != ''
  `).execute();

  // Copy session_types (text) to session_type (select) - take first value
  // This handles comma-separated values by taking the first type
  db.newQuery(`
    UPDATE camper_history
    SET session_type = CASE
      WHEN session_types LIKE '%main%' THEN 'main'
      WHEN session_types LIKE '%embedded%' THEN 'embedded'
      WHEN session_types LIKE '%ag%' THEN 'ag'
      WHEN session_types LIKE '%family%' THEN 'family'
      WHEN session_types LIKE '%quest%' THEN 'quest'
      WHEN session_types LIKE '%training%' THEN 'training'
      WHEN session_types LIKE '%bmitzvah%' THEN 'bmitzvah'
      WHEN session_types LIKE '%tli%' THEN 'tli'
      WHEN session_types LIKE '%adult%' THEN 'adult'
      WHEN session_types LIKE '%school%' THEN 'school'
      WHEN session_types LIKE '%hebrew%' THEN 'hebrew'
      WHEN session_types LIKE '%teen%' THEN 'teen'
      WHEN session_types LIKE '%other%' THEN 'other'
      ELSE NULL
    END
    WHERE session_types IS NOT NULL AND session_types != ''
  `).execute();

  // Copy is_returning to is_returning_summer (existing logic was summer-only)
  db.newQuery(`
    UPDATE camper_history
    SET is_returning_summer = is_returning
    WHERE is_returning IS NOT NULL
  `).execute();

  // Copy first_year_attended to first_year_summer
  db.newQuery(`
    UPDATE camper_history
    SET first_year_summer = first_year_attended
    WHERE first_year_attended IS NOT NULL AND first_year_attended > 0
  `).execute();

  // =========================================================================
  // Step 3: Drop old indexes BEFORE removing fields (SQLite requirement)
  // =========================================================================
  db.newQuery(`DROP INDEX IF EXISTS idx_camper_history_person_year`).execute();
  db.newQuery(`DROP INDEX IF EXISTS idx_camper_history_is_returning`).execute();
  db.newQuery(`DROP INDEX IF EXISTS idx_camper_history_first_year`).execute();
  db.newQuery(`DROP INDEX IF EXISTS idx_camper_history_session_types`).execute();

  // =========================================================================
  // Step 4: Remove old fields (indexes must be dropped first)
  // =========================================================================
  collection.fields.removeByName("sessions");
  collection.fields.removeByName("bunks");
  collection.fields.removeByName("session_types");
  collection.fields.removeByName("prior_year_sessions");
  collection.fields.removeByName("prior_year_bunks");
  collection.fields.removeByName("is_returning");
  collection.fields.removeByName("first_year_attended");

  app.save(collection);

  // =========================================================================
  // Step 5: Create new indexes
  // =========================================================================

  // Create new unique index on (person_id, session_cm_id, year)
  db.newQuery(`
    CREATE UNIQUE INDEX idx_camper_history_unique
    ON camper_history (person_id, session_cm_id, year)
  `).execute();

  // Additional query indexes
  db.newQuery(`CREATE INDEX IF NOT EXISTS idx_camper_history_session_type ON camper_history (session_type)`).execute();
  db.newQuery(`CREATE INDEX IF NOT EXISTS idx_camper_history_session_cm_id ON camper_history (session_cm_id)`).execute();
  db.newQuery(`CREATE INDEX IF NOT EXISTS idx_camper_history_returning_summer ON camper_history (is_returning_summer, year)`).execute();
  db.newQuery(`CREATE INDEX IF NOT EXISTS idx_camper_history_returning_family ON camper_history (is_returning_family, year)`).execute();
  db.newQuery(`CREATE INDEX IF NOT EXISTS idx_camper_history_person_rel ON camper_history (person)`).execute();
  db.newQuery(`CREATE INDEX IF NOT EXISTS idx_camper_history_session_rel ON camper_history (session)`).execute();
  db.newQuery(`CREATE INDEX IF NOT EXISTS idx_camper_history_first_year_summer ON camper_history (first_year_summer)`).execute();

}, (app) => {
  // =========================================================================
  // ROLLBACK: Restore old schema
  // =========================================================================
  const collection = app.findCollectionByNameOrId("camper_history");
  const db = app.db();

  // Drop new indexes
  db.newQuery(`DROP INDEX IF EXISTS idx_camper_history_unique`).execute();
  db.newQuery(`DROP INDEX IF EXISTS idx_camper_history_session_type`).execute();
  db.newQuery(`DROP INDEX IF EXISTS idx_camper_history_session_cm_id`).execute();
  db.newQuery(`DROP INDEX IF EXISTS idx_camper_history_returning_summer`).execute();
  db.newQuery(`DROP INDEX IF EXISTS idx_camper_history_returning_family`).execute();
  db.newQuery(`DROP INDEX IF EXISTS idx_camper_history_person_rel`).execute();
  db.newQuery(`DROP INDEX IF EXISTS idx_camper_history_session_rel`).execute();
  db.newQuery(`DROP INDEX IF EXISTS idx_camper_history_first_year_summer`).execute();

  // Add back old fields
  collection.fields.add(new Field({
    type: "text",
    name: "sessions",
    required: false,
    min: 0,
    max: 500,
    pattern: ""
  }));

  collection.fields.add(new Field({
    type: "text",
    name: "bunks",
    required: false,
    min: 0,
    max: 500,
    pattern: ""
  }));

  collection.fields.add(new Field({
    type: "text",
    name: "session_types",
    required: false,
    min: 0,
    max: 200,
    pattern: ""
  }));

  collection.fields.add(new Field({
    type: "text",
    name: "prior_year_sessions",
    required: false,
    min: 0,
    max: 500,
    pattern: ""
  }));

  collection.fields.add(new Field({
    type: "text",
    name: "prior_year_bunks",
    required: false,
    min: 0,
    max: 500,
    pattern: ""
  }));

  collection.fields.add(new Field({
    type: "bool",
    name: "is_returning",
    required: false
  }));

  collection.fields.add(new Field({
    type: "number",
    name: "first_year_attended",
    required: false,
    min: 2010,
    max: 2100,
    onlyInt: true
  }));

  app.save(collection);

  // Copy data back
  db.newQuery(`
    UPDATE camper_history
    SET bunks = bunk_name
    WHERE bunk_name IS NOT NULL AND bunk_name != ''
  `).execute();

  db.newQuery(`
    UPDATE camper_history
    SET is_returning = is_returning_summer
    WHERE is_returning_summer IS NOT NULL
  `).execute();

  db.newQuery(`
    UPDATE camper_history
    SET first_year_attended = first_year_summer
    WHERE first_year_summer IS NOT NULL AND first_year_summer > 0
  `).execute();

  // Remove new fields
  collection.fields.removeByName("session_cm_id");
  collection.fields.removeByName("session");
  collection.fields.removeByName("session_name");
  collection.fields.removeByName("session_type");
  collection.fields.removeByName("person");
  collection.fields.removeByName("age");
  collection.fields.removeByName("bunk_cm_id");
  collection.fields.removeByName("bunk_name");
  collection.fields.removeByName("is_returning_summer");
  collection.fields.removeByName("is_returning_family");
  collection.fields.removeByName("first_year_summer");
  collection.fields.removeByName("first_year_family");

  app.save(collection);

  // Restore old indexes
  db.newQuery(`
    CREATE UNIQUE INDEX idx_camper_history_person_year
    ON camper_history (person_id, year)
  `).execute();
  db.newQuery(`CREATE INDEX IF NOT EXISTS idx_camper_history_is_returning ON camper_history (is_returning)`).execute();
  db.newQuery(`CREATE INDEX IF NOT EXISTS idx_camper_history_first_year ON camper_history (first_year_attended)`).execute();
  db.newQuery(`CREATE INDEX IF NOT EXISTS idx_camper_history_session_types ON camper_history (session_types)`).execute();
});
