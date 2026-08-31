/// <reference path="../pb_data/types.d.ts" />
/**
 * lodging_ingest_issues.confirmed_session_cm_id — the weekend a human picked.
 *
 * ── WHY THE COLUMN IS MISSING TODAY ─────────────────────────────────────────
 *
 * CampMinder holds ONE cabin value per household per year ("Family Camp Cabin",
 * cm_id 218072, household grain) and cannot express WHICH weekend it describes.
 * `lodging_assignments` is keyed (session_cm_id, year, household_cm_id), so for
 * a household booked on two weekends there is no key to write — and the sync
 * writes NO ROW at all. "Unassigned" on the board is row-ABSENT, not a blank
 * column. Families on one family weekend land; families on two do not.
 *
 * `AttributeSession` (sync/lodging_session_attribution.go) already flags those
 * households as `ambiguous_session` and already offers an advisory
 * `suggested_session`. What the queue row could not hold was the ANSWER: a
 * resolution UI built without this column would offer staff a button with
 * nowhere to write. This is that place.
 *
 * ── NOTHING PLACES ITSELF ───────────────────────────────────────────────────
 *
 * Owner ruling, 2026-08-31. No auto-apply and no history-based inference: every
 * ambiguous case stays a suggestion a human confirms, and `suggested_session`
 * stays advisory. Confirming DOES set the board row — but only through the real
 * transform path (`LodgingAssignmentsSync.ingestValue`), never as a write-in.
 *
 * Nothing here is ever written back to CampMinder (ruling kindred#1968).
 *
 * ── A CAMPMINDER ID, NOT A RELATION ─────────────────────────────────────────
 *
 * `suggested_session` beside it is a relation, and that is right for an
 * advisory pointer nothing keys on. This one is compared, twice, against values
 * that are CampMinder ids: `candidate_session_cm_ids` on this same row, and
 * `lodging_assignments.session_cm_id` on the row a confirmation produces. A
 * relation would need a join before either comparison and would carry a
 * PocketBase id that is scoped to one season — while camp_sessions is unique on
 * (cm_id, year) precisely so the CampMinder id can cross years. It also matches
 * the project-wide rule that cross-table relationships use CampMinder ids.
 *
 * ── 0 MEANS UNCONFIRMED ─────────────────────────────────────────────────────
 *
 * PocketBase has no per-field default and an unset number stores as 0, which is
 * not a CampMinder id, so absence needs no second spelling. Every reader gates
 * on `> 0`.
 *
 * ── THE STORED NUMBER IS NEVER TRUSTED ON ITS OWN ───────────────────────────
 *
 * Nothing constrains this column to a session the party actually attends — no
 * foreign key could, since the constraint is enrollment, not existence. The
 * write path resolves it against the party's own candidate weekends and refuses
 * a miss. That is not defensive style: `Attribution.SessionCMID()` resolves the
 * id by scanning Candidates and returns 0 for a non-member, and
 * `lodging_assignments.session_cm_id` is REQUIRED (migration 1500000124), so a
 * non-candidate would fail inside `upsertAssignment` rather than place
 * anything. It is also what keeps the write key inside the orphan key: the
 * candidate slice IS the session index `deleteLodgingOrphans` reads, so a
 * confirmed placement can never be swept by the same run that wrote it
 * (kindred#2626/#2641 is the measured failure of that class).
 *
 * ── NO INDEX ────────────────────────────────────────────────────────────────
 *
 * The two readers both scan a single year's open queue — order tens of rows in
 * production, against a table that has never exceeded a few hundred. An index
 * on a column that is 0 on almost every row would cost writes to save nothing.
 * `idx_lodging_issues_dedup` is untouched: the confirmation is an ANSWER to a
 * queue item, not part of the item's identity, and folding it into the dedup
 * key would make one confirmed household look like two problems.
 *
 * PocketBase v0.23 syntax: fields.add(new Field({...})) on an existing
 * collection, properties DIRECT rather than inside options{} — an options
 * wrapper is ignored without error. addField() is a no-op when the column
 * already exists, because PocketBase records an applied migration by FILENAME:
 * a later edit to this file would never re-run on a database that has already
 * seen it, and `Set` on a missing column is a silent no-op that never persists.
 */

/**
 * Adds a field unless the collection already has one by that name.
 * @param {core.Collection} collection
 * @param {core.Field} field
 */
function addField(collection, field) {
  if (!collection.fields.getByName(field.name)) {
    collection.fields.add(field);
  }
}

migrate((app) => {
  const collection = app.findCollectionByNameOrId("lodging_ingest_issues");
  addField(collection, new Field({
    type: "number",
    name: "confirmed_session_cm_id",
    required: false,
    presentable: false,
    min: null,
    max: null,
    onlyInt: true
  }));
  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("lodging_ingest_issues");
  collection.fields.removeByName("confirmed_session_cm_id");
  app.save(collection);
});
