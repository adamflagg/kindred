/// <reference path="../pb_data/types.d.ts" />
/**
 * aid_google_forms + aid_form_responses: the adult aid Google Form mirror (adult-aid form design, PR 1).
 *
 * From 2027, adult-only Family Camp attendees and adult-weekend guests ask for aid on a Google Form, not
 * CampMinder's. The Go job `aid_google_form_responses` (sync/aid_google_form_responses.go) reads it every hour
 * into these two tables. NOTHING READS THEM YET: requests come in PR 2.
 *
 * ── aid_google_forms ── one row per season: the form id the job read (the id itself comes ONLY from the
 * private env var AID_GOOGLE_FORM_IDS, never from a migration), the revision, the question map (role/column ->
 * questionId), the choice map (program label -> bucket, weekend and weekend set) and the last pull's status.
 *
 * ── aid_form_responses ── one row per Google responseId, never deleted: a response Google stops returning is
 * marked form_status = deleted (behind the mass-vanish guard). An edit keeps the responseId and moves
 * last_submitted_at past created_at_google, which is how a later reader tells an edit. Both are Google's RFC 3339
 * strings verbatim (text: no timezone conversion to rule on, and they sort as text).
 *   - Answer columns carry the SAME names and types as financial_aid_applications, so a reader can build the
 *     same FaRow from either. A figure Kindred could not read is 0 AND has a parse_notes entry with read null:
 *     unknown is never 0. reported_income_fields lists the income columns the family did answer (0 included),
 *     exactly as the CampMinder mirror's.
 *   - Cross-table links are CampMinder ids (person_cm_id, household_cm_id, weekend_session_cm_id,
 *     registered_session_cm_id), never PocketBase relations. 0 means "not set": a required number rejects 0.
 *   - match_status: auto / suggested / registered_elsewhere / not_registered / unmatched are the job's; staff and
 *     ignored are staff decisions the job never re-matches; superseded is an older response from the same person
 *     for the same weekend (superseded_by names the newer responseId).
 *   - poc, race_ethnicity and gender_identity are stored here and nowhere else, and no operational endpoint
 *     returns them. These tables are never exported to Sheets or anywhere else.
 *
 * All five rules are null (locked, superuser-only), as every aid_* table. The `name:` values are LITERALS because
 * scripts/dev/verify-migration-history.sh CHECK 2 regexes them out of the up arm. Field properties are direct
 * (never an options wrapper, which v0.23 ignores silently); unbounded numbers use null, never max 0.
 */
migrate((app) => {
  const forms = new Collection({
    type: "base",
    name: "aid_google_forms",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: "number", name: "year", required: true, presentable: false, min: 2010, max: 2100, onlyInt: true },
      { type: "text", name: "form_id", required: true, presentable: false, min: 1, max: 200, pattern: "" },
      { type: "text", name: "revision_id", required: false, presentable: false, min: 0, max: 100, pattern: "" },
      { type: "json", name: "question_map", required: false, presentable: false, maxSize: 20000 },
      { type: "json", name: "choice_map", required: false, presentable: false, maxSize: 200000 },
      { type: "date", name: "last_pulled_at", required: false, presentable: false, min: "", max: "" },
      { type: "text", name: "last_pull_status", required: false, presentable: false, min: 0, max: 2000, pattern: "" },
      { type: "autodate", name: "created", required: false, presentable: false, onCreate: true, onUpdate: false },
      { type: "autodate", name: "updated", required: false, presentable: false, onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX `idx_aid_google_forms_year` ON `aid_google_forms` (`year`)",
    ],
  });
  app.save(forms);

  const responses = new Collection({
    type: "base",
    name: "aid_form_responses",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: "number", name: "year", required: true, presentable: false, min: 2010, max: 2100, onlyInt: true },
      { type: "text", name: "form_id", required: true, presentable: false, min: 1, max: 200, pattern: "" },
      { type: "text", name: "response_id", required: true, presentable: false, min: 1, max: 200, pattern: "" },
      { type: "text", name: "created_at_google", required: false, presentable: false, min: 0, max: 40, pattern: "" },
      { type: "text", name: "last_submitted_at", required: false, presentable: false, min: 0, max: 40, pattern: "" },
      { type: "select", name: "form_status", required: true, presentable: false, values: ["live", "deleted"], maxSelect: 1 },
      { type: "text", name: "respondent_email", required: false, presentable: false, min: 0, max: 320, pattern: "" },
      { type: "text", name: "name_typed", required: false, presentable: false, min: 0, max: 300, pattern: "" },
      { type: "text", name: "birthdate_typed", required: false, presentable: false, min: 0, max: 50, pattern: "" },
      { type: "text", name: "program_choice", required: false, presentable: false, min: 0, max: 500, pattern: "" },
      { type: "select", name: "program_key", required: false, presentable: false, values: ["family_camp", "adult_weekend"], maxSelect: 1 },
      { type: "number", name: "weekend_session_cm_id", required: false, presentable: false, min: 0, max: null, onlyInt: true },
      { type: "number", name: "registered_session_cm_id", required: false, presentable: false, min: 0, max: null, onlyInt: true },
      { type: "number", name: "person_cm_id", required: false, presentable: false, min: 0, max: null, onlyInt: true },
      { type: "number", name: "household_cm_id", required: false, presentable: false, min: 0, max: null, onlyInt: true },
      { type: "select", name: "match_status", required: true, presentable: false, values: ["auto", "suggested", "staff", "unmatched", "registered_elsewhere", "not_registered", "ignored", "superseded"], maxSelect: 1 },
      { type: "number", name: "match_tier", required: false, presentable: false, min: 0, max: 3, onlyInt: true },
      { type: "json", name: "match_candidates", required: false, presentable: false, maxSize: 50000 },
      { type: "text", name: "superseded_by", required: false, presentable: false, min: 0, max: 200, pattern: "" },
      { type: "text", name: "linked_by", required: false, presentable: false, min: 0, max: 200, pattern: "" },
      { type: "date", name: "linked_at", required: false, presentable: false, min: "", max: "" },
      { type: "text", name: "ignored_reason", required: false, presentable: false, min: 0, max: 1000, pattern: "" },
      { type: "number", name: "ask", required: false, presentable: false, min: null, max: null, onlyInt: false },
      { type: "number", name: "total_gross_income", required: false, presentable: false, min: null, max: null, onlyInt: false },
      { type: "number", name: "income_confirmed", required: false, presentable: false, min: null, max: null, onlyInt: false },
      { type: "number", name: "total_adjusted_income", required: false, presentable: false, min: null, max: null, onlyInt: false },
      { type: "number", name: "expected_gross_income", required: false, presentable: false, min: null, max: null, onlyInt: false },
      { type: "number", name: "total_housing_expenses", required: false, presentable: false, min: null, max: null, onlyInt: false },
      { type: "number", name: "non_retirement_savings", required: false, presentable: false, min: null, max: null, onlyInt: false },
      { type: "number", name: "total_rent", required: false, presentable: false, min: null, max: null, onlyInt: false },
      { type: "number", name: "total_medical_expenses", required: false, presentable: false, min: null, max: null, onlyInt: false },
      { type: "number", name: "student_debt", required: false, presentable: false, min: null, max: null, onlyInt: false },
      { type: "bool", name: "unemployment", required: false, presentable: false },
      { type: "bool", name: "gov_subsidies", required: false, presentable: false },
      { type: "number", name: "num_children", required: false, presentable: false, min: 0, max: 50, onlyInt: true },
      { type: "text", name: "special_circumstances", required: false, presentable: false, min: 0, max: 10000, pattern: "" },
      { type: "json", name: "reported_income_fields", required: false, presentable: false, maxSize: 2000 },
      { type: "json", name: "parse_notes", required: false, presentable: false, maxSize: 100000 },
      { type: "text", name: "poc", required: false, presentable: false, min: 0, max: 100, pattern: "" },
      { type: "text", name: "race_ethnicity", required: false, presentable: false, min: 0, max: 500, pattern: "" },
      { type: "text", name: "gender_identity", required: false, presentable: false, min: 0, max: 100, pattern: "" },
      { type: "text", name: "county", required: false, presentable: false, min: 0, max: 200, pattern: "" },
      { type: "text", name: "signature_typed", required: false, presentable: false, min: 0, max: 500, pattern: "" },
      { type: "text", name: "agreement_date", required: false, presentable: false, min: 0, max: 50, pattern: "" },
      { type: "autodate", name: "created", required: false, presentable: false, onCreate: true, onUpdate: false },
      { type: "autodate", name: "updated", required: false, presentable: false, onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX `idx_aid_form_responses_response_id` ON `aid_form_responses` (`response_id`)",
      "CREATE INDEX `idx_aid_form_responses_year_match_status` ON `aid_form_responses` (`year`, `match_status`)",
      "CREATE INDEX `idx_aid_form_responses_year_person` ON `aid_form_responses` (`year`, `person_cm_id`)",
      "CREATE INDEX `idx_aid_form_responses_year_household` ON `aid_form_responses` (`year`, `household_cm_id`)",
    ],
  });
  app.save(responses);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("aid_form_responses"));
  app.delete(app.findCollectionByNameOrId("aid_google_forms"));
});
