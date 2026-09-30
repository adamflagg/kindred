/// <reference path="../pb_data/types.d.ts" />
/**
 * aid_decisions -- every round's asks and decisions, request x round, as dated events
 * (campership sub-project 10a; spec 5.1-5.3, 7.1; D41-D43, D50-D53, D79, D82, D91).
 *
 * APPEND-ONLY. A row is one event on one request's round and is never edited or deleted.
 * A round's state is the fold of its rows in the order they were recorded
 * (bunking/financial_aid/decisions/rounds.py), so its state on any past date is the fold
 * of the rows created by then (D63).
 *
 *   ask      the family's ask for Round 2 or 3, keyed when it arrives, before anything is
 *            decided (D91, D82). effective_on = the day the family asked. Round 3's carries
 *            its statement of need. Round 1's ask is aid_requests.ask (intake), with its
 *            dated corrections.
 *   award    a staff-decided amount: a Round 3 amount (decision_type "") or a named
 *            discretionary amount (decision_type = its key). needs_approval: keyed above the
 *            registrar's limit by someone without finance's permission, so it waits as
 *            "Pending approval" (D79).
 *   approve / refuse    finance's answer to a pending Round 3 amount.
 *   post     the Posted tick and the lock (D51, D52): amount = the decided amount it locked;
 *            snapshot = the calculator's inputs and result; rules_version = the version that
 *            priced it; lock_source = tick (the registrar) or ledger (sub-project 10b's
 *            automatic tick, D78); effective_on = the day it was posted.
 *   unpost   a mistaken tick undone (the reason is the note).
 *   accept / unaccept   the Accepted tick (D47: it has no ledger meaning).
 *
 * amount is positive dollars, and 0 is a real $0 decision; events that carry no amount leave
 * it unset. No unique index: a round has many rows by design. All five rules are null (spec
 * 14.3): only the superuser (FastAPI) reads or writes it.
 */
migrate((app) => {
  const requests = app.findCollectionByNameOrId("aid_requests");
  const collection = new Collection({
    type: "base",
    name: "aid_decisions",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: "number", name: "year", required: true, presentable: false, min: 2017, max: 2100, onlyInt: true },
      { type: "relation", name: "request", required: true, presentable: false, collectionId: requests.id, cascadeDelete: false, minSelect: null, maxSelect: 1 },
      { type: "number", name: "round", required: true, presentable: false, min: 1, max: 3, onlyInt: true },
      { type: "select", name: "event", required: true, presentable: true, values: ["ask", "award", "approve", "refuse", "post", "unpost", "accept", "unaccept"], maxSelect: 1 },
      { type: "number", name: "amount", required: false, presentable: false, min: 0, max: null, onlyInt: false },
      { type: "date", name: "effective_on", required: false, presentable: false, min: "", max: "" },
      { type: "text", name: "statement_of_need", required: false, presentable: false, min: 0, max: 4000, pattern: "" },
      { type: "text", name: "decision_type", required: false, presentable: false, min: 0, max: 64, pattern: "^([a-z][a-z0-9_]*)?$" },
      { type: "bool", name: "needs_approval", required: false, presentable: false },
      { type: "select", name: "lock_source", required: false, presentable: false, values: ["tick", "ledger"], maxSelect: 1 },
      { type: "number", name: "rules_version", required: false, presentable: false, min: 0, max: null, onlyInt: true },
      { type: "json", name: "snapshot", required: false, presentable: false, maxSize: 500000 },
      { type: "text", name: "note", required: false, presentable: false, min: 0, max: 2000, pattern: "" },
      { type: "text", name: "actor", required: true, presentable: false, min: 1, max: 200, pattern: "" },
      { type: "autodate", name: "created", required: false, presentable: false, onCreate: true, onUpdate: false },
    ],
    indexes: [
      "CREATE INDEX `idx_aid_decisions_request_round` ON `aid_decisions` (`request`, `round`)",
      "CREATE INDEX `idx_aid_decisions_year_event` ON `aid_decisions` (`year`, `event`)",
    ],
  });
  app.save(collection);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("aid_decisions"));
});
