/// <reference path="../pb_data/types.d.ts" />
/**
 * aid_change_log: operation_id and persona (campership sub-project 4a, spec §14.4).
 *
 * operation_id ties together the rows of one staff action: "make Round 1
 * offers" is one operation with hundreds of rows, shown as one line that
 * expands; a single appeal is an operation of one. It has the shape of a
 * PocketBase record id (15 chars of [a-z0-9]) because
 * bunking/financial_aid/change_log.py::new_operation_id generates it that way.
 *
 * persona is the admin "view as" persona a write was made under (spec §14.4:
 * "during view as, both the real person and the persona are recorded").
 * FastAPI keeps the real signed-in person as the actor and downgrades only the
 * permissions (bunking/rbac/view_as.py), so an admin previewing a persona that
 * holds financial_aid.casework can still write through FastAPI. Empty when no
 * persona applied. The persona string is its sorted permission codenames
 * joined by commas, or "none".
 *
 * Existing rows (none in production when this was written) become operations
 * of one, keyed by their own id: backfilled, never deleted.
 *
 * The helper's key set and the fields of every *_aid_change_log*.js migration
 * are pinned against each other by tests/unit/bunking/financial_aid/test_change_log.py.
 * Field properties are direct (v0.23+ ignores an options wrapper silently).
 */

migrate((app) => {
  const collection = app.findCollectionByNameOrId("aid_change_log");
  collection.fields.add(new Field({ type: "text", name: "operation_id", required: true, presentable: false, min: 15, max: 15, pattern: "^[a-z0-9]{15}$" }));
  collection.fields.add(new Field({ type: "text", name: "persona", required: false, presentable: false, min: 0, max: 2000, pattern: "" }));
  collection.indexes.push("CREATE INDEX `idx_aid_change_log_operation` ON `aid_change_log` (`operation_id`, `created`)");
  app.save(collection);

  // Raw SQL, after the column exists: each pre-existing row is its own operation.
  app.db().newQuery("UPDATE aid_change_log SET operation_id = id WHERE operation_id = ''").execute();
}, (app) => {
  const collection = app.findCollectionByNameOrId("aid_change_log");
  collection.fields.removeByName("operation_id");
  collection.fields.removeByName("persona");
  collection.indexes = collection.indexes.filter((idx) => idx.indexOf("idx_aid_change_log_operation") === -1);
  app.save(collection);
});
