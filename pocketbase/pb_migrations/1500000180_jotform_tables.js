/// <reference path="../pb_data/types.d.ts" />
/**
 * jotform_forms + jotform_submissions + jotform_answers (kindred#2759).
 *
 * Adult-weekend guests say who they want to room with ONLY on the program's
 * Jotform -- no CampMinder adult field asks it. These tables hold the pull.
 *
 * ── STORE EVERYTHING, GENERICALLY (owner ruling 2026-09-24) ────────────────
 * Every answered question is synced, one row per submission per question,
 * the way the CampMinder sync keeps every custom-field value. There is NO PHI
 * gate and NO allowlist: `bunking.manage` gates all three tables here, and every
 * FastAPI read of them must re-check it. Question ids change every year (each
 * year's form is a new form), so nothing here names a question:
 * `jotform_forms.field_map` maps a ROLE ("bunking_request") to that form's
 * question id, set per form in admin.
 *
 * ── IDS ────────────────────────────────────────────────────────────────────
 * Relationships to the rest of Kindred use CampMinder ids (`person_cm_id`,
 * `session_cm_id`), never PocketBase ids. The two PB relations below are
 * internal to these tables (submission -> form, answer -> submission).
 * `person_cm_id` 0 means "not matched": a required number field rejects 0, so
 * it is not required.
 *
 * ── TIMESTAMPS ARE JOTFORM'S STRINGS ───────────────────────────────────────
 * `submitted_at` / `updated_at` hold Jotform's own "YYYY-MM-DD HH:MM:SS" in
 * the account's local time, verbatim. A date field would need a timezone
 * conversion nobody has ruled on; the strings sort correctly as text.
 *
 * ── DELETION ───────────────────────────────────────────────────────────────
 * A submission deleted on Jotform is MARKED (`jotform_status = 'DELETED'`),
 * never hard-deleted, and only after a COMPLETE pull no longer returns it.
 * The two relations deliberately differ. `answer -> submission` cascades, so
 * dropping a submission takes its answers. `submission -> form` is required
 * and does NOT cascade, so PocketBase REFUSES to delete a form that has any
 * submission ("part of a required relation reference"). That refusal is the
 * point: a form is retired by clearing `enabled`, never by deleting it, and a
 * delete would otherwise take every staff link with it.
 *
 * Field properties are direct (never inside an options wrapper, which v0.23
 * ignores silently). Writes are superuser-only: the Go sync and FastAPI's
 * superuser client are the only writers.
 */

const BUNKING_MANAGE =
  '@request.auth.is_admin = true || @request.auth.cached_permissions ~ "bunking.manage"';

migrate((app) => {
  const forms = new Collection({
    type: "base",
    name: "jotform_forms",
    listRule: BUNKING_MANAGE,
    viewRule: BUNKING_MANAGE,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: "number", name: "year", required: true, presentable: false, min: 2000, max: 2100, onlyInt: true },
      { type: "number", name: "session_cm_id", required: true, presentable: false, min: 1, max: null, onlyInt: true },
      { type: "text", name: "form_id", required: true, presentable: true, min: 1, max: 32, pattern: "^[0-9]+$" },
      { type: "json", name: "field_map", required: false, presentable: false, maxSize: 20000 },
      { type: "bool", name: "enabled", required: false, presentable: false },
      { type: "date", name: "last_pulled_at", required: false, presentable: false, min: "", max: "" },
      { type: "text", name: "last_pull_status", required: false, presentable: false, min: 0, max: 2000, pattern: "" },
      { type: "autodate", name: "created", required: false, presentable: false, onCreate: true, onUpdate: false },
      { type: "autodate", name: "updated", required: false, presentable: false, onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX `idx_jotform_forms_year_session` ON `jotform_forms` (`year`, `session_cm_id`)",
    ],
  });
  app.save(forms);
  const formsId = app.findCollectionByNameOrId("jotform_forms").id;

  const submissions = new Collection({
    type: "base",
    name: "jotform_submissions",
    listRule: BUNKING_MANAGE,
    viewRule: BUNKING_MANAGE,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: "text", name: "submission_id", required: true, presentable: true, min: 1, max: 32, pattern: "^[0-9]+$" },
      { type: "relation", name: "form", required: true, presentable: false, collectionId: formsId, cascadeDelete: false, minSelect: null, maxSelect: 1 },
      { type: "number", name: "year", required: true, presentable: false, min: 2000, max: 2100, onlyInt: true },
      { type: "number", name: "session_cm_id", required: true, presentable: false, min: 1, max: null, onlyInt: true },
      { type: "text", name: "submitted_at", required: true, presentable: false, min: 1, max: 32, pattern: "" },
      { type: "text", name: "updated_at", required: false, presentable: false, min: 0, max: 32, pattern: "" },
      { type: "text", name: "jotform_status", required: false, presentable: false, min: 0, max: 32, pattern: "" },
      { type: "number", name: "person_cm_id", required: false, presentable: false, min: 0, max: null, onlyInt: true },
      { type: "select", name: "match_status", required: true, presentable: false, values: ["auto", "staff", "unmatched", "ignored"], maxSelect: 1 },
      { type: "number", name: "match_tier", required: false, presentable: false, min: 0, max: 3, onlyInt: true },
      { type: "text", name: "linked_by", required: false, presentable: false, min: 0, max: 200, pattern: "" },
      { type: "date", name: "linked_at", required: false, presentable: false, min: "", max: "" },
      { type: "autodate", name: "created", required: false, presentable: false, onCreate: true, onUpdate: false },
      { type: "autodate", name: "updated", required: false, presentable: false, onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX `idx_jotform_submissions_submission_id` ON `jotform_submissions` (`submission_id`)",
      "CREATE INDEX `idx_jotform_submissions_year_session` ON `jotform_submissions` (`year`, `session_cm_id`)",
      "CREATE INDEX `idx_jotform_submissions_person_year` ON `jotform_submissions` (`person_cm_id`, `year`)",
    ],
  });
  app.save(submissions);
  const submissionsId = app.findCollectionByNameOrId("jotform_submissions").id;

  const answers = new Collection({
    type: "base",
    name: "jotform_answers",
    listRule: BUNKING_MANAGE,
    viewRule: BUNKING_MANAGE,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: "relation", name: "submission", required: true, presentable: false, collectionId: submissionsId, cascadeDelete: true, minSelect: null, maxSelect: 1 },
      { type: "text", name: "question_id", required: true, presentable: false, min: 1, max: 16, pattern: "" },
      { type: "text", name: "question_text", required: false, presentable: false, min: 0, max: 5000, pattern: "" },
      { type: "text", name: "question_type", required: false, presentable: false, min: 0, max: 64, pattern: "" },
      { type: "text", name: "answer_text", required: false, presentable: false, min: 0, max: 100000, pattern: "" },
      { type: "json", name: "answer_json", required: false, presentable: false, maxSize: 200000 },
      { type: "number", name: "order", required: false, presentable: false, min: null, max: null, onlyInt: true },
      { type: "autodate", name: "created", required: false, presentable: false, onCreate: true, onUpdate: false },
      { type: "autodate", name: "updated", required: false, presentable: false, onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX `idx_jotform_answers_submission_question` ON `jotform_answers` (`submission`, `question_id`)",
    ],
  });
  app.save(answers);
}, (app) => {
  for (const name of ["jotform_answers", "jotform_submissions", "jotform_forms"]) {
    const col = app.findCollectionByNameOrId(name);
    app.delete(col);
  }
});
