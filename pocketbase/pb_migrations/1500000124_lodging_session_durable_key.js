/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: stop lodging rows cascading away with a camp_session, and give them
 * a durable CampMinder key. Resolves kindred#1879.
 *
 * THE CASCADE
 *
 * camp_sessions rows are orphan-deleted by SessionsSync: it marks every session
 * CampMinder returned, then deletes local rows it did not see. lodging_merges,
 * lodging_availability and lodging_assignments each held a `session` relation
 * with cascadeDelete true, so a session disappearing from one API response took
 * every dependent row with it -- no error, no recovery, and only a routine
 * "deleted orphaned record" line about the SESSION to show for it. That
 * contradicts the work queue's own contract in 1500000122: never a silent drop.
 *
 * Scope of the exposure, measured rather than assumed: orphan deletion is
 * YEAR-SCOPED. sessions.go builds "year = N" and passes that same filter to
 * DeleteOrphans, so a 2026 sync can only delete 2026 rows. Historical years were
 * never at risk. What remains is the current sync year, where a successful but
 * truncated CampMinder response still counts as success -- DeleteOrphans skips
 * only on an outright sync FAILURE, and has no minimum-count guard.
 *
 * The fix is one flag, because `session` is already required on all three.
 * PocketBase blocks deleting a record behind a REQUIRED relation, but only while
 * cascadeDelete is false; with it true, it cascades instead. Flipping it turns
 * silent data loss into an HTTP 400 the sessions sync reports. The cost is real
 * and intended: a genuinely cancelled weekend now fails orphan cleanup until a
 * human clears its lodging rows. The sync cannot tell "cancelled" apart from
 * "absent from this response", and those deserve different answers.
 *
 * THE DURABLE KEY
 *
 * camp_sessions is unique on (cm_id, year), so every YEAR gets its own row: a
 * program that runs in 2025, skips 2026 and returns in 2027 comes back with a
 * different PocketBase record id. A PB relation therefore cannot express any
 * cross-year question -- "same cabin as last year", or year-over-year occupancy
 * -- because the id it points at is scoped to one season. session_cm_id sits
 * beside the relation as the stable identity, per CLAUDE.md section 1: cross-table
 * relationships use CampMinder IDs. The relation stays for convenience joins.
 *
 * required true on the three placement tables: all four tables are empty today
 * (nothing writes them until plan Task 11), so there is nothing to backfill, and
 * requiring it means the assignment sync fails loudly rather than writing rows
 * that cannot survive a session being recreated.
 *
 * lodging_assignment_history gets the column too but NOT the requirement, and its
 * relation keeps cascadeDelete false with required false. That asymmetry is
 * deliberate and predates this migration: the audit trail is meant to outlive its
 * session, blanking `session` rather than vanishing. Until now that left a
 * surviving row unable to say which weekend it described; session_cm_id is what
 * finally makes the audit trail self-contained.
 *
 * PocketBase v0.23 syntax: fields.add(new Field({...})) on an existing
 * collection. A bare add({...}) silently does nothing.
 */

migrate((app) => {
  // The three placement tables: break the cascade, add the durable key.
  for (const name of ["lodging_merges", "lodging_availability", "lodging_assignments"]) {
    const col = app.findCollectionByNameOrId(name);

    // No guard: a missing `session` is the one state this migration must never
    // shrug at. Its whole purpose is to clear cascadeDelete on that field, so
    // skipping quietly would report success while leaving kindred#1879's silent
    // data loss fully in place.
    const rel = col.fields.getByName("session");
    if (!rel) {
      throw new Error(`${name}: expected an existing "session" relation field`);
    }
    rel.cascadeDelete = false;

    col.fields.add(new Field({
      type: "number", name: "session_cm_id", required: true, presentable: false,
      min: 1, max: null, onlyInt: true
    }));
    app.save(col);
  }

  // The audit trail. Optional, because its `session` relation is optional by
  // design -- a history row is expected to outlive the session it references.
  const history = app.findCollectionByNameOrId("lodging_assignment_history");
  history.fields.add(new Field({
    type: "number", name: "session_cm_id", required: false, presentable: false,
    min: null, max: null, onlyInt: true
  }));
  app.save(history);
}, (app) => {
  for (const name of ["lodging_merges", "lodging_availability", "lodging_assignments"]) {
    const col = app.findCollectionByNameOrId(name);
    const rel = col.fields.getByName("session");
    if (!rel) {
      throw new Error(`${name}: expected an existing "session" relation field`);
    }
    rel.cascadeDelete = true;
    col.fields.removeByName("session_cm_id");
    app.save(col);
  }

  const history = app.findCollectionByNameOrId("lodging_assignment_history");
  history.fields.removeByName("session_cm_id");
  app.save(history);
});
