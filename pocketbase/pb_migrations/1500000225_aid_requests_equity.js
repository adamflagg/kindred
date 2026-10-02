/// <reference path="../pb_data/types.d.ts" />
/**
 * aid_requests.equity -- intake's recorded copy of a camper's own equity answers (campership 3c-2).
 *
 * The answers live in CampMinder's custom fields, which each sync overwrites, so a past date could
 * not price them. Intake now copies them onto each camper-level request whenever they change,
 * through sub-project 4a's logged writes, and a past date prices this copy as it stood. Live
 * pricing keeps reading the synced answers (owner ruling 2026-09-30).
 * {"bipoc": true|false|null, "gender_identity": "", "pronouns": ""}; null = not recorded yet (a
 * household-level request never has one). The collection's rules stay null.
 */
migrate((app) => {
  const collection = app.findCollectionByNameOrId("aid_requests");
  collection.fields.add(new Field({ type: "json", name: "equity", required: false, presentable: false, maxSize: 2000 }));
  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("aid_requests");
  collection.fields.removeByName("equity");
  app.save(collection);
});
