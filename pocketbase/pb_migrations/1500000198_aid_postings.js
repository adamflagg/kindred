/// <reference path="../pb_data/types.d.ts" />
/**
 * aid_postings (campership sub-project 4). DERIVED -- written only by the Go
 * aid_postings transform (app.Save) and read by FastAPI as superuser.
 *
 * One row per aid posting in category 3840 or 19616, or 3839 when aid_sources
 * says the description counts as aid:
 *   - every LIVE row (financial_transactions.is_reversed = false), and
 *   - the CREDIT leg (negative amount) of every REVERSED pair, kept as history
 *     with is_reversed = true and its reversal_date.
 * Both legs of a CampMinder reversal share the transaction id, carry
 * is_reversed = true and differ in sign; the positive reversing leg adds nothing
 * an as-of read needs, so it is not stored. Money "live as of D" is a row with
 * post_date <= D and (is_reversed = false or reversal_date > D). Every read
 * that is not a history or as-of read filters is_reversed = false.
 *
 * Grain (transaction_cm_id, amount, year), the same as financial_transactions.
 * year is CampMinder's per-row season, never the post date's year. amount keeps
 * CampMinder's sign: negative = aid. post_date and reversal_date are true UTC.
 *
 * source_key is the posting's own description key. effective_source_key,
 * source_family, funder_type and counts_toward_budget are the classification
 * AFTER any per-posting reclassification (aid_attribution_overrides.
 * source_key_override), materialized by the transform.
 *
 * attribution_level / attribution_method record HOW the row was placed
 * (spec §6.3): an override, a placement on a Kindred aid request (level
 * decision, sub-project 11), or one of the nine inference rules. request_id is
 * that request's record id (reconciliation is per request, by net total, never
 * per decision row); it stays empty until sub-project 11 fills it. The ambiguous
 * level is shown, never split. candidate_program_families lists the families a
 * person- or ambiguous-level row could belong to. flags is a sorted JSON array
 * of the spec §6.6 flags computable from synced data; reversed rows carry none.
 *
 * All five rules are null.
 */
migrate((app) => {
  const collection = new Collection({
    type: "base",
    name: "aid_postings",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: "number", name: "year", required: true, presentable: false, min: 2010, max: 2100, onlyInt: true },
      { type: "number", name: "transaction_cm_id", required: true, presentable: true, min: 1, max: null, onlyInt: true },
      { type: "number", name: "amount", required: false, presentable: false, min: null, max: null, onlyInt: false },
      { type: "number", name: "financial_category_cm_id", required: false, presentable: false, min: null, max: null, onlyInt: true },
      { type: "number", name: "household_cm_id", required: false, presentable: false, min: null, max: null, onlyInt: true },
      { type: "number", name: "person_cm_id", required: false, presentable: false, min: null, max: null, onlyInt: true },
      { type: "bool", name: "is_reversed", required: false, presentable: false },
      { type: "date", name: "post_date", required: false, presentable: false, min: "", max: "" },
      { type: "date", name: "effective_date", required: false, presentable: false, min: "", max: "" },
      { type: "date", name: "reversal_date", required: false, presentable: false, min: "", max: "" },
      { type: "text", name: "transaction_note", required: false, presentable: false, min: 0, max: 5000, pattern: "" },
      { type: "text", name: "source_key", required: true, presentable: false, min: 1, max: 5000, pattern: "" },
      { type: "text", name: "effective_source_key", required: true, presentable: false, min: 1, max: 5000, pattern: "" },
      {
        type: "select",
        name: "source_family",
        required: true,
        presentable: false,
        values: ["camp_fa", "one_happy_camper", "synagogue_federation", "new_israeli", "pj", "jfcs", "jfam_incentive", "named_fund", "other_outside", "application_marker", "placeholder", "unclassified"],
        maxSelect: 1,
      },
      { type: "select", name: "funder_type", required: true, presentable: false, values: ["camp", "outside", "incentive", "unknown"], maxSelect: 1 },
      { type: "bool", name: "counts_toward_budget", required: false, presentable: false },
      { type: "number", name: "attributed_person_cm_id", required: false, presentable: false, min: null, max: null, onlyInt: true },
      { type: "number", name: "attributed_session_cm_id", required: false, presentable: false, min: null, max: null, onlyInt: true },
      { type: "select", name: "program_family", required: false, presentable: false, values: ["summer", "quest", "teen", "bmitzvah", "family_camp", "adult_weekend", "family_school", "other"], maxSelect: 1 },
      { type: "select", name: "attribution_level", required: true, presentable: false, values: ["override", "decision", "session", "person", "program_family", "ambiguous", "none"], maxSelect: 1 },
      {
        type: "select",
        name: "attribution_method",
        required: true,
        presentable: false,
        values: ["override_sheet_2026_match", "override_staff", "decision", "posted_person_single_enrollment", "household_single_camper", "single_person_multi_enrollment", "source_implied", "fa_application_program", "household_single_family", "no_enrollment", "ambiguous"],
        maxSelect: 1,
      },
      { type: "json", name: "candidate_program_families", required: false, presentable: false, maxSize: 2000 },
      { type: "text", name: "request_id", required: false, presentable: false, min: 0, max: 50, pattern: "" },
      { type: "json", name: "flags", required: false, presentable: false, maxSize: 2000 },
      { type: "autodate", name: "created", required: false, presentable: false, onCreate: true, onUpdate: false },
      { type: "autodate", name: "updated", required: false, presentable: false, onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX `idx_aid_postings_txn_amount_year` ON `aid_postings` (`transaction_cm_id`, `amount`, `year`)",
      "CREATE INDEX `idx_aid_postings_year_reversed` ON `aid_postings` (`year`, `is_reversed`)",
      "CREATE INDEX `idx_aid_postings_year_household` ON `aid_postings` (`year`, `household_cm_id`)",
      "CREATE INDEX `idx_aid_postings_year_level` ON `aid_postings` (`year`, `attribution_level`)",
      "CREATE INDEX `idx_aid_postings_year_source` ON `aid_postings` (`year`, `effective_source_key`)",
    ],
  });
  app.save(collection);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("aid_postings"));
});
