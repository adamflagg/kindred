/// <reference path="../pb_data/types.d.ts" />
/**
 * aid_rules.revision -- write only if unchanged (campership G6).
 *
 * A Posted tick's rules-section locks, a finance approval or save and a section editor's save each read
 * an aid_rules record and write its section_status back whole, so two of them at once could overwrite
 * each other. pocketbase/aidguard keeps this number: 0 on create, +1 on every save, whoever saves. A
 * FastAPI write sends the revision it read as If-Match inside its /api/batch transaction and is refused
 * (412) when the record moved on; nothing in that batch commits.
 *
 * Additive: every existing row reads 0, which is the revision its first guarded write expects. Not
 * required: PocketBase treats 0 as blank on a required number field. The collection's rules stay null.
 */
migrate((app) => {
  const rules = app.findCollectionByNameOrId("aid_rules");
  rules.fields.add(new Field({ type: "number", name: "revision", required: false, presentable: false, min: 0, max: null, onlyInt: true }));
  app.save(rules);
}, (app) => {
  // Rolling this back needs pocketbase/aidguard rolled back with it: the hook sets `revision` on every save,
  // and FastAPI's commit_aid_writes sends it as If-Match on every aid_rules write. Without the field every row
  // reads 0, so the guard passes everything silently.
  const rules = app.findCollectionByNameOrId("aid_rules");
  rules.fields.removeByName("revision");
  app.save(rules);
});
