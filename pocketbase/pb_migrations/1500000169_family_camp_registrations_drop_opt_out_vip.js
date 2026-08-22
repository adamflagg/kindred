/// <reference path="../pb_data/types.d.ts" />

// Owner ruling 2026-08-22: the Opt-Out VIP answer is ONE field in Kindred --
// accommodation_is_mandatory, its No pole ("must have the accommodation or
// they cancel"). opt_out_vip was the answer's Yes pole, captured raw by the
// original derived-tables work (#91) and left as a write-only vestige after
// #1878 added the explicit blocker column; PR #2535 retires it.
//
// Dropping the column loses only derived data: family_camp_registrations is
// rebuilt from person_custom_values on every sync, and the Go transform no
// longer writes this column at all.
migrate((app) => {
  const collection = app.findCollectionByNameOrId("family_camp_registrations");
  collection.fields.removeByName("opt_out_vip");
  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("family_camp_registrations");
  collection.fields.add(new Field({
    type: "bool",
    name: "opt_out_vip",
    required: false,
  }));
  app.save(collection);
});
