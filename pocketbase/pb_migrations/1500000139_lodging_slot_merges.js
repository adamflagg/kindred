/// <reference path="../pb_data/types.d.ts" />
/**
 * lodging_slot_merges — a scenario's override of a container's draw level.
 *
 * ABSENT ROW MEANS INHERIT. No row = take lodging_units.default_combined;
 * a row = an explicit true/false. The tri-state is load-bearing: "combined by
 * default, split in this scenario" and "no opinion" are different facts.
 * lodging_availability.family_available_override documents the same encoding,
 * including the alternative that was rejected there — a row meaning "the
 * opposite of the current default", which an ordinary registry edit silently
 * inverts (1500000135).
 *
 * SCENARIO IS A REQUIRED RELATION, NOT TEXT. That is what makes "the
 * CampMinder mirror is never overridable" a schema guarantee rather than a
 * convention, and its cascadeDelete means deleting a scenario takes its
 * overrides with it. 1500000132: "Scenario is a property of PLANNING, not of
 * record, and summer encodes exactly that by putting the column only on the
 * draft."
 *
 * unit.cascadeDelete IS TRUE, DELIBERATELY. The two precedents disagree —
 * lodging_availability.unit is true (1500000118), lodging_assignments.unit is
 * false (1500000119) — so this is a decision. A merge of a building that no
 * longer exists is meaningless, and unlike an assignment it records no human's
 * placement worth preserving. This matters more once lodging_units is
 * year-scoped and each (code, year) is its own row.
 *
 * session.cascadeDelete IS FALSE — the opposite call from unit, and also
 * deliberate. This is not the same fact as a deleted building: a camp_session
 * vanishing from one CampMinder response is an ingest anomaly (kindred#1879),
 * not a real deletion, and the correct failure mode is a 400 on the orphan
 * delete, not a silent sweep of its lodging rows. lodging_merges_draft.session
 * (1500000132:142-148) sets the same precedent on the sibling draft table.
 *
 * This is NOT a revival of the deleted lodging_merges (1500000134). That table
 * held the member set of an ad-hoc merge; member sets now live as `units` on
 * the placement (#1931) and still do. This only sets a DRAW LEVEL and validates
 * nothing.
 */

migrate(
  (app) => {
    // Idempotent: a filename-keyed skip must not attempt a second create.
    try {
      app.findCollectionByNameOrId('lodging_slot_merges');
      return;
    } catch {
      // Not present — create it below.
    }

    const units = app.findCollectionByNameOrId('lodging_units');
    const sessions = app.findCollectionByNameOrId('camp_sessions');
    const scenarios = app.findCollectionByNameOrId('saved_scenarios');

    // VERBATIM from 1500000132:69-71. Do not paraphrase — the permission is
    // read off `cached_permissions` as a dotted string, and the plausible
    // alternative (`@request.auth.permissions.bunking ?~ "manage"`) matches
    // nothing and denies every write SILENTLY. That failure mode has already
    // shipped once in this codebase.
    const AUTHED_READ = '@request.auth.id != ""';
    const BUNKING_MANAGE =
      '@request.auth.is_admin = true || @request.auth.cached_permissions ~ "bunking.manage"';

    const col = new Collection({
      type: 'base',
      name: 'lodging_slot_merges',
      listRule: AUTHED_READ,
      viewRule: AUTHED_READ,
      createRule: BUNKING_MANAGE,
      updateRule: BUNKING_MANAGE,
      deleteRule: BUNKING_MANAGE,
      fields: [
        {
          type: 'relation', name: 'unit', required: true, presentable: false,
          collectionId: units.id, cascadeDelete: true, minSelect: null, maxSelect: 1,
        },
        // cascadeDelete false, and `session` required, for kindred#1879: a
        // camp_session vanishing from one CampMinder response must fail the
        // orphan delete with a 400 rather than silently taking its lodging
        // rows. Matches lodging_merges_draft.session (1500000132:142-148); do
        // not "fix" this to true.
        {
          type: 'relation', name: 'session', required: true, presentable: false,
          collectionId: sessions.id, cascadeDelete: false, minSelect: null, maxSelect: 1,
        },
        // Every sibling lodging table carries session_cm_id alongside the
        // relation (1500000132:149,193; lodging_availability's
        // set_availability service writes it explicitly) — the CampMinder
        // identity travels beside the PocketBase relation, not in place of it.
        // Not part of the unique index: it's identity, not key.
        { type: 'number', name: 'session_cm_id', required: true, presentable: false, min: 1, max: null, onlyInt: true },
        // CampMinder reuses session ids across years — every data table carries
        // the year that disambiguates them.
        { type: 'number', name: 'year', required: true, presentable: false, min: 2010, max: 2100, onlyInt: true },
        {
          type: 'relation', name: 'scenario', required: true, presentable: false,
          collectionId: scenarios.id, cascadeDelete: true, minSelect: null, maxSelect: 1,
        },
        { type: 'bool', name: 'combined', required: false, presentable: false },
      ],
      indexes: [
        'CREATE UNIQUE INDEX `idx_lodging_slot_merge_unique` ON `lodging_slot_merges` (`unit`, `session`, `year`, `scenario`)',
      ],
    });
    app.save(col);
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId('lodging_slot_merges'));
    } catch {
      // Already absent.
    }
  }
);
