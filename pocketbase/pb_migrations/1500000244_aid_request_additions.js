/// <reference path="../pb_data/types.d.ts" />
/**
 * aid_request_additions -- a request staff added that the aid form never named
 * (a Teen Winter Retreat or B*Mitzvah request beside a camper's summer one).
 *
 * Intake is the only creator of aid_requests, and it withdraws any request its
 * inputs do not produce at the next form sync. An addition is a STORED,
 * staff-owned input intake reads beside the form rows: every live row becomes
 * one request keyed `added:<session_cm_id>`, with a staff resolution intake
 * keeps. No CampMinder sync writes this table.
 *
 * One LIVE row per (year, household, camper, session): the partial unique index
 * below, the same pattern aid_requests' one-active-request indexes use on
 * `status` (an empty date field is stored as ''). FastAPI's casework service
 * checks it first, so a clash is a clean refusal, never a failed batch.
 *
 * `person_cm_id` 0 would be a Family Camp household request (not added through
 * the casework routes yet). `source` says who made it: staff, or (2027 on) the
 * dated registration-ask rule. Retiring sets `retired_at`/`retired_by`/
 * `retire_reason` and withdraws the request; a row is never deleted, so the
 * request's decisions stay attached. Every write commits with its aid_change_log
 * row in one batch (sub-project 4a's commit_aid_writes). All five rules are null
 * (spec 14.3): the API reads and writes through its superuser client.
 */

migrate((app) => {
  const collection = new Collection({
    type: "base",
    name: "aid_request_additions",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: "number", name: "year", required: true, presentable: false, min: 2017, max: 2100, onlyInt: true },
      { type: "number", name: "household_cm_id", required: true, presentable: false, min: 1, max: null, onlyInt: true },
      { type: "number", name: "person_cm_id", required: false, presentable: true, min: 0, max: null, onlyInt: true },
      { type: "select", name: "program_key", required: true, presentable: false, values: ["summer", "family_camp", "bmitzvah", "adult_weekend"], maxSelect: 1 },
      { type: "number", name: "session_cm_id", required: true, presentable: false, min: 1, max: null, onlyInt: true },
      { type: "number", name: "ask", required: true, presentable: false, min: 0, max: null, onlyInt: false },
      { type: "select", name: "source", required: true, presentable: false, values: ["staff", "registration_ask"], maxSelect: 1 },
      { type: "text", name: "reason", required: true, presentable: false, min: 1, max: 2000, pattern: "" },
      { type: "text", name: "actor", required: true, presentable: false, min: 1, max: 200, pattern: "" },
      { type: "date", name: "retired_at", required: false, presentable: false, min: "", max: "" },
      { type: "text", name: "retired_by", required: false, presentable: false, min: 0, max: 200, pattern: "" },
      { type: "text", name: "retire_reason", required: false, presentable: false, min: 0, max: 2000, pattern: "" },
      { type: "autodate", name: "created", required: false, presentable: false, onCreate: true, onUpdate: false },
      { type: "autodate", name: "updated", required: false, presentable: false, onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX `idx_aid_request_additions_live` ON `aid_request_additions` (`year`, `household_cm_id`, `person_cm_id`, `session_cm_id`) WHERE `retired_at` = ''",
      "CREATE INDEX `idx_aid_request_additions_slot` ON `aid_request_additions` (`year`, `household_cm_id`, `person_cm_id`, `session_cm_id`)",
    ],
  });
  app.save(collection);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("aid_request_additions"));
});
