/// <reference path="../pb_data/types.d.ts" />

// Owner ruling 2026-08-22: the checkbox ticks are stored as truly separate
// answers. wants_with was an OR (a similar-age tick implied it) -- the
// superset is now derived at read time (eligibility in Go, proximity in
// _build_share); wants_with_named is the WITH-a-named-family tick alone, for
// the board's per-tick icons. Both are derived-from-raw; a transform re-run
// for 2025+2026 repopulates.

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
    type: "bool", name: "wants_with_named", required: false, presentable: false
  }));

  regs.fields.removeByName("wants_with");

  app.save(regs);
}, (app) => {
  const regs = app.findCollectionByNameOrId("family_camp_registrations");

  regs.fields.removeByName("wants_with_named");

  addField(regs, new Field({
    type: "bool", name: "wants_with", required: false, presentable: false
  }));

  app.save(regs);
});
