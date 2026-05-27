/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Add trigger + session_breakdown to debug_pipeline_runs
 *
 * trigger: select field (upload | scheduled | manual) — identifies what initiated the run.
 * session_breakdown: json field — per-session map of status counts, populated by Python trace collector.
 */

migrate((app) => {
  const collection = app.findCollectionByNameOrId("debug_pipeline_runs");

  collection.fields.add(new Field({
    type: "select",
    name: "trigger",
    required: false,
    presentable: false,
    values: ["upload", "scheduled", "manual"],
    maxSelect: 1,
  }));

  collection.fields.add(new Field({
    type: "json",
    name: "session_breakdown",
    required: false,
    presentable: false,
    maxSize: 200000,
  }));

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("debug_pipeline_runs");

  collection.fields.removeByName("trigger");
  collection.fields.removeByName("session_breakdown");

  app.save(collection);
});
