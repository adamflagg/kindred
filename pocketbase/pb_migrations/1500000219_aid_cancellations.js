/// <reference path="../pb_data/types.d.ts" />
/**
 * aid_cancellations -- a request's cancel reason and its cancellation in Kindred, as dated events
 * (campership sub-project 10b-2; clean spec 5.3, 6.2, 6.3; main spec 10.5 as amended; D54, D101, D141).
 *
 * APPEND-ONLY and request-level. A row is never edited or deleted; the latest row wins, so the
 * state on any past date is the rows created by then.
 *
 *   cancel   the registrar records the reason, one of D141's nine (amending D101's three):
 *              aid_not_enough           "declined: aid not enough / financial constraints" (Development counts it)
 *              medical
 *              schedule
 *              not_ready
 *              did_not_want_to_appeal
 *              not_financially_related
 *              early_cancel
 *              another_reason           with a note
 *              not_known
 *            in_kindred = true: Kindred's own cancellation stands (the family declined, or no longer
 *            wants aid, while the camper was enrolled in CampMinder). It stays true when the reason is
 *            edited after CampMinder also cancelled, so a later re-enrolment does not bring the request
 *            back. false only gives the reason for an enrollment CampMinder cancelled, which Kindred
 *            reads from attendees.
 *   reopen   a Kindred cancellation undone; the note says why. It clears the reason.
 *
 * A cancelled request with no reason carries "Cancelled: give a reason", a to-do, never a hold.
 * All five rules are null (spec 14.3): only the superuser (FastAPI) reads or writes it.
 */
migrate((app) => {
  const requests = app.findCollectionByNameOrId("aid_requests");
  const collection = new Collection({
    type: "base",
    name: "aid_cancellations",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: "number", name: "year", required: true, presentable: false, min: 2017, max: 2100, onlyInt: true },
      { type: "relation", name: "request", required: true, presentable: false, collectionId: requests.id, cascadeDelete: false, minSelect: null, maxSelect: 1 },
      { type: "select", name: "event", required: true, presentable: true, values: ["cancel", "reopen"], maxSelect: 1 },
      { type: "select", name: "reason", required: false, presentable: false, values: ["aid_not_enough", "medical", "schedule", "not_ready", "did_not_want_to_appeal", "not_financially_related", "early_cancel", "another_reason", "not_known"], maxSelect: 1 },
      { type: "bool", name: "in_kindred", required: false, presentable: false },
      { type: "text", name: "note", required: false, presentable: false, min: 0, max: 2000, pattern: "" },
      { type: "text", name: "actor", required: true, presentable: false, min: 1, max: 200, pattern: "" },
      { type: "autodate", name: "created", required: false, presentable: false, onCreate: true, onUpdate: false },
    ],
    indexes: [
      "CREATE INDEX `idx_aid_cancellations_request` ON `aid_cancellations` (`request`)",
      "CREATE INDEX `idx_aid_cancellations_year` ON `aid_cancellations` (`year`)",
    ],
  });
  app.save(collection);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("aid_cancellations"));
});
