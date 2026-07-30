/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: household-grain request columns and PHI narrative columns.
 *
 * family_camp_registrations is ALREADY household-year grain and already carries
 * share_cabin_preference / shared_cabin_with, so the request layer extends it
 * rather than adding a table -- spec 8 forbids a new extraction table without a
 * reader, and spec 6.3 says keep the three family_camp_* tables as household-year
 * profile data without re-keying them.
 *
 * The split between the two collections is spec 5's, and it is the point of this
 * migration: narrative medical text goes to family_camp_medical, which is
 * admin-gated on all five rules, while family_camp_registrations gets only
 * DERIVED BOOLEANS. The board shows "needs private bathroom", never the sentence
 * explaining why.
 *
 * It also RENAMES shared_cabin_with -> shared_cabin_modes_raw. That column never
 * held "who they want to share with": it holds the pipe-delimited multi-select
 * from FAM CAMP-Shared Cabin, and in 2025 199 of its rows read "House my family
 * NEAR a specific family..." while none contains a family name. Spec 1 records
 * these tables have zero read consumers, so the rename costs nothing and stops a
 * reader trusting the old name.
 *
 * share_cabin_preference is deliberately NOT renamed: its name IS accurate (it
 * holds the No/Maybe/Yes sentence), and a symmetric share_cabin_gate_raw would
 * sit one suffix away from the new share_cabin_gate column below. Do not "fix"
 * it later by analogy.
 *
 * PocketBase v0.23 syntax: fields.add(new Field({...})) on an existing
 * collection. A bare add({...}) silently does nothing.
 */

migrate((app) => {
  const regs = app.findCollectionByNameOrId("family_camp_registrations");

  // Rename in place. getByName keeps the field's ID, which is what makes
  // PocketBase emit an ALTER TABLE ... RENAME COLUMN and preserve the 555 (2025)
  // / 574 (2024) existing values. Removing and re-adding would drop them.
  const modes = regs.fields.getByName("shared_cabin_with");
  if (modes) {
    modes.name = "shared_cabin_modes_raw";
  }

  // Normalised 3-state gate from "FAM CAMP-Share Cabins" (spec 4.3). The four
  // observed option sentences collapse onto these three.
  regs.fields.add(new Field({
    type: "select", name: "share_cabin_gate", required: false, presentable: false,
    values: ["no_share", "maybe_mutual", "yes_share"], maxSelect: 1
  }));
  // From "FAM CAMP-Shared Cabin", a pipe-delimited multi-select. NEAR and WITH
  // are different edge types (spec 4.3): proximity is satisfied by map distance,
  // co-housing by sharing a slot. 24 households ask for both.
  regs.fields.add(new Field({ type: "bool", name: "wants_near", required: false, presentable: false }));
  regs.fields.add(new Field({ type: "bool", name: "wants_with", required: false, presentable: false }));
  // Deduped free text at HOUSEHOLD grain. 4000 because several fields concatenate.
  regs.fields.add(new Field({
    type: "text", name: "request_text", required: false, presentable: false,
    min: 0, max: 4000, pattern: ""
  }));
  regs.fields.add(new Field({
    type: "text", name: "request_source_field", required: false, presentable: false,
    min: 0, max: 200, pattern: ""
  }));
  regs.fields.add(new Field({
    type: "date", name: "request_last_updated", required: false, presentable: false, min: "", max: ""
  }));
  // Derived accessibility flags -- spec 5.3: "The board/map shows a derived flag
  // only, never the narrative text."
  regs.fields.add(new Field({
    type: "bool", name: "needs_private_bathroom", required: false, presentable: false
  }));
  regs.fields.add(new Field({ type: "bool", name: "needs_power", required: false, presentable: false }));
  // From "FAM CAMP-Opt Out VIP": "Yes, please register regardless of cabin type"
  // (90) means the family will come anyway, so the need is a warning; "No, I am
  // only able to attend with this accommodation in place" (39) makes it a
  // blocker. Unanswered stays false, i.e. the softer reading.
  regs.fields.add(new Field({
    type: "bool", name: "accommodation_is_mandatory", required: false, presentable: false
  }));
  app.save(regs);

  const medical = app.findCollectionByNameOrId("family_camp_medical");
  // PHI narrative. "Housing-Bathroom" and "Bathroom-Yes" carry detailed medical
  // disclosures about named individuals. Never logged, never exported, never
  // rendered outside a permission-checked reveal.
  medical.fields.add(new Field({
    type: "text", name: "bathroom_explain", required: false, presentable: false,
    min: 0, max: 4000, pattern: ""
  }));
  medical.fields.add(new Field({
    type: "text", name: "accommodation_explain", required: false, presentable: false,
    min: 0, max: 4000, pattern: ""
  }));
  app.save(medical);
}, (app) => {
  const regs = app.findCollectionByNameOrId("family_camp_registrations");
  const modes = regs.fields.getByName("shared_cabin_modes_raw");
  if (modes) {
    modes.name = "shared_cabin_with";
  }
  for (const name of [
    "share_cabin_gate", "wants_near", "wants_with", "request_text",
    "request_source_field", "request_last_updated", "needs_private_bathroom",
    "needs_power", "accommodation_is_mandatory"
  ]) {
    regs.fields.removeByName(name);
  }
  app.save(regs);

  const medical = app.findCollectionByNameOrId("family_camp_medical");
  medical.fields.removeByName("bathroom_explain");
  medical.fields.removeByName("accommodation_explain");
  app.save(medical);
});
