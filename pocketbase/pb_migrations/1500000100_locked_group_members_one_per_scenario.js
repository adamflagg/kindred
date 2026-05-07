/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: enforce one-friend-group-per-camper-per-scenario on locked_group_members
 *
 * ## Problem
 *
 * locked_group_members had UNIQUE(group, attendee) — preventing a camper from
 * being added to the same group twice but NOT preventing the same camper from
 * appearing in two different groups within a single scenario.  Frontend code
 * in useGroupMap, the bunking board, and ScenarioComparisonPage implicitly
 * assumed one-group-per-camper; a second membership silently overwrote the
 * first (last-write-wins Map semantics).
 *
 * ## Approach
 *
 * SQLite GENERATED ALWAYS columns do not support subqueries, so the constraint
 * is enforced via:
 *
 *   1. BEFORE INSERT / BEFORE UPDATE triggers that call RAISE(ABORT) if the
 *      incoming (attendee, group.scenario) pair is already present in a
 *      different row.
 *   2. The companion Go hook in pocketbase/locked_groups/hooks.go enforces
 *      the same rule at the application layer and returns a human-readable
 *      409 error naming the conflicting group (the Go hook fires first in
 *      normal request flow, so the SQLite RAISE is a backstop for concurrent
 *      direct DB writes).
 *
 * ## Duplicate-handling strategy
 *
 * If any (attendee, scenario) duplicates already exist we keep the MOST RECENT
 * membership (highest ULID/id — ULIDs sort chronologically) and delete the
 * earlier ones.  In practice the seeded DB has no duplicates; this cleanup is
 * a defensive safety net.
 *
 * ## Rollback
 *
 * Drops the two triggers. No column was added so schema is otherwise unchanged.
 *
 * Dependencies: 1500000025_locked_group_members.js, 1500000024_locked_groups.js
 */

migrate(
  (app) => {
    const db = app.db()

    // ── 1. Deduplicate pre-existing data ────────────────────────────────────
    //
    // For every (attendee, scenario) pair that has more than one row, keep the
    // highest-id row (most recent ULID) and delete the rest.
    db.newQuery(`
      DELETE FROM locked_group_members
      WHERE id NOT IN (
        SELECT MAX(lgm.id)
        FROM locked_group_members lgm
        JOIN locked_groups lg ON lgm.\`group\` = lg.id
        GROUP BY lgm.attendee, lg.scenario
      )
    `).execute()

    console.log("[migration #1047] deduplicated locked_group_members (most-recent row per attendee+scenario kept)")

    // ── 2. BEFORE INSERT trigger ─────────────────────────────────────────────
    //
    // Aborts the insert if the attendee is already in a different group
    // belonging to the same scenario.
    db.newQuery(`
      CREATE TRIGGER IF NOT EXISTS trg_lgm_unique_per_scenario_insert
      BEFORE INSERT ON locked_group_members
      BEGIN
        SELECT RAISE(ABORT, 'Camper is already in a friend group in this scenario')
        WHERE EXISTS (
          SELECT 1
          FROM locked_group_members lgm
          JOIN locked_groups lg  ON lgm.\`group\` = lg.id
          JOIN locked_groups lg2 ON lg2.id        = NEW.\`group\`
          WHERE lgm.attendee  = NEW.attendee
            AND lg.scenario   = lg2.scenario
            AND lgm.id       != NEW.id
        );
      END
    `).execute()

    // ── 3. BEFORE UPDATE trigger ─────────────────────────────────────────────
    //
    // Same check when either the group or the attendee field is changed.
    db.newQuery(`
      CREATE TRIGGER IF NOT EXISTS trg_lgm_unique_per_scenario_update
      BEFORE UPDATE ON locked_group_members
      BEGIN
        SELECT RAISE(ABORT, 'Camper is already in a friend group in this scenario')
        WHERE EXISTS (
          SELECT 1
          FROM locked_group_members lgm
          JOIN locked_groups lg  ON lgm.\`group\` = lg.id
          JOIN locked_groups lg2 ON lg2.id        = NEW.\`group\`
          WHERE lgm.attendee  = NEW.attendee
            AND lg.scenario   = lg2.scenario
            AND lgm.id       != NEW.id
        );
      END
    `).execute()

    console.log("[migration #1047] added BEFORE INSERT/UPDATE triggers to locked_group_members for one-group-per-camper-per-scenario constraint")
  },

  (app) => {
    // ── Down migration ───────────────────────────────────────────────────────
    const db = app.db()

    db.newQuery(`DROP TRIGGER IF EXISTS trg_lgm_unique_per_scenario_update`).execute()
    db.newQuery(`DROP TRIGGER IF EXISTS trg_lgm_unique_per_scenario_insert`).execute()

    console.log("[migration #1047 rollback] removed one-group-per-camper-per-scenario triggers from locked_group_members")
  }
)
