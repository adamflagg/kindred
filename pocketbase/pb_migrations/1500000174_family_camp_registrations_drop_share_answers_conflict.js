/// <reference path="../pb_data/types.d.ts" />

// Owner ruling 2026-08-23: the "Answers disagree" chip comes out front to
// back. share_answers_conflict is DeriveShareEligibility's third return value
// (pocketbase/sync/lodging_requests.go) -- computed and stored, but never read
// by eligibility itself. The API schema, the roster service, and the board's
// chip DID read it downstream -- that payload -> chip chain is what this
// migration and its siblings retire. Same write-only-column shape 1500000169
// found in opt_out_vip, and the same fix: drop the column.
//
// Dropping the column loses only derived data: family_camp_registrations is
// rebuilt from person_custom_values on every sync, and the Go transform no
// longer writes this column at all.
//
// The down migration does NOT backfill the column: no rolled-back reader
// exists (DeriveShareEligibility no longer computes a conflict value to
// backfill it with), and the pre-retirement Go sync repopulates the column on
// its next run regardless.
migrate((app) => {
  const collection = app.findCollectionByNameOrId("family_camp_registrations");
  collection.fields.removeByName("share_answers_conflict");
  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("family_camp_registrations");
  collection.fields.add(new Field({
    type: "bool",
    name: "share_answers_conflict",
    required: false,
  }));
  app.save(collection);
});
