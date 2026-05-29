/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: add break_glass_used to solver_runs
 *
 * Stream D of the solver redesign. When the break-glass fallback fires
 * (relaxing the request layer to ensure every camper is placed), the result
 * carries break_glass_used=true. Persisting it lets the frontend render the
 * "compromise" banner and lets admins surface which historical runs required
 * the break-glass path.
 */

migrate((app) => {
  const collection = app.findCollectionByNameOrId("solver_runs");

  // True when the solver placed every camper by relaxing the request layer
  // (break-glass fallback). False on a clean solve. Populated by
  // DirectBunkingSolver.solve on success.
  collection.fields.add(new Field({
    type: "bool",
    name: "break_glass_used",
    required: false,
    presentable: false,
  }));

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("solver_runs");

  collection.fields.removeByName("break_glass_used");

  app.save(collection);
});
