/// <reference path="../pb_data/types.d.ts" />
/**
 * Requests › Form intake (PR 3; owner rulings Q2-A and Q5-A, 2026-10-15).
 *
 * aid_request_additions gains `reviewed_at` / `reviewed_by`: Mark Reviewed on a request the dashboard made from a
 * registration ask (source "registration_ask") takes it out of Form intake's Needs a look. Set once, by a person with
 * casework, and logged like every aid_* write. Empty on a staff addition and on a rule-made one nobody has reviewed.
 *
 * aid_decisions.lock_source gains "campminder_added": the Round 1 Add a Request… records, in the same operation that
 * makes the request, at the camp aid CampMinder already posted on that family x session with no request ("Record
 * CampMinder's $X as Round 1, posted"). Unlike the 2026 sheet load's "campminder_only" it is not read-only: Undo
 * Posted works on it.
 *
 * All five rules stay null (spec 14.3): only the superuser (FastAPI) reads or writes either collection.
 */
migrate((app) => {
  const additions = app.findCollectionByNameOrId("aid_request_additions");
  additions.fields.add(new Field({ type: "date", name: "reviewed_at", required: false, presentable: false, min: "", max: "" }));
  additions.fields.add(new Field({ type: "text", name: "reviewed_by", required: false, presentable: false, min: 0, max: 200, pattern: "" }));
  app.save(additions);

  const decisions = app.findCollectionByNameOrId("aid_decisions");
  decisions.fields.getByName("lock_source").values = ["tick", "ledger", "placement", "reproduced", "campminder_only", "campminder_added"];
  app.save(decisions);
}, (app) => {
  // Rolling back strands any campminder_added row (its lock_source no longer validates): undo those rounds first.
  const decisions = app.findCollectionByNameOrId("aid_decisions");
  decisions.fields.getByName("lock_source").values = ["tick", "ledger", "placement", "reproduced", "campminder_only"];
  app.save(decisions);

  const additions = app.findCollectionByNameOrId("aid_request_additions");
  additions.fields.removeByName("reviewed_at");
  additions.fields.removeByName("reviewed_by");
  app.save(additions);
});
