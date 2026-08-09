/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: lodging_session_status — the staff-owned "this weekend is
 * cancelled" flag. Resolves kindred#2092.
 *
 * WHY A TABLE AND NOT A DERIVED RULE
 *
 * CampMinder has no field to derive this from. Its Sessions API exposes twenty
 * properties and none of them is a status or a registration-availability
 * concept, so no sync field can supply the answer. Two derived rules were
 * proposed, measured against a production snapshot, and retracted:
 *
 *   - "attendee rows exist but none are enrolled" fires on one owner-confirmed
 *     cancelled weekend and NOT on another, because a weekend cancelled before
 *     anyone registered carries zero attendee rows and is byte-identical to a
 *     weekend that has not opened yet. 2021's seven cancelled family weekends
 *     all look exactly like that.
 *   - `is_active` is a straight passthrough of CampMinder's own field
 *     (sync/sessions.go), not a derivation. Across 433 sessions it measures 25%
 *     precise and 6.4% recall for "cancelled".
 *
 * So this is STAFF-OWNED DATA WITH NO SYNC SOURCE. Nothing in pocketbase/sync
 * may write it or clear it, which is pinned by
 * sync/lodging_session_status_test.go.
 *
 * WHY NOT A COLUMN ON camp_sessions
 *
 * SessionsSync marks every session CampMinder returned and then deletes the
 * local rows it did not see (`DeleteOrphans`, sync/base_sync.go). A cancelled
 * weekend is precisely the one CampMinder may stop returning, so a column on
 * that row would be deleted by the event it exists to record.
 *
 * WHY NO `session` RELATION EITHER, unlike the neighbouring lodging tables
 *
 * lodging_availability / lodging_assignments / lodging_assignments_draft each
 * carry BOTH a `session` relation and a `session_cm_id`, and 1500000124 set
 * their relation to cascadeDelete:false so a vanishing session raises an error
 * instead of silently taking placements with it. That trade was right for rows
 * that represent work nobody can reconstruct. It is wrong here: a required
 * relation with cascadeDelete:false makes PocketBase REFUSE the orphan delete,
 * so every subsequent sync would log a failure for the one weekend this table
 * is about. (`DeleteOrphans` counts the error and continues — it does not abort
 * the sync — so the cost is a permanent error line, not a broken sync.) The
 * general rule in CLAUDE.md section 1 is also the right one here: cross-table
 * relationships use CampMinder ids. `session_cm_id` is the whole key, and the
 * API callers already hold it.
 *
 * WHY `year` IS REQUIRED
 *
 * CampMinder REUSES session ids across years — camp_sessions is unique on
 * (cm_id, year) for exactly that reason — so `session_cm_id` alone would let a
 * 2026 cancellation silently cancel the 2027 weekend that inherited the id.
 * The key is the PAIR, and the unique index says so.
 *
 * NO SEED, DELIBERATELY. ABSENCE OF A ROW MEANS ACTIVE. Backfilling "active"
 * rows for every existing weekend would write a second spelling of a state the
 * empty table already expresses, and would need re-running for every season.
 *
 * `active` is nevertheless IN THE VOCABULARY. Two values now (owner decision,
 * 2026-08-07) so that widening later — "closed for registration", say — is a
 * value addition rather than a bool-to-select type migration, and so a row read
 * out of the PocketBase admin UI says what it means instead of "existing = bad".
 * The writer still DELETES rather than storing `active`
 * (`setWeekendSessionStatus`, frontend/src/services/lodgingCrud.ts), which is
 * the same shape `lodging_availability` uses for "clear the override": there is
 * no value meaning "normal", because absence already means it. A hand-written
 * `active` row is read as active by api/services/lodging_roster_service.py, so
 * the two spellings can never disagree even if one is created by hand.
 *
 * RULES match 1500000130's staff-writable set exactly — reads open to any
 * authenticated user, writes gated on admin OR `bunking.manage`. That list is
 * frozen (the migration already ran), so the rule is restated here rather than
 * added to it. Cancelling a weekend is bunking-staff work, done on the same
 * /manage/lodging screen as the registry and the season roll-forward.
 */

const LODGING_AUTHED_READ = '@request.auth.id != ""'
const LODGING_BUNKING_MANAGE =
  '@request.auth.is_admin = true || @request.auth.cached_permissions ~ "bunking.manage"'

migrate(
  (app) => {
    const collection = new Collection({
      type: "base",
      name: "lodging_session_status",
      listRule: LODGING_AUTHED_READ,
      viewRule: LODGING_AUTHED_READ,
      createRule: LODGING_BUNKING_MANAGE,
      updateRule: LODGING_BUNKING_MANAGE,
      deleteRule: LODGING_BUNKING_MANAGE,
      fields: [
        {
          type: "number",
          name: "session_cm_id",
          required: true,
          presentable: false,
          min: 1,
          max: null,
          onlyInt: true,
        },
        {
          type: "number",
          name: "year",
          required: true,
          presentable: false,
          min: 2010,
          max: 2100,
          onlyInt: true,
        },
        {
          type: "select",
          name: "status",
          required: true,
          presentable: true,
          values: ["active", "cancelled"],
          maxSelect: 1,
        },
        // There is deliberately NO `note` column. A reason-for-cancelling was
        // considered and dropped: nothing reads it, no surface asks for it, and
        // an unwritten column is indistinguishable from a column whose writer
        // was forgotten. Add it in the PR that adds the field that shows it.
        { type: "autodate", name: "created", required: false, presentable: false, onCreate: true, onUpdate: false },
        { type: "autodate", name: "updated", required: false, presentable: false, onCreate: true, onUpdate: true },
      ],
      indexes: [
        // The key is the PAIR. One status per weekend per season, so a second
        // row cannot make "is this weekend cancelled?" non-deterministic.
        "CREATE UNIQUE INDEX `idx_lodging_session_status_key` ON `lodging_session_status` (`session_cm_id`, `year`)",
        // The season read (`year = N`) cannot use the unique index above,
        // whose leading column is session_cm_id.
        "CREATE INDEX `idx_lodging_session_status_year` ON `lodging_session_status` (`year`)",
      ],
    })
    app.save(collection)
  },
  (app) => {
    // Safe to drop outright, unlike 1500000141's one-way down migration: this
    // collection has no seed and no sync source, so everything in it was typed
    // by a staff member on the /manage/lodging screen and reverting the feature
    // is reverting the only thing that writes it.
    app.delete(app.findCollectionByNameOrId("lodging_session_status"))
  }
)
