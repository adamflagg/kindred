/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: bunk_assignments_draft.person cascades.
 *
 *   bunk_assignments_draft.person -> persons   (UNIQUE year, session, person, scenario)
 *
 * Owner ruling, 2026-10-29: "if someone moves from enrolled to another status? we can kill their
 * draft placements." A camper who leaves CampMinder altogether is the far end of that: when the
 * persons sweep deletes them, their scenario placements go in the same transaction.
 *
 * It is the class 1500000254 fixed for normalized_mappings, and 1500000254 left this relation
 * alone only because cascading a scenario placement was an owner call. With cascadeDelete: false,
 * deleting a camper BLANKS each of their drafts to (year, session, '', scenario). Two campers
 * placed in one scenario who both leave then blank to the same key, the unique index rejects the
 * second re-save, and the second person's DELETE fails -- the same red persons season pass the
 * 10-29 nightly showed. A blanked draft is no use to anyone either: it names no camper.
 *
 * stranded_assignment_cleanup now deletes the drafts of a camper still in CampMinder but no longer
 * enrolled in that session (the same ruling), so the two paths agree: a draft lives only while its
 * camper is enrolled.
 *
 * Left alone, each in blankingUniqueRelationsReviewed (pocketbase/sync/sweep_delete_unique_blank_test.go):
 *  - bunk_assignments_draft.session: every draft carries a scenario, saved_scenarios.session is
 *    required, and a session that still has a scenario cannot be deleted, so it never blanks.
 *  - person_custom_values.field_definition and household_custom_values.field_definition: owner
 *    ruling the same day, "save the custom field history".
 *
 * lodging_assignments_draft needs no twin: it names its party by household_cm_id / person_cm_id
 * NUMBER fields, not relations, so a person or household delete blanks nothing on it.
 *
 * No rows are touched. Drafts already blanked stay as they are; this repo does not run
 * destructive data migrations.
 *
 * Idempotent: setting cascadeDelete to a value it already holds is a no-op. A missing field
 * throws rather than shrugging, as 1500000254 does, since changing it is this migration's purpose.
 */

function setCascade(app, cascade) {
  const col = app.findCollectionByNameOrId('bunk_assignments_draft');
  const rel = col.fields.getByName('person');
  if (!rel) {
    throw new Error('bunk_assignments_draft: expected an existing "person" relation field');
  }
  rel.cascadeDelete = cascade;
  app.save(col);
}

migrate(
  (app) => {
    setCascade(app, true);
  },
  (app) => {
    setCascade(app, false);
  }
);
