/// <reference path="../pb_data/types.d.ts" />
/**
 * aid_session_capacity -- staff-entered session reference data for campership
 * (sub-project 5; spec 5 and 10.4).
 *
 * aid_session_capacity: a capacity figure, used ONLY to show how full a
 *   session is on a Round 3 request. Kindred does not store session capacity
 *   anywhere else. Gated on financial_aid.rules in FastAPI.
 *
 * There is deliberately NO session-alias table: a request's session comes from
 * the camper's registration (owner ruling 2026-09-27; see
 * api/services/financial_aid_session_resolver.py), and the FA form's option text
 * only breaks a tie between sessions the camper is enrolled in.
 *
 * All five rules are null (spec 14.3).
 */

migrate((app) => {
  const capacity = new Collection({
    type: "base",
    name: "aid_session_capacity",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: "number", name: "year", required: true, presentable: false, min: 2017, max: 2100, onlyInt: true },
      { type: "number", name: "session_cm_id", required: true, presentable: true, min: 1, max: null, onlyInt: true },
      { type: "number", name: "capacity", required: false, presentable: false, min: 0, max: 5000, onlyInt: true },
      { type: "text", name: "actor", required: true, presentable: false, min: 1, max: 200, pattern: "" },
      { type: "text", name: "note", required: false, presentable: false, min: 0, max: 2000, pattern: "" },
      { type: "autodate", name: "created", required: false, presentable: false, onCreate: true, onUpdate: false },
      { type: "autodate", name: "updated", required: false, presentable: false, onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX `idx_aid_session_capacity_year_session` ON `aid_session_capacity` (`year`, `session_cm_id`)",
    ],
  });
  app.save(capacity);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("aid_session_capacity"));
});
