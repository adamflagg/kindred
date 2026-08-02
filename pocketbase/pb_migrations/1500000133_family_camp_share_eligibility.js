/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: family_camp_registrations share eligibility
 *
 * Adds the verdict the lodging board places on, replacing a rule that read the
 * WRONG FIELD.
 *
 * Share intent lives in TWO CampMinder fields, asked at different times:
 *
 *   FAM CAMP-Share Cabins  (240877, single-select)  registration, early
 *   FAM CAMP-Shared Cabin  (263379, MULTI-select)   Family Camp info form, later
 *
 * Staff treat the later form as authoritative (stated 2026-08-02). The board
 * was flagging on share_cabin_gate, which is derived from the REGISTRATION
 * field alone -- NormalizeShareGate requires a leading no/maybe/yes token and
 * none of the later form's option sentences have one, so that column is 100%
 * registration and always has been.
 *
 * Measured on 2026 family-camp attendees, the old rule was wrong BOTH ways:
 *
 *   - 3 households said no at registration, then named a partner on the form.
 *     Legitimately placed; the board flagged them.
 *   - 12 said yes at registration then declined on the form, plus 39 more from
 *     maybe_mutual. The board was SILENT and handed staff a clean card. This is
 *     the dangerous direction and it is ~10x the first.
 *
 * WHY THREE COLUMNS RATHER THAN ONE
 *
 * share_eligibility is the verdict. share_eligibility_source records whether it
 * came from the form or fell back to registration, because a fallback verdict
 * is PROVISIONAL and the surface should say so. share_answers_conflict marks a
 * hard contradiction between the two forms, which staff review -- it is not
 * derivable downstream, because the raw modes column is deliberately not
 * exposed to the API and re-parsing it in a consumer is what the one-writer
 * rule exists to prevent.
 *
 * share_cabin_gate is UNCHANGED and stays. It is the registration answer, it is
 * what a staff member sees when asked why a household is flagged, and it is the
 * fallback input. Nothing that reads it needs to change.
 *
 * "unknown" is NOT a default of open, and it is a separate value from
 * "declined" on purpose: they place identically and mean different things, so
 * merging them would report "this family said no" about a family that answered
 * nothing. partyAttention already draws this line between "unverified" and
 * "unmet"; HANDOFF section 6 makes it a rule.
 *
 * These are SELECT fields, not text. The select list is the constraint -- a Go
 * constant alone passes tests and fails in production (HANDOFF section 6).
 *
 * BACKFILL: none here, deliberately. These columns are written by
 * family_camp_derived, which must be re-run per year to populate them. A
 * migration cannot compute them: the inputs are person-partition custom values
 * that need the collapse. Until the sync runs the columns are empty, and empty
 * reads as "unknown" -- which is the safe direction, since unknown never
 * consents.
 *
 * PocketBase v0.23 syntax: fields.add(new Field({...})) on an existing
 * collection, properties DIRECT rather than inside options{}. A bare
 * add({...}) silently does nothing. addField() is a no-op when the column
 * exists, because PB records an applied migration by FILENAME -- a later edit
 * to this file would never re-run, and `Set` on a missing column is a silent
 * no-op that simply never persists.
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
  const regs = app.findCollectionByNameOrId("family_camp_registrations");

  addField(regs, new Field({
    type: "select", name: "share_eligibility", required: false, presentable: false,
    values: ["open", "named", "declined", "unknown"], maxSelect: 1
  }));

  addField(regs, new Field({
    type: "select", name: "share_eligibility_source", required: false, presentable: false,
    values: ["form", "registration", "none"], maxSelect: 1
  }));

  addField(regs, new Field({
    type: "bool", name: "share_answers_conflict", required: false, presentable: false
  }));

  app.save(regs);
}, (app) => {
  const regs = app.findCollectionByNameOrId("family_camp_registrations");
  regs.fields.removeByName("share_eligibility");
  regs.fields.removeByName("share_eligibility_source");
  regs.fields.removeByName("share_answers_conflict");
  app.save(regs);
});
