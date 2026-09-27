/// <reference path="../pb_data/types.d.ts" />
/**
 * aid_payer_shares -- who pays the family's part of a request, and so where its
 * aid is posted (campership sub-project 5; spec 5 and 9.2; owner ruling
 * 2026-09-25).
 *
 * One request (one per person per session, or per household per session for
 * family camp) carries one or more shares. Each share is a CampMinder household
 * and a PERCENTAGE, nothing else (owner ruling 2026-09-25): there is no dollar
 * column. The usual case is one share of 100% for the application's household,
 * which intake creates (`source` = intake_default). Separated parents who each
 * pay get one share each (`source` = staff). A request's shares must add to
 * exactly 100% (api/services/financial_aid_payer_shares.py); otherwise it holds.
 *
 * The award is priced once, on the application the request belongs to; shares
 * only decide who is posted what. Dollars are never stored: they are computed
 * from the current award wherever a share is shown (whole dollars, any remainder
 * dollar to the application's own household), so an appeal or a top-up
 * recomputes them while the percentages stay. Sub-project 11 lists one posting
 * line per share and reconciles each share against its household's postings.
 *
 * `household_cm_id` is a CampMinder id (the CampMinder-id rule holds for every
 * aid table). All five rules are null (spec 14.3).
 */

migrate((app) => {
  const requests = app.findCollectionByNameOrId("aid_requests");
  const collection = new Collection({
    type: "base",
    name: "aid_payer_shares",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: "number", name: "year", required: true, presentable: false, min: 2017, max: 2100, onlyInt: true },
      { type: "relation", name: "request", required: true, presentable: false, collectionId: requests.id, cascadeDelete: false, minSelect: null, maxSelect: 1 },
      { type: "number", name: "household_cm_id", required: true, presentable: true, min: 1, max: null, onlyInt: true },
      { type: "number", name: "share_pct", required: true, presentable: false, min: 0, max: 100, onlyInt: false },
      { type: "select", name: "source", required: true, presentable: false, values: ["intake_default", "staff"], maxSelect: 1 },
      { type: "text", name: "actor", required: true, presentable: false, min: 1, max: 200, pattern: "" },
      { type: "text", name: "note", required: false, presentable: false, min: 0, max: 2000, pattern: "" },
      { type: "autodate", name: "created", required: false, presentable: false, onCreate: true, onUpdate: false },
      { type: "autodate", name: "updated", required: false, presentable: false, onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX `idx_aid_payer_shares_request_household` ON `aid_payer_shares` (`request`, `household_cm_id`)",
      "CREATE INDEX `idx_aid_payer_shares_year` ON `aid_payer_shares` (`year`)",
    ],
  });
  app.save(collection);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("aid_payer_shares"));
});
