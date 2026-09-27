/// <reference path="../pb_data/types.d.ts" />
/**
 * aid_attribution_overrides and aid_flag_dispositions (campership sub-project 4).
 * Two small, staff-reviewed layers on top of the derived aid_postings. They
 * share one migration so sub-project 4 stays inside its reserved numbers.
 *
 * aid_attribution_overrides: a reviewed decision about one posting.
 *   - Placement: attributed_person_cm_id / attributed_session_cm_id /
 *     program_family put the posting on a person, a session and/or a program
 *     family, outranking every inference rule. 0 and "" mean "not placed at
 *     that level".
 *   - Reclassification: source_key_override names another aid_sources row
 *     (a description_key) whose source family, funder type and
 *     counts_toward_budget the posting takes instead of its own description's.
 *     This is how a posting whose description hides its real source (outside
 *     money booked under the camp's own aid description) stops counting toward
 *     the budget. The target row usually comes from the private config file.
 *   A row may place, reclassify, or both. source = "sheet_2026_match" for the
 *   one-off 2026 lookup (sub-project 7), or "staff". Keyed (transaction_cm_id,
 *   year): it applies to every aid_postings row with that transaction id in
 *   that season, live or reversed.
 *
 * aid_flag_dispositions: finance's decision on one posting flag (spec §6.6),
 *   for example "accepted: let stand" or "accepted: late grant". An accepted
 *   variance stays visible but is no longer shown as open. flag is free text
 *   (a lower_snake_case flag name) so later sub-projects' flags need no
 *   migration. Keyed (transaction_cm_id, year, flag). Deleting a row reopens
 *   the flag.
 *
 * Both are written only by FastAPI, which commits each write together with
 * its aid_change_log row in one batch (sub-project 4a's commit_aid_writes).
 * actor is the staff email. All five rules are null on both.
 */
migrate((app) => {
  const overrides = new Collection({
    type: "base",
    name: "aid_attribution_overrides",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: "number", name: "year", required: true, presentable: false, min: 2010, max: 2100, onlyInt: true },
      { type: "number", name: "transaction_cm_id", required: true, presentable: true, min: 1, max: null, onlyInt: true },
      { type: "number", name: "attributed_person_cm_id", required: false, presentable: false, min: null, max: null, onlyInt: true },
      { type: "number", name: "attributed_session_cm_id", required: false, presentable: false, min: null, max: null, onlyInt: true },
      { type: "select", name: "program_family", required: false, presentable: false, values: ["summer", "quest", "teen", "bmitzvah", "family_camp", "adult_weekend", "family_school", "other"], maxSelect: 1 },
      { type: "text", name: "source_key_override", required: false, presentable: false, min: 0, max: 5000, pattern: "" },
      { type: "select", name: "source", required: true, presentable: false, values: ["sheet_2026_match", "staff"], maxSelect: 1 },
      { type: "text", name: "note", required: false, presentable: false, min: 0, max: 2000, pattern: "" },
      { type: "text", name: "actor", required: false, presentable: false, min: 0, max: 200, pattern: "" },
      { type: "autodate", name: "created", required: false, presentable: false, onCreate: true, onUpdate: false },
      { type: "autodate", name: "updated", required: false, presentable: false, onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX `idx_aid_attribution_overrides_txn_year` ON `aid_attribution_overrides` (`transaction_cm_id`, `year`)",
    ],
  });
  app.save(overrides);

  const dispositions = new Collection({
    type: "base",
    name: "aid_flag_dispositions",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: "number", name: "year", required: true, presentable: false, min: 2010, max: 2100, onlyInt: true },
      { type: "number", name: "transaction_cm_id", required: true, presentable: true, min: 1, max: null, onlyInt: true },
      { type: "text", name: "flag", required: true, presentable: false, min: 1, max: 100, pattern: "^[a-z][a-z0-9_]*$" },
      { type: "select", name: "disposition", required: true, presentable: false, values: ["accepted_let_stand", "accepted_late_grant", "accepted_other"], maxSelect: 1 },
      { type: "text", name: "note", required: true, presentable: false, min: 1, max: 2000, pattern: "" },
      { type: "text", name: "actor", required: false, presentable: false, min: 0, max: 200, pattern: "" },
      { type: "autodate", name: "created", required: false, presentable: false, onCreate: true, onUpdate: false },
      { type: "autodate", name: "updated", required: false, presentable: false, onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX `idx_aid_flag_dispositions_txn_year_flag` ON `aid_flag_dispositions` (`transaction_cm_id`, `year`, `flag`)",
    ],
  });
  app.save(dispositions);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("aid_flag_dispositions"));
  app.delete(app.findCollectionByNameOrId("aid_attribution_overrides"));
});
