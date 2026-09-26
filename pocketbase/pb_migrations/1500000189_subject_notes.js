/// <reference path="../pb_data/types.d.ts" />
/**
 * subject_notes -- a short free-text staff Note on one subject's registration
 * for one session: a summer camper or an adult-weekend guest (`person`), or a
 * Family Camp household (`household`). Board notes design, 2026-09-25.
 *
 * Keyed on CampMinder ids, never PocketBase ids (`subject_cm_id` is
 * persons.cm_id or the household cm id; the kind is part of the key because
 * the two id spaces differ). `session_cm_id` is the SUBJECT'S OWN registration
 * session: a summer AG camper keeps the AG session's id, and the summer board
 * reads main + AG together through SessionContext.related_session_ids.
 * Year-scoped like every CampMinder-keyed table.
 *
 * ONE TABLE, NOT A LIVE/DRAFT PAIR. The lodging_*_draft split exists because
 * placements diverge and are reconciled on push. A note has nothing to
 * reconcile, and the board reads both layers in one query, so `scenario` is
 * an OPTIONAL relation: '' is the standard note CampMinder live and every
 * scenario show; an id is that scenario's plan-only note, which adds to the
 * standard note and never replaces it. lodging_slot_merges (1500000140) is the
 * precedent for '' as a tier of its own.
 *
 * UNIQUE (subject_kind, subject_cm_id, session_cm_id, year, scenario).
 * PocketBase stores an empty single relation as '' (NOT NULL), so SQLite's
 * UNIQUE covers the standard row too: one standard note plus one plan-only
 * note per scenario. Pinned by main_subject_notes_migration_test.go.
 *
 * scenario.cascadeDelete is TRUE: deleting a scenario takes its plan-only
 * notes with it, and create_scenario's rollback (api/routers/scenarios.py)
 * relies on that when a copy fails half-way.
 *
 * All five rules are BUNKING_MANAGE: reading is gated as well as writing
 * (owner, 2026-09-25). The FastAPI layer checks the same permission itself --
 * it reaches PocketBase with its own credentials -- so these rules guard
 * direct /api/collections access.
 *
 * PocketBase v0.23 syntax: field properties are DIRECT, never nested inside
 * `options: {}`, which is silently ignored.
 */

// VERBATIM from 1500000161:114-115. Do not paraphrase: the permission is read
// off `cached_permissions` as a dotted string, and the plausible alternative
// (`@request.auth.permissions.bunking ?~ "manage"`) matches nothing and denies
// every request SILENTLY.
const BUNKING_MANAGE =
  '@request.auth.is_admin = true || @request.auth.cached_permissions ~ "bunking.manage"';

migrate(
  (app) => {
    // Idempotent create: a re-run is a no-op, never a second create.
    try {
      app.findCollectionByNameOrId('subject_notes');
      return;
    } catch {
      // Not present -- create it below.
    }
    const scenarios = app.findCollectionByNameOrId('saved_scenarios');
    app.save(
      new Collection({
        type: 'base',
        // LITERAL, not a constant: scripts/dev/verify-migration-history.sh
        // regexes `name: '...'` out of the up arm to find CREATEs.
        name: 'subject_notes',
        listRule: BUNKING_MANAGE,
        viewRule: BUNKING_MANAGE,
        createRule: BUNKING_MANAGE,
        updateRule: BUNKING_MANAGE,
        deleteRule: BUNKING_MANAGE,
        fields: [
          { type: 'select', name: 'subject_kind', required: true, presentable: false, maxSelect: 1, values: ['person', 'household'] },
          { type: 'number', name: 'subject_cm_id', required: true, presentable: false, min: 1, max: null, onlyInt: true },
          { type: 'number', name: 'session_cm_id', required: true, presentable: false, min: 1, max: null, onlyInt: true },
          { type: 'number', name: 'year', required: true, presentable: false, min: 2000, max: 2100, onlyInt: true },
          {
            type: 'relation', name: 'scenario', required: false, presentable: false,
            collectionId: scenarios.id, cascadeDelete: true, minSelect: null, maxSelect: 1,
          },
          // Same 2000 cap as lodging_write_ins.note. Required: an empty save
          // deletes the row in the service, so a stored note is never blank.
          { type: 'text', name: 'body', required: true, presentable: false, min: 0, max: 2000, pattern: '' },
          // Display only; set by the API from the authenticated user.
          { type: 'text', name: 'updated_by', required: false, presentable: false, min: 0, max: 200, pattern: '' },
          { type: 'autodate', name: 'created', required: false, presentable: false, onCreate: true, onUpdate: false },
          { type: 'autodate', name: 'updated', required: false, presentable: false, onCreate: true, onUpdate: true },
        ],
        indexes: [
          'CREATE UNIQUE INDEX `idx_subject_notes_unique` ON `subject_notes` (`subject_kind`, `subject_cm_id`, `session_cm_id`, `year`, `scenario`)',
          // The board read: year + a session family.
          'CREATE INDEX `idx_subject_notes_session_year` ON `subject_notes` (`session_cm_id`, `year`)',
          // copy_plan_notes reads one scenario's rows.
          'CREATE INDEX `idx_subject_notes_scenario` ON `subject_notes` (`scenario`)',
        ],
      })
    );
  },
  (app) => {
    // Created by this migration and holding only staff notes; nothing else
    // reads it, so the down path drops it outright.
    try {
      app.delete(app.findCollectionByNameOrId('subject_notes'));
    } catch {
      // Already gone.
    }
  }
);
