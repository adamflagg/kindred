/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: the medical gate answer leaves the narrative column (kindred#2542).
 *
 * CampMinder asks each of these questions in two parts -- a Yes/No gate and a
 * free-text explanation -- and processMedical stored the pair in ONE column. So
 * `allergy_info` read "Yes; <the family's sentence>", where the leading "Yes; "
 * is not something the family wrote, and a household that answered No got a
 * narrative consisting of the bare word "No" (418 of 676 populated allergy rows
 * in 2026). These five columns take the gate, and the narrative columns keep the
 * family's own words alone.
 *
 * THREE STATES, and the third is the reason this is a select and not a bool.
 * Families reach different question blocks, so "answered No" and "never asked"
 * are different facts: in 2026, 430 of 900 households answered the allergy gate
 * No and 224 never answered it at all; for the physician gate it is 284 and 589.
 * A non-nullable bool would collapse those into one `false`. The empty string is
 * the third state, exactly as family_camp_registrations.share_cabin_gate does it
 * (migration 1500000126) -- a non-required select, with the empty string named
 * at the schema edge rather than stored as a word.
 *
 * These sit on family_camp_medical rather than family_camp_registrations
 * deliberately: that table is admin-gated on all five rules and absent from
 * every export config, and a gate answer is still an answer to a medical
 * question. lodging_medical_narrative_test.go's gateColumns enforces it.
 *
 * PocketBase v0.23 syntax: fields.add(new Field({...})) on an existing
 * collection. A bare add({...}) silently does nothing.
 *
 * The five addField() calls below are written out literally, one per column,
 * rather than looped over an array: TestMedicalGateColumnsExistInASchemaMigration
 * greps this file for the literal `name: "allergy_gate"` and so on, and a loop
 * variable can never match that. Migration 1500000126 sets the same precedent.
 *
 * addField() is a no-op when the column is already present. That matters while
 * this migration is unmerged: PB records an applied migration by FILENAME, so a
 * column added to this file after a dev database already ran it would never
 * appear there, and `Set` on a missing column is a silent no-op. Idempotent adds
 * mean clearing the _migrations row is enough to pick the change up.
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
  const medical = app.findCollectionByNameOrId("family_camp_medical");
  addField(medical, new Field({
    type: "select", name: "allergy_gate", required: false, presentable: false,
    values: ["yes", "no"], maxSelect: 1
  }));
  addField(medical, new Field({
    type: "select", name: "dietary_gate", required: false, presentable: false,
    values: ["yes", "no"], maxSelect: 1
  }));
  addField(medical, new Field({
    type: "select", name: "special_needs_gate", required: false, presentable: false,
    values: ["yes", "no"], maxSelect: 1
  }));
  addField(medical, new Field({
    type: "select", name: "physician_gate", required: false, presentable: false,
    values: ["yes", "no"], maxSelect: 1
  }));
  addField(medical, new Field({
    type: "select", name: "cpap_gate", required: false, presentable: false,
    values: ["yes", "no"], maxSelect: 1
  }));
  app.save(medical);
}, (app) => {
  const medical = app.findCollectionByNameOrId("family_camp_medical");
  for (const name of [
    "allergy_gate", "dietary_gate", "special_needs_gate", "physician_gate", "cpap_gate"
  ]) {
    medical.fields.removeByName(name);
  }
  app.save(medical);
});
