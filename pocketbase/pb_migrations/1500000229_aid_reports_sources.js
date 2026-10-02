/// <reference path="../pb_data/types.d.ts" />
/**
 * Reports back end, Part C (clean spec 9.4; D88, D100):
 *
 * aid_sources.incentive -- the per-source incentive-or-need fact (D88): a source flagged incentive (a grant given
 *   for years at camp, not need) shows as an "incentive grants" detail line in development's report, never the
 *   headline. It is NOT funder_type: an incentive-flagged outside source stays funder_type "outside", so the
 *   calculator and commitment fulfilment read it as before. Additive: every source reads false (need-based) until
 *   development or finance sets it in Funding sources.
 *
 * aid_report_definitions -- a report's saved settings, one row per report (`report`, e.g. "development"):
 *   `columns` is development's dated columns, a JSON list of {season, as_of} (a query over dated records, never a
 *   frozen copy). Written through FastAPI with its aid_change_log row; all five rules null (spec 14.3).
 */
migrate((app) => {
  const sources = app.findCollectionByNameOrId("aid_sources");
  sources.fields.add(new Field({ type: "bool", name: "incentive", required: false, presentable: false }));
  app.save(sources);

  const definitions = new Collection({
    type: "base",
    name: "aid_report_definitions",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: "text", name: "report", required: true, presentable: true, min: 1, max: 60, pattern: "^[a-z][a-z0-9_-]*$" },
      { type: "json", name: "columns", required: false, presentable: false, maxSize: 20000 },
      { type: "autodate", name: "created", required: false, presentable: false, onCreate: true, onUpdate: false },
      { type: "autodate", name: "updated", required: false, presentable: false, onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX `idx_aid_report_definitions_report` ON `aid_report_definitions` (`report`)"],
  });
  app.save(definitions);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("aid_report_definitions"));
  const sources = app.findCollectionByNameOrId("aid_sources");
  sources.fields.removeByName("incentive");
  app.save(sources);
});
