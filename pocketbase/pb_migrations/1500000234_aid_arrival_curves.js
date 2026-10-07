/// <reference path="../pb_data/types.d.ts" />
/**
 * aid_arrival_curves: Camperships Scenarios' arrival curve (addendum §S11.7; owner §S15 item 1).
 *
 * One row per season: the cumulative share of that season's applications in by the end of each week, counted in
 * weeks from its approved application deadline (or from Jan 1, "calendar", for a year with none). `points` is
 * [{week, share}] with shares as decimal strings; `counted` is how many applications made it. Aggregates only: no
 * family data, no names, no row-level timestamp. 2026's row is a one-off load by
 * scripts/financial_aid/load_arrival_curve.py (run by the owner's prod agent, never in CD); from 2027 on the
 * scenarios service computes the curve from the dashboard's own received dates.
 *
 * ALL FIVE RULES ARE NULL (spec 14.3), as on every aid_ collection: FastAPI's superuser client behind
 * financial_aid.rules reads it, and the loader writes it through the superuser client. No relation and no
 * CampMinder or PocketBase id, so the CampMinder-ID cross-table rule has nothing to apply to. Field properties are
 * direct: v0.23 silently ignores an options wrapper.
 */
migrate((app) => {
  const curves = new Collection({
    type: "base",
    name: "aid_arrival_curves",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: "number", name: "year", required: true, presentable: true, min: 2017, max: 2100, onlyInt: true },
      { type: "select", name: "source", required: true, presentable: false, values: ["workbook", "received"], maxSelect: 1 },
      { type: "select", name: "aligned_on", required: true, presentable: false, values: ["application_deadline", "calendar"], maxSelect: 1 },
      { type: "text", name: "anchor", required: true, presentable: false, min: 10, max: 10, pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" },
      { type: "json", name: "points", required: false, presentable: false, maxSize: 20000 },
      { type: "number", name: "counted", required: true, presentable: false, min: 1, max: null, onlyInt: true },
      { type: "text", name: "actor", required: true, presentable: false, min: 1, max: 200, pattern: "" },
      { type: "autodate", name: "created", required: false, presentable: false, onCreate: true, onUpdate: false },
      { type: "autodate", name: "updated", required: false, presentable: false, onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX `idx_aid_arrival_curves_year` ON `aid_arrival_curves` (`year`)"],
  });
  app.save(curves);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("aid_arrival_curves"));
});
