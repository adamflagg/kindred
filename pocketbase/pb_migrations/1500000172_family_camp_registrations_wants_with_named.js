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

  // NO in-migration backfill, in either direction, and that is deliberate.
  // Copying the old wants_with into wants_with_named would poison the new
  // column with the OR it exists to remove (every similar-age-only household
  // would read as NAMED). Both columns are derived-from-raw: the family-camp
  // transform re-run (2025 + 2026) is the backfill going up, and the same
  // re-run repopulates wants_with after a rollback — the identical recovery
  // path 1500000169's opt_out_vip drop shipped with. Until the re-run,
  // wants_with_named reads false and the roster's derived 'with' under-reports;
  // the stored share_eligibility column is untouched, so placement verdicts
  // never regress in the window.
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
