/// <reference path="../pb_data/types.d.ts" />
/**
 * aid_reported_history -- the figures finance (and, with Reports Part B, development) already reported before
 * Kindred had the data, typed ONCE, each with its as-of date and marked r on every report (clean spec 5.6, 9.4, 9.5,
 * 9.7; D96, D102, D132, D133; O-930-13's default: this collection, extended with finance's metrics).
 *
 * Dollars and counts only: Kindred computes every percentage. The one exception is the committee's target band per
 * Round 1 phase (finance's own target, typed per season). Which metric may carry which dimension is code
 * (bunking/financial_aid/reports/history.py METRICS), not schema: a new metric needs no migration.
 *
 *   year / view / metric      the season, whose report (finance or development) and which figure
 *   pool / tier / phase       the figure's dimensions; "" and 0 mean the season's total
 *   at / as_of                a dated pull (e.g. the deadline figures a deck showed) or the season's end, and the date
 *   value                     the figure as reported; source and note say where it came from
 *
 * One value per natural key (the unique index): a second load of the same figure corrects it, through 4a with its
 * aid_change_log row. All five rules are null (spec 14.3): only the superuser (FastAPI) reads or writes it.
 */
migrate((app) => {
  const collection = new Collection({
    type: "base",
    name: "aid_reported_history",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: "number", name: "year", required: true, presentable: false, min: 2017, max: 2100, onlyInt: true },
      { type: "select", name: "view", required: true, presentable: true, values: ["finance", "development"], maxSelect: 1 },
      { type: "text", name: "metric", required: true, presentable: true, min: 1, max: 60, pattern: "^[a-z][a-z0-9_]*$" },
      { type: "text", name: "pool", required: false, presentable: false, min: 0, max: 60, pattern: "" },
      { type: "number", name: "tier", required: false, presentable: false, min: 0, max: 50, onlyInt: true },
      { type: "number", name: "phase", required: false, presentable: false, min: 0, max: 3, onlyInt: true },
      { type: "select", name: "at", required: true, presentable: false, values: ["pull", "season_end"], maxSelect: 1 },
      { type: "date", name: "as_of", required: true, presentable: false, min: "", max: "" },
      { type: "number", name: "value", required: false, presentable: false, min: 0, max: null, onlyInt: false },
      { type: "text", name: "source", required: false, presentable: false, min: 0, max: 200, pattern: "" },
      { type: "text", name: "note", required: false, presentable: false, min: 0, max: 2000, pattern: "" },
      { type: "autodate", name: "created", required: false, presentable: false, onCreate: true, onUpdate: false },
      { type: "autodate", name: "updated", required: false, presentable: false, onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX `idx_aid_reported_history_key` ON `aid_reported_history` (`year`, `view`, `metric`, `pool`, `tier`, `phase`, `at`, `as_of`)",
    ],
  });
  app.save(collection);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("aid_reported_history"));
});
