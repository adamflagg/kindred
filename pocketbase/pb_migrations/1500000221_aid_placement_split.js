/// <reference path="../pb_data/types.d.ts" />
/**
 * Money > To place (campership SP11-rest; clean spec §8.1; D12, D81).
 *
 * aid_attribution_overrides.split -- a line the registrar split across requests (D12: "Kindred proposes a
 * placement or a split"). A JSON list of parts, each {person_cm_id, session_cm_id, program_family, amount},
 * named the way a placement names a request; the amounts are exact strings and add up to the line. A split
 * override places nothing at the person/session level (both 0, program ""), so Go's attribution treats it as
 * it treats a reclassify-only override (aid_attribution.go `places()`), and FastAPI's reconciliation places
 * each part on its own request. Empty on every existing row: they place or reclassify a line whole.
 *
 * aid_decisions.lock_source gains "placement" -- the Posted tick a registrar's placement makes (D81: the
 * placement ticks the rounds it lands on). Like the ledger's own tick it is made from money already in
 * CampMinder, so it never reads "awaiting tonight's sync" (FastAPI's FROM_THE_LEDGER).
 *
 * Additive. Both collections stay superuser-only: no rule changes (spec §14.3).
 */
migrate((app) => {
  const overrides = app.findCollectionByNameOrId("aid_attribution_overrides");
  overrides.fields.add(new Field({ type: "json", name: "split", required: false, presentable: false, maxSize: 20000 }));
  app.save(overrides);

  const decisions = app.findCollectionByNameOrId("aid_decisions");
  decisions.fields.getByName("lock_source").values = ["tick", "ledger", "placement"];
  app.save(decisions);
}, (app) => {
  // Rolling back strands any placement tick (its lock_source no longer validates) and every split
  // (each line falls back to family level): roll the FastAPI code back with it.
  const decisions = app.findCollectionByNameOrId("aid_decisions");
  decisions.fields.getByName("lock_source").values = ["tick", "ledger"];
  app.save(decisions);

  const overrides = app.findCollectionByNameOrId("aid_attribution_overrides");
  overrides.fields.removeByName("split");
  app.save(overrides);
});
