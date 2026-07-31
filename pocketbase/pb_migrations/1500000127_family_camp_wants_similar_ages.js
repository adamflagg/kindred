/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: family_camp_registrations.wants_similar_ages
 *
 * The fourth option of "FAM CAMP-Shared Cabin" is "Share a cabin WITH a family
 * with similarly aged kid(s) that I can meet at Camp". 1500000126 collapsed it
 * into wants_with, which is right as far as it goes -- the sentence begins
 * "Share a cabin WITH", so it IS a co-housing request -- but it erases the one
 * thing that makes the option operationally different: the partner is UNNAMED.
 *
 * Those are the households staff can pair with each other. A named WITH request
 * has exactly one valid partner and fails if that family does not enrol; an
 * unnamed one can be satisfied by any other household in the same pool. Without
 * this column the roster cannot tell the two apart, and the matchable pool is
 * invisible. 22 households across 2025-2026.
 *
 * wants_similar_ages IMPLIES wants_with -- ParseSharedCabinModes sets both, so
 * every existing consumer of wants_with keeps seeing these households and this
 * column only narrows. It is not a third axis alongside NEAR and WITH.
 *
 * PocketBase v0.23 syntax: fields.add(new Field({...})) on an existing
 * collection. A bare add({...}) silently does nothing.
 *
 * The add goes through addField(), which is a no-op when the column already
 * exists. PB records an applied migration by FILENAME, so on any database that
 * has already run this file a later edit would never take effect, and `Set` on a
 * missing column is a silent no-op -- the value just never persists. has_infant
 * hit exactly that during 1500000126.
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
    type: "bool", name: "wants_similar_ages", required: false, presentable: false
  }));
  app.save(regs);
}, (app) => {
  const regs = app.findCollectionByNameOrId("family_camp_registrations");
  regs.fields.removeByName("wants_similar_ages");
  app.save(regs);
});
