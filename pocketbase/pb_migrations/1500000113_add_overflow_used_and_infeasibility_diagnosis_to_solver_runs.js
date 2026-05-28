/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: add overflow_used + infeasibility_diagnosis to solver_runs
 *
 * Stream C of the overflow redesign. The smart orchestrator now auto-runs
 * pass 2 with overflow when pass 1 (strict 12-cap) is INFEASIBLE. When pass 2
 * runs, the result carries an overflow_used count (number of bunks at 13).
 * When pass 2 can't help, an infeasibility_diagnosis string carries the
 * actionable message for staff (e.g., "Locked group G spans 36 months —
 * split or override").
 *
 * Persisting both lets the frontend render the post-solve banner / error
 * inline and the admin UI surface overflow usage trends over time.
 */

migrate((app) => {
  const collection = app.findCollectionByNameOrId("solver_runs");

  // Number of bunks the solver placed at 13-capacity (>12). 0 means a clean
  // 12-cap solve. Populated by DirectBunkingSolver.solve on success.
  collection.fields.add(new Field({
    type: "number",
    name: "overflow_used",
    required: false,
    presentable: false,
    min: 0,
    max: null,
    onlyInt: true,
  }));

  // Actionable diagnostic message when the solver returned INFEASIBLE. Empty
  // when the solver succeeded.
  collection.fields.add(new Field({
    type: "text",
    name: "infeasibility_diagnosis",
    required: false,
    presentable: false,
    min: 0,
    max: 0, // text: 0 = unlimited
    pattern: "",
  }));

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("solver_runs");

  collection.fields.removeByName("overflow_used");
  collection.fields.removeByName("infeasibility_diagnosis");

  app.save(collection);
});
