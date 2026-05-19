/// <reference path="../pb_data/types.d.ts" />

/**
 * Update objective.source_multipliers values to propagate the PR #1533
 * behavioral change to existing deployments.
 *
 * Companion to the seed-value edits in 1500000011_config.js (frozen for prod
 * — PocketBase never re-runs an applied migration filename). Without this
 * follow-up, prod's config records keep the old values forever; only fresh
 * installs / dev-DB resets would pick up the new seeds.
 *
 * Changes:
 *   - objective.source_multipliers.share_bunk_with: 1.5 → 1.75
 *     (enforces MP > STAFF hierarchy — one-way MP bunk_with 700 > STAFF
 *      not_bunk_with 600 at slot 0)
 *   - objective.source_multipliers.internal_notes: 0.8 → 1.0
 *     (ties internal_notes with bunking_notes at 400 slot-0; staff said
 *      notes should be equally weighted)
 *
 * Raw SQL is used because ``config.value`` is a JSON field — the JSVM
 * Record getters (getFloat / get) deserialize via PocketBase's JSON codec,
 * which complicates direct numeric equality. SQLite stores the JSON-encoded
 * scalar as REAL when the value is a plain number, so a SQL UPDATE with a
 * numeric WHERE clause compares cleanly.
 *
 * Idempotent: rows are updated only when the value still equals the old
 * default. Manual operator overrides (any other value, including the new
 * target after a prior run) are preserved.
 */
migrate(
  (app) => {
    const updates = [
      { config_key: "share_bunk_with", oldValue: 1.5, newValue: 1.75 },
      { config_key: "internal_notes", oldValue: 0.8, newValue: 1.0 },
    ];

    for (const u of updates) {
      app
        .db()
        .newQuery(
          `UPDATE config
           SET value = {:newVal}
           WHERE category = 'objective'
             AND subcategory = 'source_multipliers'
             AND config_key = {:key}
             AND value = {:oldVal}`,
        )
        .bind({ newVal: u.newValue, oldVal: u.oldValue, key: u.config_key })
        .execute();
    }
  },
  (app) => {
    // Reverse: roll values back, again only if the current value matches
    // the post-PR target (skip manual overrides).
    const updates = [
      { config_key: "share_bunk_with", postValue: 1.75, preValue: 1.5 },
      { config_key: "internal_notes", postValue: 1.0, preValue: 0.8 },
    ];

    for (const u of updates) {
      app
        .db()
        .newQuery(
          `UPDATE config
           SET value = {:preVal}
           WHERE category = 'objective'
             AND subcategory = 'source_multipliers'
             AND config_key = {:key}
             AND value = {:postVal}`,
        )
        .bind({ preVal: u.preValue, postVal: u.postValue, key: u.config_key })
        .execute();
    }
  },
);
