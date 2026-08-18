/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: person_custom_values.person cascades instead of blanking.
 *
 * kindred#2394, part (b). Part (a) is the fix -- persons.go now tracks a
 * staff-only person as processed, so the nightly sweep stops nominating 26
 * people it deliberately fetched. This migration is defence in depth: it makes
 * a GENUINELY correct orphan delete behave properly instead of erroring.
 *
 * What went wrong. `person` is declared cascadeDelete: false
 * (1500000028_person_custom_values.js), so deleting a person does not delete
 * their custom values -- PocketBase CLEARS the relation and re-saves the rows.
 * Those rows are covered by
 *
 *   CREATE UNIQUE INDEX idx_person_cf_vals_unique
 *     ON person_custom_values (year, person, field_definition)
 *
 * so the moment a SECOND person's rows are blanked for the same
 * (year, field_definition), the blanked rows collide on ('', year, def) and the
 * re-save is rejected. That rejection aborts the parent delete and surfaces as
 * `field_definition: Value must be unique; person: Value must be unique; year:
 * Value must be unique.` on a DELETE, which is not an error a DELETE should
 * ever produce.
 *
 * A custom-field value is meaningless without the person it describes, so
 * cascading is the honest answer here: the row goes with its person rather than
 * surviving as an answer belonging to nobody.
 *
 * ⛔ The 152 rows already blanked in production are LEFT IN PLACE, deliberately.
 * This table has no person_id column -- only the `person` relation -- so once
 * blanked there is no surviving pointer to who the answer belonged to and they
 * cannot be re-linked. Deleting them is the only other option, and this repo
 * does not run destructive data migrations. They stay as inert residue.
 * (Production snapshot: 152 rows, 116 in year 2023 and 36 in 2026.)
 *
 * ⛔ Only this relation is changed. Five other relations to `persons` also sit
 * inside a unique index and would also collide when blanked --
 * staff (year, person), financial_aid_applications (person, year),
 * bunk_assignments (year, person, session),
 * bunk_assignments_draft (year, session, person, scenario) and
 * normalized_mappings (person, session, category). They are NOT flipped, for
 * two reasons. First, deleting a staff record or a financial-aid application
 * because a person row went away is a product decision nobody has made, and it
 * is a very different proposition from deleting a custom-field answer -- the
 * issue says so explicitly. Second, their collision is currently the only thing
 * that makes such a delete fail loudly; converting that into a silent severed
 * row would be a downgrade, not a hardening. person_custom_values is the one
 * collection that both fails today and has an unambiguous answer.
 *
 * Idempotent: setting cascadeDelete to a value it already holds is a no-op, so
 * a re-run (see the renumbering trap in docs/reference/pocketbase-migrations.md)
 * converges rather than diverging. No guard, though: a missing `person` relation
 * is the one state this migration must not shrug at, since clearing that field's
 * blanking behaviour is its whole purpose.
 */

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('person_custom_values');

    const rel = col.fields.getByName('person');
    if (!rel) {
      throw new Error('person_custom_values: expected an existing "person" relation field');
    }
    rel.cascadeDelete = true;

    app.save(col);
  },
  (app) => {
    const col = app.findCollectionByNameOrId('person_custom_values');

    const rel = col.fields.getByName('person');
    if (!rel) {
      throw new Error('person_custom_values: expected an existing "person" relation field');
    }
    rel.cascadeDelete = false;

    app.save(col);
  }
);
