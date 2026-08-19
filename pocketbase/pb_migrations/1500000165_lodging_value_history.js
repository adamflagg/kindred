/// <reference path="../pb_data/types.d.ts" />
/**
 * lodging_value_history — append-only capture of cabin-value changes.
 *
 * Dark on arrival for every reader. This migration creates one empty table and
 * moves nothing; no published value changes because of it, and the nine open
 * `ambiguous_session` rows in the lodging work queue (8 distinct households,
 * production snapshot 2026-08-18 22:11) stay exactly as they are.
 * The write hook in pocketbase/sync/lodging_value_history.go fills it going
 * forward. Deriving a weekend from these rows is a separate change.
 *
 * ── WHY: ONE SLOT, TWO WEEKENDS ─────────────────────────────────────────────
 *
 * `Family Camp Cabin` (cm_id 218072) is a HOUSEHOLD-grain custom field holding
 * exactly one value per household per YEAR — `family_camp_registrations` is
 * unique on (household, year). A household attending two family weekends
 * therefore has one slot for two answers: when staff type the second weekend's
 * cabin, the first weekend's is gone. The assignment ingest cannot tell which
 * weekend a string belongs to, so it files `ambiguous_session` rather than
 * guess (`sync/lodging_assignments_sync.go`, "flag, do not guess (spec 3.6)").
 *
 * Keeping what the source overwrites is what makes "which cabin was in effect
 * for THIS weekend" answerable from recorded observations instead of from a
 * timestamp heuristic that picks one weekend per observation and leaves the
 * other blank.
 *
 * ── WHY NOT lodging_assignment_history ──────────────────────────────────────
 *
 * It is already a per-change table and it cannot serve this. `ingestValue`
 * returns on `attr.Reason != attrSingleSession` BEFORE every `writeHistory`
 * call, so it is blind in exactly the ambiguous case that needs it, and its
 * organising key is `session` — the unknown. This table sits UPSTREAM of
 * attribution, which is why it has no session column at all.
 *
 * ── SHAPE: FOUR DELIBERATE DEPARTURES FROM attendee_status_history ──────────
 *
 * 1500000057_attendee_status_history.js is the existing lookback-table shape in
 * this codebase and this is modelled on it. It differs in four places, each on
 * purpose:
 *
 *   1. NO `session` COLUMN. It is `required: true` there. Here the session is
 *      the unknown the table exists to make derivable, so requiring one would
 *      beg the question. Session is derived on read.
 *
 *   2. old_value / new_value are `text`, NOT `select`. `attendee_status_history`
 *      can enumerate its statuses; there are 88 distinct hand-typed cabin
 *      strings for 218072 across all years. A select rejects the first
 *      unanticipated name and loses the change at the moment it matters.
 *      `lodging_assignment_history` already learned this and says so at
 *      `sync/lodging_assignments_sync.go`: "History records the OBSERVED label
 *      whether or not it resolved -- old_unit / new_unit are TEXT for exactly
 *      this reason."
 *
 *   3. DUAL CLOCK. `source_changed_at` is CampMinder's own `last_updated` for
 *      the value; `observed_at` is when this sync saw it. They are different
 *      facts and the retroactive-entry case needs both: 21 of 2025's household
 *      cabin values were last edited in December, after every 2025 weekend.
 *
 *   4. THE CREATE BRANCH WRITES TOO, as `is_genesis`. The first observed cabin
 *      is a fact worth keeping; `attendee_status_history` logs only
 *      transitions.
 *
 *      ⚠️ `is_genesis` MEANS "the first observation THIS TABLE HOLDS for this
 *      key", NOT "no earlier value existed". Do not read it as the latter. If
 *      CampMinder stops returning the field entry for a household, the orphan
 *      sweep deletes the `household_custom_values` row and no history is
 *      written; a later re-entry then arrives at the CREATE branch and is
 *      stamped `is_genesis` with an empty `old_value`, even though a different
 *      cabin really did precede it. A reader deriving a weekend's cabin must
 *      treat a genesis row as a floor on what is known, exactly as the backfill
 *      is a floor rather than a history.
 *
 * ── source_changed_at IS text, NOT date ─────────────────────────────────────
 *
 * The issue's shape sketch said `date`. The source column it copies is
 * `household_custom_values.last_updated` / `person_custom_values.last_updated`,
 * and BOTH are declared `type: "text"` (1500000029, and the person twin). It is
 * stored here verbatim, in the same type, for two reasons: a `date` field would
 * have to parse a CampMinder string, and a parse failure would reject the row
 * and LOSE the change — the same failure mode the text-not-select call above
 * avoids; and a value that does not round-trip identically to the source column
 * cannot be joined back to it. `observed_at` stays a real `date` because it is
 * our own clock and is always well-formed.
 *
 * ── RETENTION SCOPE: CABIN FIELDS ONLY ──────────────────────────────────────
 *
 * The write hook retains only `Family Camp Cabin` (218072, household) and
 * `Reportable Family Camp Cabin` (223823, person). The medical-adjacent lodging
 * fields — bathroom, CPAP, infant, opt-out — are held out NOT on the merits but
 * because `api/routers/lodging.py` records a deliberate ruling that that
 * surface has no access log and that one was removed on purpose; reversing that
 * as a side effect of a cabin-attribution change would be the wrong way to
 * reverse it. The scope lives in `lodgingRetainedHistoryFields` in
 * `sync/lodging_value_history.go`, so widening it later is a Go edit and needs
 * no migration.
 *
 * ── THE UNIQUE INDEX IS THE IDEMPOTENCY CONTRACT ────────────────────────────
 *
 * (year, field_cm_id, household_cm_id, person_cm_id, source_changed_at,
 * old_value, new_value) — re-running a sync re-observes the same change, and
 * the table is append-only, so without this a weekly sweep would stack
 * duplicates. The Go side checks for the row before inserting so a re-run is
 * quiet rather than a swallowed constraint error; the index is the guarantee
 * behind that check.
 *
 * `old_value` IS IN THE KEY, and dropping it would be a silent data-loss bug
 * rather than a tidier index. `source_changed_at` is empty whenever CampMinder
 * returns no `lastUpdated` (the transform only sets it when present and
 * non-empty), and without `old_value` the key then degenerates to
 * (year, field, household, person, '', new_value): a household whose cabin goes
 * A -> B -> A has its third, genuine observation matched against the first and
 * SILENTLY DROPPED, leaving B as the last recorded state. With `old_value` the
 * two are ('', A) and (B, A) and both survive. Latent today — every cabin row
 * in the production snapshot carries a `last_updated` — but the transform
 * explicitly anticipates the empty case, so the key does too.
 *
 * Exactly one of household_cm_id / person_cm_id is set per row, the other stays
 * 0 — which is what keeps two grains in one table without a nullable relation,
 * and why both are in the index rather than one nullable column.
 *
 * ── PocketBase v0.23 ────────────────────────────────────────────────────────
 *
 * Field properties are DIRECT. The wrapper object some older migrations used is
 * silently ignored in v0.23 and the field falls back to PocketBase's default
 * cap, so `old_value` / `new_value` would quietly become 5000-char fields
 * instead of the 500 declared below.
 */

// VERBATIM from the sibling history table (1500000057). Do not paraphrase —
// these rule strings are matched literally, and a plausible-looking alternative
// denies every request SILENTLY.
//
// Every rule on this collection is ADMIN_ONLY, reads included; see the create
// site below for why that is tighter than attendee_status_history on purpose.
const ADMIN_ONLY = '@request.auth.is_admin = true';

// Used for the skip guard and the down arm. The `name:` inside the
// `new Collection({...})` below is a LITERAL rather than this constant, and
// that is load-bearing: scripts/dev/verify-migration-history.sh's CHECK 2 finds
// the collections a migration CREATEs by regexing `name: "..."` out of the up
// arm, and a constant reads as no collection at all.
const HISTORY = 'lodging_value_history';

migrate(
  (app) => {
    // Idempotent create. A re-run is a no-op rather than a boot failure on
    // "Collection name must be unique"; this is not licence to accept whatever
    // shape is already present, only to make the second run quiet.
    let exists = false;
    try {
      app.findCollectionByNameOrId(HISTORY);
      exists = true;
    } catch {
      // Not present — create it below.
    }
    if (exists) {
      return;
    }

    app.save(
      new Collection({
        type: 'base',
        name: 'lodging_value_history',
        // ADMIN-ONLY READS, deliberately tighter than attendee_status_history.
        // This table stores `household_custom_values` / `person_custom_values`
        // values VERBATIM, and both of those source collections are
        // admin-only reads. Publishing a copy at authed-read would hand every
        // non-admin account cabin strings it cannot read from the source.
        //
        // The forward-looking half matters more than today's delta: the
        // retention scope is a Go map, so widening it needs no migration --
        // which means a later edit could copy admin-only, medical-adjacent
        // answers into this table with nobody re-reading this rule. Matching
        // the source tables now makes that safe by default.
        listRule: ADMIN_ONLY,
        viewRule: ADMIN_ONLY,
        // Written by the sync, never by the UI — same posture as
        // attendee_status_history.
        createRule: ADMIN_ONLY,
        updateRule: ADMIN_ONLY,
        deleteRule: ADMIN_ONLY,
        fields: [
          // CampMinder reuses ids across years — every data table carries the
          // year that disambiguates them.
          { type: 'number', name: 'year', required: true, presentable: false, min: 2010, max: 2100, onlyInt: true },
          // The custom field this observation is about (218072 / 223823).
          // Matching is on cm_id, never the user-editable display name.
          { type: 'number', name: 'field_cm_id', required: true, presentable: false, min: 1, max: null, onlyInt: true },
          // Exactly one of the two is set; the other stays 0. Neither is a
          // relation: cross-table relationships in this repo key on CampMinder
          // ids so they survive a resync that recreates a PocketBase row.
          { type: 'number', name: 'household_cm_id', required: false, presentable: false, min: 0, max: null, onlyInt: true },
          { type: 'number', name: 'person_cm_id', required: false, presentable: false, min: 0, max: null, onlyInt: true },
          // The display name, for humans reading a row. Documentation, not the
          // matching key — field_cm_id above is the contract.
          { type: 'text', name: 'source_field', required: false, presentable: false, min: 0, max: 200, pattern: '' },
          // Empty on a genesis row, and empty is also a legitimate NEW value
          // (staff clearing a cabin), which is why neither is required.
          { type: 'text', name: 'old_value', required: false, presentable: false, min: 0, max: 500, pattern: '' },
          { type: 'text', name: 'new_value', required: false, presentable: false, min: 0, max: 500, pattern: '' },
          // CampMinder's clock, verbatim and untyped — see the header.
          { type: 'text', name: 'source_changed_at', required: false, presentable: false, min: 0, max: 100, pattern: '' },
          // Our clock.
          { type: 'date', name: 'observed_at', required: false, presentable: false, min: '', max: '' },
          { type: 'bool', name: 'is_genesis', required: false, presentable: false },
          { type: 'autodate', name: 'created', required: false, presentable: false, onCreate: true, onUpdate: false },
        ],
        indexes: [
          'CREATE UNIQUE INDEX idx_lvh_observation ON lodging_value_history ' +
            '(year, field_cm_id, household_cm_id, person_cm_id, source_changed_at, ' +
            'old_value, new_value)',
          'CREATE INDEX idx_lvh_household_year ON lodging_value_history (household_cm_id, year)',
          'CREATE INDEX idx_lvh_person_year ON lodging_value_history (person_cm_id, year)',
        ],
      })
    );
  },
  (app) => {
    try {
      app.delete(app.findCollectionByNameOrId(HISTORY));
    } catch {
      // Already gone — nothing to undo.
    }
  }
);
