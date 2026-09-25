/// <reference path="../pb_data/types.d.ts" />
/**
 * aid_change_log: the financial aid change history (campership spec §5, §14.4).
 *
 * One row per write to decisions, request state, grants, rules, attribution
 * overrides and session capacity: who (`actor`, a user id or email), when
 * (`created`), what (`entity` + `entity_id`, `action`), from and to (`before`,
 * `after` JSON snapshots) and why (`reason`). A business record, not an access
 * log. Written only by FastAPI as superuser through
 * bunking/financial_aid/change_log.py::record_change; that helper's key set and
 * this field list are pinned against each other by a Python test.
 *
 * `entity_id` is text because entities are keyed differently: a PocketBase id,
 * a CampMinder id, or a composite such as "2027:1000001:1000002".
 * `year` is the season (spec §2 item 3), required like every aid table.
 *
 * All five rules null: superusers only. NEVER '' -- that is PUBLIC.
 * Append-only by convention: the helper only creates. No `updated` field.
 * Field properties are direct (v0.23+ ignores an options wrapper silently).
 */

migrate((app) => {
  const collection = new Collection({
    type: "base",
    name: "aid_change_log",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: "text", name: "entity", required: true, presentable: true, min: 1, max: 64, pattern: "" },
      { type: "text", name: "entity_id", required: true, presentable: false, min: 1, max: 64, pattern: "" },
      { type: "number", name: "year", required: true, presentable: false, min: 2000, max: 2100, onlyInt: true },
      { type: "text", name: "action", required: true, presentable: false, min: 1, max: 64, pattern: "" },
      { type: "json", name: "before", required: false, presentable: false, maxSize: 1000000 },
      { type: "json", name: "after", required: false, presentable: false, maxSize: 1000000 },
      { type: "text", name: "actor", required: true, presentable: false, min: 1, max: 320, pattern: "" },
      { type: "text", name: "reason", required: false, presentable: false, min: 0, max: 10000, pattern: "" },
      { type: "autodate", name: "created", required: false, presentable: false, onCreate: true, onUpdate: false },
    ],
    indexes: [
      "CREATE INDEX `idx_aid_change_log_entity` ON `aid_change_log` (`entity`, `entity_id`, `created`)",
      "CREATE INDEX `idx_aid_change_log_year` ON `aid_change_log` (`year`, `created`)",
    ],
  });
  app.save(collection);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("aid_change_log"));
});
