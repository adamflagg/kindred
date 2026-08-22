/// <reference path="../pb_data/types.d.ts" />

// Owner ruling 2026-08-22: the Opt-Out VIP answer is ONE field in Kindred --
// accommodation_is_mandatory, its No pole ("must have the accommodation or
// they cancel"). opt_out_vip was the answer's Yes pole, captured raw by the
// original derived-tables work (#91) and left as a write-only vestige after
// #1878 added the explicit blocker column; PR #2535 retires it.
//
// Dropping the column loses only derived data: family_camp_registrations is
// rebuilt from person_custom_values on every sync, and the Go transform no
// longer writes this column at all. Measured on the prod snapshot 2026-08-22:
// 5 rows carry opt_out_vip=1 and every one is retained by other data, so the
// drop (and the retention-guard term that went with it) deletes nothing.
//
// The down migration deliberately does NOT backfill the column from
// accommodation_is_mandatory: the Yes pole is not derivable from the No pole
// (mandatory=false covers both "answered flexible" and "never answered" --
// backfilling !mandatory would stamp unanswered households as affirmatively
// flexible, the kindred#1874 conflation), and no rolled-back reader exists;
// the pre-retirement Go sync repopulates the column on its next run.
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
