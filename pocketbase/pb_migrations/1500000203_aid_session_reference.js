/// <reference path="../pb_data/types.d.ts" />
/**
 * aid_session_capacity + aid_session_aliases -- staff-entered session reference
 * data for campership (sub-project 5; spec 5 and 10.4).
 *
 * aid_session_capacity: a capacity figure, used ONLY to show how full a
 *   session is on a Round 3 request. Kindred does not store session capacity
 *   anywhere else. Gated on financial_aid.rules in FastAPI.
 *
 * aid_session_aliases: FA-form option text -> CampMinder session. The FA form's
 *   option text and camp_sessions names differ for 22 of 43 options (sheet
 *   levers catalogue 2.5), and the differences are camp-specific names, so the
 *   mapping is DATA that staff enter from the unmatched-session queue, never
 *   code. One option may alias several sessions (a combined in-training option
 *   covers two): intake then decides by the camper's registration, and if that
 *   cannot decide, the request stays unmatched. `option_key` is the normalised
 *   text (api/services/financial_aid_session_resolver.normalize_option_text).
 *
 * All five rules are null on both (spec 14.3).
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

  const aliases = new Collection({
    type: "base",
    name: "aid_session_aliases",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: "number", name: "year", required: true, presentable: false, min: 2017, max: 2100, onlyInt: true },
      { type: "select", name: "program_key", required: true, presentable: false, values: ["summer", "family_camp", "bmitzvah", "adult_weekend"], maxSelect: 1 },
      { type: "text", name: "option_key", required: true, presentable: true, min: 1, max: 500, pattern: "" },
      { type: "text", name: "option_text", required: false, presentable: false, min: 0, max: 500, pattern: "" },
      { type: "number", name: "session_cm_id", required: true, presentable: false, min: 1, max: null, onlyInt: true },
      { type: "text", name: "actor", required: true, presentable: false, min: 1, max: 200, pattern: "" },
      { type: "text", name: "note", required: false, presentable: false, min: 0, max: 2000, pattern: "" },
      { type: "autodate", name: "created", required: false, presentable: false, onCreate: true, onUpdate: false },
      { type: "autodate", name: "updated", required: false, presentable: false, onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX `idx_aid_session_aliases_key` ON `aid_session_aliases` (`year`, `program_key`, `option_key`, `session_cm_id`)",
    ],
  });
  app.save(aliases);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("aid_session_aliases"));
  app.delete(app.findCollectionByNameOrId("aid_session_capacity"));
});
