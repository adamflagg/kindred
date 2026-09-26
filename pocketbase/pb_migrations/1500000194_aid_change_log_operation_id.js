/// <reference path="../pb_data/types.d.ts" />
/**
 * aid_change_log: operation_id (campership sub-project 4a, spec §14.4).
 *
 * operation_id ties together the rows of one staff action: "make Round 1
 * offers" is one operation with hundreds of rows, shown as one line that
 * expands; a single appeal is an operation of one. It has the shape of a
 * PocketBase record id (15 chars of [a-z0-9]) because
 * bunking/financial_aid/change_log.py::new_operation_id generates it that way.
 *
 * Only the real signed-in person is recorded, as actor (owner ruling
 * 2026-09-26): an admin's "view as" preview (bunking/rbac/view_as.py) already
 * keeps actor as that real person and only downgrades permissions, so there
 * is nothing else to log.
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
  collection.indexes.push("CREATE INDEX `idx_aid_change_log_operation` ON `aid_change_log` (`operation_id`, `created`)");
  app.save(collection);

  // Raw SQL, after the column exists: each pre-existing row is its own operation.
  app.db().newQuery("UPDATE aid_change_log SET operation_id = id WHERE operation_id = ''").execute();
}, (app) => {
  const collection = app.findCollectionByNameOrId("aid_change_log");
  collection.fields.removeByName("operation_id");
  collection.indexes = collection.indexes.filter((idx) => idx.indexOf("idx_aid_change_log_operation") === -1);
  app.save(collection);
});
