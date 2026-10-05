/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: households.aid_adults, the adults CampMinder names for an aid household.
 * Dependencies: households
 *
 * The persons sync fills it for the current season's financial-aid cohort only
 * (pocketbase/sync/aid_adults.go): every relative of the cohort's campers, placed in
 * the household where CampMinder lists them as First (1) or Second (2) Principal, as
 * a JSON list of {cm_id, first, last, preferred, role, is_guardian}. Each run
 * rewrites it, so it holds current state, never history. These adults are not
 * persons rows: persons stays campers and staff.
 *
 * hidden: the field is Camperships-only and names people. PocketBase hides it from
 * every API response except a superuser's, which the FastAPI service client is, so
 * the household page can read it and the raw collection API cannot show it.
 *
 * Additive: no existing row or field changes.
 */
migrate((app) => {
  const households = app.findCollectionByNameOrId("households");
  households.fields.add(new Field({
    type: "json",
    name: "aid_adults",
    required: false,
    presentable: false,
    hidden: true,
    maxSize: 20000,
  }));
  app.save(households);
}, (app) => {
  const households = app.findCollectionByNameOrId("households");
  households.fields.removeByName("aid_adults");
  app.save(households);
});
