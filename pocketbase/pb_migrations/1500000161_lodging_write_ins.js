/// <reference path="../pb_data/types.d.ts" />
/**
 * lodging_write_ins + lodging_write_ins_draft — write-in OCCUPANCY, split out
 * of lodging_availability and given a scenario dimension.
 *
 * Dark on arrival. This migration creates two empty tables and moves NOTHING.
 * No reader is switched, no row is copied, and `lodging_availability` is not
 * touched. kindred#2382 is PR 1 of 4; the backfill, the readers and the
 * frontend follow, and until they land the application behaves exactly as it
 * did before.
 *
 * ── WHY THIS EXISTS: ONE BOOLEAN, TWO QUESTIONS ─────────────────────────────
 *
 * `lodging_availability.family_available` answers two unrelated questions:
 *
 *   true  on a staff_default unit -> a staff cabin OPENED to families for this
 *                                    weekend. A ROLE override. Names no
 *                                    occupant.
 *   false                         -> somebody is in the room. An OCCUPANCY.
 *                                    The write-in.
 *   no row                        -> the unit's own role decides. ROLE again.
 *
 * Owner ruling, 2026-08-15 (kindred#2382):
 *
 *   "staff vs family_available is not scenario scoped, no, that's more of a
 *    known 'were moving staff to X for weekend Y'"
 *
 * and, separately, that a write-in must be scenario-scoped, because not every
 * write-in is non-rostered staff — some are paper registrations for families
 * arriving with no children, which are a MODELLING choice and belong to the
 * scenario that made them.
 *
 * So the two halves scope differently and the fix is a SPLIT, not a twin of
 * the conflated table: `lodging_availability` keeps ONLY the staff<->family
 * role override, session-scoped and global, and occupancy moves here.
 *
 * ── THIS REVERSES 1500000135'S DECLINED TWIN, ON NEW EVIDENCE ───────────────
 *
 * 1500000135 deleted `lodging_availability.scenario` and named the twin it was
 * declining to build:
 *
 *   "Availability is a fact about the WEEKEND, not about the plan: a burst
 *    pipe closes a cabin in every scenario for that weekend, so there is
 *    nothing for a scenario to disagree about. The overlay therefore
 *    disappears by deleting one of its two layers rather than by growing a
 *    `lodging_availability_draft` twin."
 *
 * That reasoning was CORRECT and still is — for availability. It is exactly
 * why `lodging_availability` keeps its no-scenario shape here and is left
 * alone. What changed is what the table STORES: kindred#2228 turned it into
 * the named-global-occupant store and 1500000148 moved the historical notes
 * into `occupant_name`. A write-in is not a burst pipe, so "there is nothing
 * for a scenario to disagree about" stopped being true for the occupancy half
 * of the column.
 *
 * This is therefore not a revert. 1500000135's call is untouched on the facts
 * it was made about; a different fact, which arrived after it, is being given
 * a home of its own on the owner ruling above.
 *
 * ⛔ A NULLABLE `scenario` SENTINEL WAS EXPLICITLY REJECTED. The live+draft
 * pair below is this repository's established pattern, and the reason is
 * recorded verbatim in api/services/lodging_repository.py: lodging_assignments
 * dropped its scenario column because it "was dead weight that invited a
 * `scenario != ''` write rule instead of a draft table." The live board is a
 * scope in its own right, not the absence of one.
 *
 * ── SHAPE ───────────────────────────────────────────────────────────────────
 *
 * The occupancy fields mirror `lodging_availability`'s live schema exactly —
 * unit, session, session_cm_id, year, occupant_name, note — so the PR 2
 * backfill is a straight copy with no per-column judgement to make. The draft
 * adds `scenario`, declared the way lodging_assignments_draft declares it
 * (required, cascadeDelete true, into saved_scenarios), which is what makes
 * "the live board is never overridable by a scenario" a schema guarantee and
 * makes deleting a scenario take its write-ins with it.
 *
 * `occupant_name` is NOT required, mirroring 1500000148's own call on the
 * column it copies from. All 21 rows in production carry one today, so a
 * required field would in fact accept the backfill — but tightening it here
 * would make this migration diverge from the source column it is supposed to
 * mirror, and the API is already the tighter of the two (it caps the field it
 * accepts at 500, a UI-side judgement about a name).
 *
 * `session.cascadeDelete` is FALSE and `unit.cascadeDelete` is TRUE, matching
 * lodging_availability's live schema and lodging_slot_merges' explicit
 * reasoning: a camp_session vanishing from one CampMinder response is an
 * ingest anomaly (kindred#1879) whose correct failure mode is a 400 on the
 * orphan delete, while a write-in against a building that no longer exists is
 * meaningless.
 *
 * ONE ROW PER (unit, weekend) — and per scenario on the draft. The unique
 * index mirrors `idx_lodging_avail_unique`, so the arity is unchanged from
 * what the application enforces today. Whether a container should be able to
 * hold N write-ins is kindred#2381, which does NOT dissolve into this change:
 * the single-cover arity lives in four type signatures a storage change does
 * not touch. Do not widen the index here on its behalf.
 *
 * PocketBase v0.23 syntax: field properties are DIRECT, never nested inside
 * an `options` wrapper object, which is silently ignored.
 *
 * (Spelling it that way round is deliberate. scripts/pre-push-verify.sh greps
 * changed migrations for the literal wrapper and filters only full-line `//`
 * comments, so a JSDoc block quoting it fails the check -- 1500000135's header
 * carries the same sentence and would too, if that file were ever in a diff.)
 */

// VERBATIM from 1500000139:66-71, which took them verbatim from 1500000132.
// Do not paraphrase — the permission is read off `cached_permissions` as a
// dotted string, and the plausible alternative
// (`@request.auth.permissions.bunking ?~ "manage"`) matches nothing and denies
// every write SILENTLY. That failure mode has already shipped once here.
const AUTHED_READ = '@request.auth.id != ""';
const BUNKING_MANAGE =
  '@request.auth.is_admin = true || @request.auth.cached_permissions ~ "bunking.manage"';

const LIVE = 'lodging_write_ins';
const DRAFT = 'lodging_write_ins_draft';

/**
 * The occupancy fields, mirrored from lodging_availability's live schema.
 *
 * Built per call rather than shared as one array literal: PocketBase mutates
 * the field objects it is handed (stamping ids), so two collections built from
 * one literal would collide.
 */
function occupancyFields(unitsCol, sessionsCol) {
  return [
    {
      type: 'relation', name: 'unit', required: true, presentable: false,
      collectionId: unitsCol.id, cascadeDelete: true, minSelect: null, maxSelect: 1,
    },
    {
      type: 'relation', name: 'session', required: true, presentable: false,
      collectionId: sessionsCol.id, cascadeDelete: false, minSelect: null, maxSelect: 1,
    },
    // The CampMinder identity travels BESIDE the PocketBase relation, not in
    // place of it, and it is what the unique index below keys on
    // (kindred#2042 / 1500000147 re-keyed every sibling lodging index the same
    // way): a camp_sessions row recreated rather than updated gets a new
    // PocketBase id, and rows keyed on the old one become unreachable.
    { type: 'number', name: 'session_cm_id', required: true, presentable: false, min: 1, max: null, onlyInt: true },
    // CampMinder reuses session ids across years — every data table carries
    // the year that disambiguates them.
    { type: 'number', name: 'year', required: true, presentable: false, min: 2010, max: 2100, onlyInt: true },
    // max 2000 mirrors lodging_availability.occupant_name (1500000148), which
    // in turn mirrors `note` (1500000118), so a PR 2 copy cannot be rejected
    // for length by any value the source column could hold.
    { type: 'text', name: 'occupant_name', required: false, presentable: false, min: 0, max: 2000, pattern: '' },
    { type: 'text', name: 'note', required: false, presentable: false, min: 0, max: 2000, pattern: '' },
    { type: 'autodate', name: 'created', required: false, presentable: false, onCreate: true, onUpdate: false },
    { type: 'autodate', name: 'updated', required: false, presentable: false, onCreate: true, onUpdate: true },
  ];
}

migrate(
  (app) => {
    const units = app.findCollectionByNameOrId('lodging_units');
    const sessions = app.findCollectionByNameOrId('camp_sessions');
    const scenarios = app.findCollectionByNameOrId('saved_scenarios');

    // Idempotent per collection, and checked per collection rather than once
    // for the pair: a filename-keyed skip must not attempt a second create,
    // and a half-applied run must still be able to finish. An idempotent
    // CREATE is the one shape docs/reference/pocketbase-migrations.md warns
    // against as a FIX for a renumbered migration — used here only to make a
    // re-run a no-op, not to accept whatever shape is already present.
    let liveExists = false;
    try {
      app.findCollectionByNameOrId(LIVE);
      liveExists = true;
    } catch {
      // Not present — create it below.
    }
    if (!liveExists) {
      app.save(
        new Collection({
          type: 'base',
          name: LIVE,
          listRule: AUTHED_READ,
          viewRule: AUTHED_READ,
          createRule: BUNKING_MANAGE,
          updateRule: BUNKING_MANAGE,
          deleteRule: BUNKING_MANAGE,
          fields: occupancyFields(units, sessions),
          indexes: [
            'CREATE INDEX `idx_lodging_write_in_unit` ON `lodging_write_ins` (`unit`)',
            'CREATE INDEX `idx_lodging_write_in_session_year` ON `lodging_write_ins` (`session_cm_id`, `year`)',
            // At most one write-in per unit per weekend, mirroring
            // idx_lodging_avail_unique. Without it a unit could carry two
            // contradicting rows and "who is in this cabin?" would stop being
            // a question with an answer.
            'CREATE UNIQUE INDEX `idx_lodging_write_in_unique` ON `lodging_write_ins` (`session_cm_id`, `year`, `unit`)',
          ],
        })
      );
    }

    let draftExists = false;
    try {
      app.findCollectionByNameOrId(DRAFT);
      draftExists = true;
    } catch {
      // Not present — create it below.
    }
    if (!draftExists) {
      const draftFields = occupancyFields(units, sessions);
      // SCENARIO IS A REQUIRED RELATION, NOT TEXT — declared exactly as
      // lodging_assignments_draft declares it. 1500000132: "Scenario is a
      // property of PLANNING, not of record, and summer encodes exactly that
      // by putting the column only on the draft." cascadeDelete means deleting
      // a scenario takes its write-ins with it, which is the correct answer to
      // kindred#2382's scenario-delete knock-on.
      draftFields.push({
        type: 'relation', name: 'scenario', required: true, presentable: false,
        collectionId: scenarios.id, cascadeDelete: true, minSelect: null, maxSelect: 1,
      });
      app.save(
        new Collection({
          type: 'base',
          name: DRAFT,
          listRule: AUTHED_READ,
          viewRule: AUTHED_READ,
          createRule: BUNKING_MANAGE,
          updateRule: BUNKING_MANAGE,
          deleteRule: BUNKING_MANAGE,
          fields: draftFields,
          indexes: [
            'CREATE INDEX `idx_lodging_write_in_draft_unit` ON `lodging_write_ins_draft` (`unit`)',
            'CREATE INDEX `idx_lodging_write_in_draft_scenario` ON `lodging_write_ins_draft` (`scenario`)',
            'CREATE INDEX `idx_lodging_write_in_draft_session_year` ON `lodging_write_ins_draft` (`session_cm_id`, `year`)',
            // The live key plus the scenario, matching how
            // lodging_assignments_draft keys its own uniqueness: two scenarios
            // may hold contradicting write-ins for one unit without colliding.
            'CREATE UNIQUE INDEX `idx_lodging_write_in_draft_unique` ON `lodging_write_ins_draft` (`session_cm_id`, `year`, `unit`, `scenario`)',
          ],
        })
      );
    }
  },
  (app) => {
    // Safe to drop outright: this migration creates the tables empty and
    // copies nothing into them, so a down path taken before PR 2's backfill
    // discards nothing. Once that backfill exists, ITS down path is what
    // restores the rows to lodging_availability — this one must not try to,
    // because it has no idea where they came from.
    for (const name of [DRAFT, LIVE]) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch {
        // Already absent.
      }
    }
  }
);
