/// <reference path="../pb_data/types.d.ts" />
/**
 * The adult aid Google Form's requests (adult-aid form design PR 2; owner and registrar answers 2026-10-29).
 *
 * aid_requests gains its OWN answer set (GF-2 = B: "separate payment, separate FA application"). A request intake
 * makes from an adult aid form response carries the response's figures in `answers` (the household answers' shape,
 * the same keys as aid_applications.answers, an unread figure null: unknown, never 0), `answers_source`
 * "google_form", and the response it applied (`form_response_id`, Google's responseId; `form_submitted_at`, its
 * lastSubmittedTime verbatim as RFC 3339 text). Pricing then reads that set in place of the household application's,
 * and the application's income_conflict never holds the request. Every other request leaves all four empty and is
 * priced exactly as before. Intake writes them, logged through commit_aid_writes like every intake field.
 *
 * `form_change_reviewed` / `_by` / `_at`: Mark Reviewed (owner Q2) on a request whose response changed or was deleted
 * in Google after a decision (GF-4: flagged, not applied). It holds the fingerprint of the change staff reviewed, so
 * the look stays cleared until a different change arrives. Staff's fields: intake never writes them.
 *
 * aid_form_responses (PR 1, 1500000255) gains `ignored_by` / `ignored_at` beside its `ignored_reason`: an ignored
 * response is listed with why, who and when (owner Q3), and Link… undoes it.
 *
 * All five rules stay null (spec 14.3): only the superuser (FastAPI) reads or writes either collection. Field
 * properties are direct (never an options wrapper, which v0.23 ignores silently).
 */
migrate((app) => {
  const requests = app.findCollectionByNameOrId("aid_requests");
  requests.fields.add(new Field({ type: "json", name: "answers", required: false, presentable: false, maxSize: 20000 }));
  requests.fields.add(new Field({ type: "select", name: "answers_source", required: false, presentable: false, values: ["google_form"], maxSelect: 1 }));
  requests.fields.add(new Field({ type: "text", name: "form_response_id", required: false, presentable: false, min: 0, max: 200, pattern: "" }));
  requests.fields.add(new Field({ type: "text", name: "form_submitted_at", required: false, presentable: false, min: 0, max: 40, pattern: "" }));
  requests.fields.add(new Field({ type: "text", name: "form_change_reviewed", required: false, presentable: false, min: 0, max: 300, pattern: "" }));
  requests.fields.add(new Field({ type: "text", name: "form_change_reviewed_by", required: false, presentable: false, min: 0, max: 200, pattern: "" }));
  requests.fields.add(new Field({ type: "date", name: "form_change_reviewed_at", required: false, presentable: false, min: "", max: "" }));
  app.save(requests);

  const responses = app.findCollectionByNameOrId("aid_form_responses");
  responses.fields.add(new Field({ type: "text", name: "ignored_by", required: false, presentable: false, min: 0, max: 200, pattern: "" }));
  responses.fields.add(new Field({ type: "date", name: "ignored_at", required: false, presentable: false, min: "", max: "" }));
  app.save(responses);
}, (app) => {
  const responses = app.findCollectionByNameOrId("aid_form_responses");
  responses.fields.removeByName("ignored_by");
  responses.fields.removeByName("ignored_at");
  app.save(responses);

  const requests = app.findCollectionByNameOrId("aid_requests");
  for (const name of [
    "answers",
    "answers_source",
    "form_response_id",
    "form_submitted_at",
    "form_change_reviewed",
    "form_change_reviewed_by",
    "form_change_reviewed_at",
  ]) {
    requests.fields.removeByName(name);
  }
  app.save(requests);
});
