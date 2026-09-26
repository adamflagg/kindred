/// <reference path="../pb_data/types.d.ts" />
/**
 * aid_requests -- what a family asked for, and for whom (campership
 * sub-project 5; spec 5, 9.1 and 9.2).
 *
 * One request per filled FA program field. `person_cm_id` is 0 for a
 * family-camp request, which is household grain. `session_cm_id` is 0 while the
 * FA option text resolves to no session: the request then sits in the
 * `unmatched_session` queue and is never given a default.
 *
 * `program_key` names the FA QUESTION answered (summer / family_camp /
 * bmitzvah / adult_weekend). It is not a rules program profile: the profile is
 * resolved from the session by the rules version that prices the request.
 *
 * THREE UNIQUE KEYS, each doing a different job:
 *   idx_aid_requests_intake_key -- the builder's idempotency key. The same FA
 *     answer always maps to the same row, so a re-run updates rather than
 *     duplicates. It includes the normalised option text, so a family that
 *     edits its answer gets a NEW request and the old one is withdrawn, keeping
 *     its corrections and decisions.
 *   idx_aid_requests_person_session / idx_aid_requests_household_session --
 *     spec 2 item 9: one ACTIVE request per season x person x session, or per
 *     season x household x session for family camp, WHATEVER household filed it.
 *     A second one is refused at intake (status `duplicate_pending`,
 *     `duplicate_of` naming the holder) and waits for staff to mark it a
 *     duplicate. There is no exemption: separated parents who each pay are ONE
 *     request with a share per household in aid_payer_shares (owner ruling
 *     2026-09-25).
 *
 * `created` is set once and never updated: it is the only "requested on" date
 * Kindred will ever have (spec 5, 9.1), and as-of demand reports read it.
 *
 * `headcount_source` is empty while no headcount is known. `billed` is set only
 * by intake. `declared` and `override` are staff entries that intake never
 * overwrites. The headcount locks when the award is made (sub-project 10).
 *
 * All five rules are null (spec 14.3).
 */

migrate((app) => {
  const applications = app.findCollectionByNameOrId("aid_applications");
  const collection = new Collection({
    type: "base",
    name: "aid_requests",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: "number", name: "year", required: true, presentable: false, min: 2017, max: 2100, onlyInt: true },
      { type: "relation", name: "application", required: true, presentable: false, collectionId: applications.id, cascadeDelete: false, minSelect: null, maxSelect: 1 },
      { type: "number", name: "household_cm_id", required: true, presentable: false, min: 1, max: null, onlyInt: true },
      { type: "number", name: "person_cm_id", required: false, presentable: true, min: 0, max: null, onlyInt: true },
      { type: "number", name: "session_cm_id", required: false, presentable: false, min: 0, max: null, onlyInt: true },
      { type: "select", name: "program_key", required: true, presentable: false, values: ["summer", "family_camp", "bmitzvah", "adult_weekend"], maxSelect: 1 },
      { type: "text", name: "program_option_text", required: false, presentable: false, min: 0, max: 500, pattern: "" },
      { type: "text", name: "program_option_key", required: false, presentable: false, min: 0, max: 500, pattern: "" },
      { type: "select", name: "session_resolution", required: true, presentable: false, values: ["alias", "exact", "contains", "enrollment", "staff", "unmatched"], maxSelect: 1 },
      { type: "number", name: "ask", required: false, presentable: false, min: 0, max: null, onlyInt: false },
      { type: "number", name: "headcount_non_infant", required: false, presentable: false, min: 0, max: 50, onlyInt: true },
      { type: "number", name: "headcount_infant", required: false, presentable: false, min: 0, max: 20, onlyInt: true },
      { type: "select", name: "headcount_source", required: false, presentable: false, values: ["declared", "billed", "override"], maxSelect: 1 },
      { type: "select", name: "status", required: true, presentable: false, values: ["active", "unmatched_session", "duplicate_pending", "duplicate", "withdrawn"], maxSelect: 1 },
      { type: "text", name: "duplicate_of", required: false, presentable: false, min: 0, max: 15, pattern: "^([a-z0-9]{15})?$" },
      { type: "json", name: "flags", required: false, presentable: false, maxSize: 100000 },
      { type: "autodate", name: "created", required: false, presentable: false, onCreate: true, onUpdate: false },
      { type: "autodate", name: "updated", required: false, presentable: false, onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX `idx_aid_requests_intake_key` ON `aid_requests` (`year`, `household_cm_id`, `person_cm_id`, `program_key`, `program_option_key`)",
      "CREATE UNIQUE INDEX `idx_aid_requests_person_session` ON `aid_requests` (`year`, `person_cm_id`, `session_cm_id`) WHERE `person_cm_id` > 0 AND `session_cm_id` > 0 AND `status` = 'active'",
      "CREATE UNIQUE INDEX `idx_aid_requests_household_session` ON `aid_requests` (`year`, `household_cm_id`, `session_cm_id`) WHERE `person_cm_id` = 0 AND `session_cm_id` > 0 AND `status` = 'active'",
      "CREATE INDEX `idx_aid_requests_year_status` ON `aid_requests` (`year`, `status`)",
      "CREATE INDEX `idx_aid_requests_application` ON `aid_requests` (`application`)",
    ],
  });
  app.save(collection);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("aid_requests"));
});
