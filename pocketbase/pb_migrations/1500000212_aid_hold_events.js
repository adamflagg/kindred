/// <reference path="../pb_data/types.d.ts" />
/**
 * aid_hold_events -- holds released and manual holds placed, per request, as dated events
 * (campership follow-up 3b; app spec 4.4, 4.6, 6.3; main spec 10.2, 10.5, 14.4; D15, D22).
 *
 * APPEND-ONLY. A row is one event on one request and is never edited or deleted. A request's
 * hold state is the fold of its rows in the order they were recorded
 * (bunking/financial_aid/decisions/holds.py), so its state on any past date is the fold of the
 * rows created by then (D15, main spec 14.4; the as-of reads, follow-up 3c).
 *
 *   release    a check's hold released with a note (code = the check's code): it no longer
 *              stops the award. It stands until un-released. `fact` records what it was released
 *              against (the check's message and step, and the application figures the checks
 *              read), so a later rule can let a release lapse when those change (3b Decision 3).
 *   unrelease  that release withdrawn: the check holds again while it fires.
 *   place      the request put on hold by hand ("Put on hold...", code = manual_hold); the note
 *              is its reason ("waiting on something" is a hold, not a stage, main spec 10.2).
 *   lift       the manual hold lifted; the note says why.
 *
 * A hold is request-level: it stops every round not yet posted. The note is required on every
 * event (app spec 4.6; main spec 14.4). No unique index: a request's code has many rows by
 * design. All five rules are null (spec 14.3): only the superuser (FastAPI) reads or writes it.
 */
migrate((app) => {
  const requests = app.findCollectionByNameOrId("aid_requests");
  const collection = new Collection({
    type: "base",
    name: "aid_hold_events",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: "number", name: "year", required: true, presentable: false, min: 2017, max: 2100, onlyInt: true },
      { type: "relation", name: "request", required: true, presentable: false, collectionId: requests.id, cascadeDelete: false, minSelect: null, maxSelect: 1 },
      { type: "select", name: "event", required: true, presentable: true, values: ["release", "unrelease", "place", "lift"], maxSelect: 1 },
      { type: "text", name: "code", required: true, presentable: false, min: 1, max: 64, pattern: "^[a-z][a-z0-9_]*$" },
      { type: "text", name: "note", required: true, presentable: false, min: 1, max: 2000, pattern: "" },
      { type: "json", name: "fact", required: false, presentable: false, maxSize: 200000 },
      { type: "text", name: "actor", required: true, presentable: false, min: 1, max: 200, pattern: "" },
      { type: "autodate", name: "created", required: false, presentable: false, onCreate: true, onUpdate: false },
    ],
    indexes: [
      "CREATE INDEX `idx_aid_hold_events_request_code` ON `aid_hold_events` (`request`, `code`)",
      "CREATE INDEX `idx_aid_hold_events_year_created` ON `aid_hold_events` (`year`, `created`)",
    ],
  });
  app.save(collection);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("aid_hold_events"));
});
