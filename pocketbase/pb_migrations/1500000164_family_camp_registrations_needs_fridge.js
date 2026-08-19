/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: add `needs_fridge` to family_camp_registrations. kindred#2224.
 *
 * ONE ADDITIVE BOOLEAN. The row grain is unchanged and stays (household, year).
 *
 * WHY IT EXISTS. `needs_accommodation` is a GATE question, not a need:
 * CampMinder asks a plain Yes/No and the substance of the request lands in a
 * separate free-text field the product never read. The board could therefore
 * match a family to a cabin on exactly two axes -- private bathroom and power
 * -- while the registry carried columns that answer several more.
 *
 * Measured on the production snapshot, 2026: 42 of 464 registration rows carry
 * `needs_accommodation`, and 6 of those households name a refrigerator in the
 * narrative, against 12 of 118 units carrying `has_fridge` (4 of which also
 * carry `has_shared_fridge`, and 0 carry shared without the parent). 2026 is
 * only 16% placed, so 6 is the SHAPE of the demand, not a rate.
 *
 * WHAT THIS COLUMN IS NOT: the narrative. It is a DERIVED BOOLEAN, and that is
 * the whole split migration 1500000126 drew -- family_camp_medical is
 * admin-gated on all five rules and holds the sentence; this table holds only
 * flags, because the sentences name diagnoses, medications and feeding
 * disorders. `accommodation_explain` stays where it is and nothing here
 * duplicates it.
 *
 * ADVISORY, NEVER A REFUSAL. Keyword resolution over family-authored prose is
 * wrong sometimes, so the flag hatches a unit card and never dims one. The
 * derivation prefers RECALL over precision for the same reason: a false
 * positive costs a mark staff overrule at a glance, a false negative returns
 * the household to prose nobody parses.
 *
 * BACKFILL: none, deliberately, and for the same reason 1500000133 states.
 * This column is written by family_camp_derived, which must be re-run per year
 * to populate it. A migration cannot compute it -- the input is a
 * person-partition custom value that needs the household collapse. Until the
 * sync runs the column is empty, and empty reads as "did not ask", which is
 * the safe direction: an unset advisory flag marks nothing.
 *
 * PocketBase v0.23 syntax: fields.add(new Field({...})) on an existing
 * collection, properties DIRECT rather than inside options{}. A bare
 * add({...}) silently does nothing. addField() is a no-op when the column
 * already exists, because PB records an applied migration by FILENAME -- a
 * later edit to this file would never re-run on a database that has already
 * seen it, and `Set` on a missing column is a silent no-op that simply never
 * persists. `has_infant` hit exactly that.
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
    type: "bool", name: "needs_fridge", required: false, presentable: false
  }));

  app.save(regs);
}, (app) => {
  const regs = app.findCollectionByNameOrId("family_camp_registrations");
  regs.fields.removeByName("needs_fridge");
  app.save(regs);
});
