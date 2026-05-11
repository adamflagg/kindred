/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create debug pipeline collections (runs, traces, summaries)
 * Dependencies: original_bunk_requests, bunk_requests
 *
 * Three collections for the pipeline debug tool:
 * - debug_pipeline_runs: one record per processing run with metadata
 * - debug_pipeline_traces: full JSON trace per original_bunk_request per run
 * - debug_pipeline_summary: flat columns per bunk_request for batch filtering
 */

const COL_ID_RUNS = "col_debug_pipe_runs";
const COL_ID_TRACES = "col_debug_pipe_traces";
const COL_ID_SUMMARY = "col_debug_pipe_summary";

migrate((app) => {
  const originalRequestsCol = app.findCollectionByNameOrId("original_bunk_requests");
  const bunkRequestsCol = app.findCollectionByNameOrId("bunk_requests");

  // --- debug_pipeline_runs ---
  const runsCol = new Collection({
    id: COL_ID_RUNS,
    type: "base",
    name: "debug_pipeline_runs",
    listRule: '@request.auth.is_admin = true',
    viewRule: '@request.auth.is_admin = true',
    createRule: '@request.auth.collectionName = "_superusers"',
    updateRule: '@request.auth.collectionName = "_superusers"',
    deleteRule: '@request.auth.collectionName = "_superusers"',
    fields: [
      { type: "text", name: "run_id", required: true },
      { type: "number", name: "year", required: true },
      { type: "text", name: "session", required: false },
      { type: "json", name: "source_fields", required: false, maxSize: 5000 },
      { type: "number", name: "limit_param", required: false },
      { type: "bool", name: "force", required: false },
      { type: "number", name: "trace_count", required: false },
      { type: "json", name: "status_breakdown", required: false, maxSize: 5000 },
      { type: "bool", name: "pinned", required: false },
      { type: "autodate", name: "created", onCreate: true, onUpdate: false },
      { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_debug_runs_run_id ON debug_pipeline_runs (run_id)",
    ],
  });
  app.save(runsCol);

  // --- debug_pipeline_traces ---
  const tracesCol = new Collection({
    id: COL_ID_TRACES,
    type: "base",
    name: "debug_pipeline_traces",
    listRule: '@request.auth.is_admin = true',
    viewRule: '@request.auth.is_admin = true',
    createRule: '@request.auth.collectionName = "_superusers"',
    updateRule: '@request.auth.collectionName = "_superusers"',
    deleteRule: '@request.auth.collectionName = "_superusers"',
    fields: [
      { type: "text", name: "run_id", required: true },
      {
        type: "relation", name: "original_request",
        required: false, collectionId: originalRequestsCol.id,
        cascadeDelete: false, maxSelect: 1,
      },
      { type: "number", name: "requester_cm_id", required: false },
      { type: "number", name: "year", required: true },
      { type: "number", name: "session_cm_id", required: false },
      { type: "text", name: "source_field", required: false },
      { type: "json", name: "trace_data", required: false, maxSize: 5000000 },
      { type: "bool", name: "pinned", required: false },
      { type: "autodate", name: "created", onCreate: true, onUpdate: false },
      { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE INDEX idx_debug_traces_run_id ON debug_pipeline_traces (run_id)",
      "CREATE INDEX idx_debug_traces_requester ON debug_pipeline_traces (requester_cm_id)",
    ],
  });
  app.save(tracesCol);

  // --- debug_pipeline_summary ---
  const summaryCol = new Collection({
    id: COL_ID_SUMMARY,
    type: "base",
    name: "debug_pipeline_summary",
    listRule: '@request.auth.is_admin = true',
    viewRule: '@request.auth.is_admin = true',
    createRule: '@request.auth.collectionName = "_superusers"',
    updateRule: '@request.auth.collectionName = "_superusers"',
    deleteRule: '@request.auth.collectionName = "_superusers"',
    fields: [
      { type: "text", name: "run_id", required: true },
      {
        type: "relation", name: "trace",
        required: true, collectionId: COL_ID_TRACES,
        cascadeDelete: true, maxSelect: 1,
      },
      {
        type: "relation", name: "original_request",
        required: false, collectionId: originalRequestsCol.id,
        cascadeDelete: false, maxSelect: 1,
      },
      {
        type: "relation", name: "bunk_request",
        required: false, collectionId: bunkRequestsCol.id,
        cascadeDelete: false, maxSelect: 1,
      },
      { type: "number", name: "requester_cm_id", required: false },
      { type: "text", name: "requester_name", required: false },
      { type: "text", name: "target_name", required: false },
      { type: "text", name: "source_field", required: false },
      { type: "number", name: "session_cm_id", required: false },
      { type: "text", name: "request_type", required: false },
      { type: "text", name: "final_status", required: false },
      { type: "number", name: "final_confidence", required: false },
      { type: "text", name: "resolution_method", required: false },
      { type: "bool", name: "phase3_triggered", required: false },
      { type: "text", name: "ai_reasoning_summary", required: false, max: 1000 },
      { type: "text", name: "pre_p1_action", required: false },
      { type: "number", name: "year", required: true },
      { type: "autodate", name: "created", onCreate: true, onUpdate: false },
      { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      { type: "text", name: "disposition_reason", max: 100 },
      { type: "bool", name: "is_reciprocal" },
    ],
    indexes: [
      "CREATE INDEX idx_debug_summary_run_id ON debug_pipeline_summary (run_id)",
      "CREATE INDEX idx_debug_summary_status ON debug_pipeline_summary (final_status)",
      "CREATE INDEX idx_debug_summary_confidence ON debug_pipeline_summary (final_confidence)",
    ],
  });
  app.save(summaryCol);
}, (app) => {
  // Revert: delete in reverse dependency order
  const summaryCol = app.findCollectionByNameOrId("debug_pipeline_summary");
  app.delete(summaryCol);
  const tracesCol = app.findCollectionByNameOrId("debug_pipeline_traces");
  app.delete(tracesCol);
  const runsCol = app.findCollectionByNameOrId("debug_pipeline_runs");
  app.delete(runsCol);
});
