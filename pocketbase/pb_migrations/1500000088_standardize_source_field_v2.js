/// <reference path="../pb_data/types.d.ts" />

// Standardize source_field values from CampMinder CSV headers (V1) to
// internal field names (V2) across bunk_requests and bunk_request_sources.
migrate(
  (app) => {
    const mappings = {
      "Share Bunk With": "bunk_with",
      "Do Not Share Bunk With": "not_bunk_with",
      "BunkingNotes Notes": "bunking_notes",
      "Internal Bunk Notes": "internal_notes",
      "RetParent-Socializewithbest": "socialize_with",
    };

    for (const [oldVal, newVal] of Object.entries(mappings)) {
      // Update bunk_requests.source_field
      app.db()
        .newQuery(
          `UPDATE bunk_requests SET source_field = {:new} WHERE source_field = {:old}`
        )
        .bind({ new: newVal, old: oldVal })
        .execute();

      // Update bunk_request_sources.source_field
      app.db()
        .newQuery(
          `UPDATE bunk_request_sources SET source_field = {:new} WHERE source_field = {:old}`
        )
        .bind({ new: newVal, old: oldVal })
        .execute();

      // Update source_fields JSON array in bunk_requests
      // This is a JSON array column — replace V1 strings with V2
      app.db()
        .newQuery(
          `UPDATE bunk_requests
           SET source_fields = REPLACE(source_fields, {:oldQuoted}, {:newQuoted})
           WHERE source_fields LIKE {:pattern}`
        )
        .bind({
          oldQuoted: '"' + oldVal + '"',
          newQuoted: '"' + newVal + '"',
          pattern: "%" + oldVal + "%",
        })
        .execute();
    }
  },
  (app) => {
    // Reverse migration: V2 back to V1
    const mappings = {
      bunk_with: "Share Bunk With",
      not_bunk_with: "Do Not Share Bunk With",
      bunking_notes: "BunkingNotes Notes",
      internal_notes: "Internal Bunk Notes",
      socialize_with: "RetParent-Socializewithbest",
    };

    for (const [oldVal, newVal] of Object.entries(mappings)) {
      app.db()
        .newQuery(
          `UPDATE bunk_requests SET source_field = {:new} WHERE source_field = {:old}`
        )
        .bind({ new: newVal, old: oldVal })
        .execute();

      app.db()
        .newQuery(
          `UPDATE bunk_request_sources SET source_field = {:new} WHERE source_field = {:old}`
        )
        .bind({ new: newVal, old: oldVal })
        .execute();

      app.db()
        .newQuery(
          `UPDATE bunk_requests
           SET source_fields = REPLACE(source_fields, {:oldQuoted}, {:newQuoted})
           WHERE source_fields LIKE {:pattern}`
        )
        .bind({
          oldQuoted: '"' + oldVal + '"',
          newQuoted: '"' + newVal + '"',
          pattern: "%" + oldVal + "%",
        })
        .execute();
    }
  }
);
