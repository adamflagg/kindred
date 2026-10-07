/// <reference path="../pb_data/types.d.ts" />
/**
 * aid_decisions.lock_source gains "reproduced" -- a round the 2026 decision-year load wrote (D67 as amended by
 * D145; scripts/financial_aid/load_2026_decisions.py). 2026 never ticked in Kindred: its rounds are reproduced from
 * the repaired sheet, posted at CampMinder's money (owner, 2026-10-07), read-only, and their receipt reads
 * "2026, reproduced from the repaired sheet" (FastAPI's REPRODUCED).
 *
 * Additive: the select gains one value; no row changes. The collection stays superuser-only (spec 14.3).
 */
migrate((app) => {
  const decisions = app.findCollectionByNameOrId("aid_decisions");
  decisions.fields.getByName("lock_source").values = ["tick", "ledger", "placement", "reproduced"];
  app.save(decisions);
}, (app) => {
  // Rolling back strands every reproduced row (its lock_source no longer validates): delete the load's rows first
  // (actor "system:2026-sheet-load"), and roll the FastAPI code back with it.
  const decisions = app.findCollectionByNameOrId("aid_decisions");
  decisions.fields.getByName("lock_source").values = ["tick", "ledger", "placement"];
  app.save(decisions);
});
