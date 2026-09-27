/// <reference path="../pb_data/types.d.ts" />
/**
 * admin_audit_log: the admin audit log (spec 2026-09-26-admin-audit-log-design).
 *
 * Who did what to whose access, to the app's settings, or behind the app, and
 * when. One row per logged event. Written ONLY by the Go package
 * pocketbase/audit, inside the same transaction as the change it records;
 * never by the API, and never by FastAPI (which only reads it).
 *
 * - type: the screen's filter (Access, Roles, View as, Settings, PB Admin,
 *   Sign-in). Role GRANTS/REMOVALS on a user (user_roles create/delete/update)
 *   are type "access"; "roles" is only for role DEFINITIONS (create/edit/
 *   delete a row in the `roles` collection itself) -- owner ruling 2026-09-26.
 * - actor_*: copied at write time, so an entry survives the account's deletion.
 *   actor_kind "system" is the Pocket ID admin-group sync.
 * - before / after: CHANGED fields only, redacted and capped at 20 KB each by
 *   the Go writer (maxSize leaves room for the truncation marker).
 * - fields: the changed field names, space-joined, for search.
 * - session_id: pairs a view-as start with its stop.
 *
 * All five rules null: superusers only. NEVER '' -- that is PUBLIC.
 * Append-only: the Go hooks refuse every API create, update and delete, every
 * Go save of an existing row, and every schema change through the API. Only a
 * migration may change this collection. No `updated` field.
 *
 * pocketbase/audit/audittest/audittest.go mirrors this field list for Go tests;
 * rbac/admin_audit_log_booted_test.go compares the two on CI's booted schema.
 * Field properties are direct (v0.23+ ignores an options wrapper silently).
 */

migrate((app) => {
  const collection = new Collection({
    type: "base",
    name: "admin_audit_log",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: "select", name: "type", required: true, presentable: true, maxSelect: 1, values: ["access", "roles", "view_as", "settings", "pb_admin", "sign_in"] },
      { type: "text", name: "action", required: true, presentable: false, min: 1, max: 40, pattern: "" },
      { type: "select", name: "actor_kind", required: true, presentable: false, maxSelect: 1, values: ["user", "superuser", "system"] },
      { type: "text", name: "actor_id", required: false, presentable: false, min: 0, max: 50, pattern: "" },
      { type: "text", name: "actor_email", required: false, presentable: false, min: 0, max: 320, pattern: "" },
      { type: "text", name: "actor_name", required: false, presentable: false, min: 0, max: 255, pattern: "" },
      { type: "text", name: "collection", required: false, presentable: false, min: 0, max: 100, pattern: "" },
      { type: "text", name: "record_id", required: false, presentable: false, min: 0, max: 50, pattern: "" },
      { type: "text", name: "target_label", required: false, presentable: false, min: 0, max: 255, pattern: "" },
      { type: "json", name: "before", required: false, presentable: false, maxSize: 32768 },
      { type: "json", name: "after", required: false, presentable: false, maxSize: 32768 },
      { type: "text", name: "fields", required: false, presentable: false, min: 0, max: 2000, pattern: "" },
      { type: "text", name: "session_id", required: false, presentable: false, min: 0, max: 64, pattern: "" },
      { type: "json", name: "detail", required: false, presentable: false, maxSize: 8192 },
      { type: "text", name: "ip", required: false, presentable: false, min: 0, max: 64, pattern: "" },
      { type: "autodate", name: "created", required: false, presentable: false, onCreate: true, onUpdate: false },
    ],
    indexes: [
      "CREATE INDEX `idx_admin_audit_log_created` ON `admin_audit_log` (`created`)",
      "CREATE INDEX `idx_admin_audit_log_type_created` ON `admin_audit_log` (`type`, `created`)",
      "CREATE INDEX `idx_admin_audit_log_actor_created` ON `admin_audit_log` (`actor_email`, `created`)",
    ],
  });
  app.save(collection);
}, (app) => {
  // No destructive down on a log that holds history: refuse while it has rows.
  const collection = app.findCollectionByNameOrId("admin_audit_log");
  const rows = app.countRecords("admin_audit_log");
  if (rows > 0) {
    throw new Error("admin_audit_log holds " + rows + " entries; it is append-only and will not be dropped by a down migration");
  }
  app.delete(collection);
});
