/// <reference path="../pb_data/types.d.ts" />

// Standardize source_field values from CampMinder CSV headers (V1) to
// internal field names (V2) across bunk_request_sources.
//
// The bunk_requests.source_field / source_fields backfill that originally
// lived here ran on prod when the migration first landed (V1 rows existed
// from earlier syncs) and was dropped during the bunk_requests consolidation
// round — it is now a no-op on fresh DBs because consolidated #1500000018
// no longer has any V1 rows to convert (sync writes V2 directly).
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
      app.db()
        .newQuery(
          `UPDATE bunk_request_sources SET source_field = {:new} WHERE source_field = {:old}`
        )
        .bind({ new: newVal, old: oldVal })
        .execute();
    }
  },
  (app) => {
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
          `UPDATE bunk_request_sources SET source_field = {:new} WHERE source_field = {:old}`
        )
        .bind({ new: newVal, old: oldVal })
        .execute();
    }
  }
);
