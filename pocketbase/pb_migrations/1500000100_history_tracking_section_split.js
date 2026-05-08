/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Re-bucket ai.historical_context.* and ai.history_tracking.*
 * config rows from the 'ai-validation-rules' section into 'history-tracking'.
 * Idempotent: safe to re-run.
 */
migrate(
  (app) => {
    const records = app.findRecordsByFilter(
      "config",
      `category = "ai" && (config_key ~ "historical_context" || config_key ~ "history_tracking")`,
    );
    for (const record of records) {
      const metadata = record.get("metadata") || {};
      if (metadata.section !== "history-tracking") {
        metadata.section = "history-tracking";
        record.set("metadata", metadata);
        app.save(record);
      }
    }
  },
  (app) => {
    // Down: revert section to 'ai-validation-rules'.
    const records = app.findRecordsByFilter(
      "config",
      `category = "ai" && (config_key ~ "historical_context" || config_key ~ "history_tracking")`,
    );
    for (const record of records) {
      const metadata = record.get("metadata") || {};
      if (metadata.section !== "ai-validation-rules") {
        metadata.section = "ai-validation-rules";
        record.set("metadata", metadata);
        app.save(record);
      }
    }
  },
);
