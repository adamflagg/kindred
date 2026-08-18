/// <reference path="../pb_data/types.d.ts" />
/**
 * Move write-in OCCUPANCY out of lodging_availability — kindred#2382, PR 2 of 4.
 *
 * 1500000161 created `lodging_write_ins` and `lodging_write_ins_draft` empty
 * and dark. This is the migration that moves the rows, and the same change
 * switches every reader and the write path over to them. After it,
 * `lodging_availability` holds ONLY the staff<->family role override.
 *
 * ── WHAT MOVES, AND WHAT IS LEFT BEHIND ─────────────────────────────────────
 *
 * `family_available` answered two unrelated questions through one boolean:
 *
 *   true  -> a staff cabin OPENED to families for this weekend. A ROLE
 *            override. Names no occupant. NOT scenario-scoped (owner ruling,
 *            2026-08-15: "that's more of a known 'were moving staff to X for
 *            weekend Y'"). STAYS.
 *   false -> somebody is in the room. An OCCUPANCY. The write-in. Scenario-
 *            scoped, because not every write-in is non-rostered staff — some
 *            are paper registrations for families arriving with no children,
 *            and a modelling choice belongs to the scenario that made it.
 *            MOVES.
 *   no row -> the unit's own role decides. Nothing to move.
 *
 * The predicate below is therefore `family_available = 0`, and every column it
 * carries across (unit, session, session_cm_id, year, occupant_name, note)
 * exists on the destination with the same name, type and limits — 1500000161
 * mirrored the source schema deliberately so this step has no per-column
 * judgement to make.
 *
 * ⚠️ MEASURED, AND THE MEASUREMENT IS THE REASON THIS IS SAFE. All 21 rows in
 * `lodging_availability` in the production snapshot are `family_available = 0`
 * — every one an occupancy, none a role. So the split moves all 21 and leaves
 * the table EMPTY. Stated plainly rather than described as a partition,
 * because pretending it splits a populated table two ways would misdescribe
 * what a reviewer will see afterwards: no ROLE row exists in production today,
 * and the role half of the table is live capability with no current rows, not
 * a preserved population.
 *
 * ── IDEMPOTENT, AND NON-DESTRUCTIVE IN THAT ORDER ───────────────────────────
 *
 * Two guarded statements, and the order is the whole safety argument:
 *
 *   1. INSERT the occupancy rows that are not already there, keyed on the
 *      destination's own unique index (session_cm_id, year, unit) so a re-run
 *      matches nothing and a half-applied run can still finish. The row's `id`
 *      travels with it, which keeps the move traceable and means a second run
 *      cannot mint a duplicate under a fresh id.
 *   2. DELETE from the source ONLY the rows a copy provably exists for. A row
 *      that failed to insert for any reason is still in `lodging_availability`
 *      afterwards, where the read path still understands it, rather than gone.
 *
 * This satisfies the standing "no destructive data migrations" rule: nothing
 * is removed before it is proven saved somewhere else.
 *
 * ── WHY RAW SQL ─────────────────────────────────────────────────────────────
 *
 * Same idiom as 1500000148's own backfill, and for the same reasons: a
 * predicate over the table names nobody, so it cannot leak a camper or staff
 * name into this directory (which `verify-no-hardcoded-lodging.sh` scans) and
 * cannot go stale as rows arrive. It also carries `created`/`updated` across
 * unchanged, so the moved row keeps the day staff actually recorded it instead
 * of reporting itself as written by the migration.
 *
 * `family_available` is a PocketBase boolean, which SQLite stores as 0/1; the
 * production snapshot holds 0 on all 21 rows.
 *
 * ── DOWN ────────────────────────────────────────────────────────────────────
 *
 * The exact inverse, in the mirrored order: put the rows back as
 * `family_available = 0`, then drop the ones proven copied. It moves EVERY
 * live write-in back, not only the ones this migration brought in, and that is
 * correct — down means "occupancy lives in `lodging_availability` again", so a
 * write-in recorded after this migration has to travel back with the rest or
 * it would vanish from a board that still expects to find it.
 *
 * `lodging_write_ins_draft` is deliberately untouched by both directions. It is
 * still dark in this PR — nothing writes it and nothing reads it — and it has a
 * `scenario` column `lodging_availability` has nowhere to put. PR 3, which
 * starts filling it, owns its down path.
 */

migrate(
  (app) => {
    // 1 — the occupancy rows move. Guarded on the destination's unique key so
    // a re-run inserts nothing, and a run that was interrupted part-way can
    // still finish the remainder.
    app
      .db()
      .newQuery(
        'INSERT INTO lodging_write_ins ' +
          '(id, created, updated, unit, session, session_cm_id, year, occupant_name, note) ' +
          'SELECT a.id, a.created, a.updated, a.unit, a.session, a.session_cm_id, a.year, ' +
          'a.occupant_name, a.note ' +
          'FROM lodging_availability a ' +
          'WHERE a.family_available = 0 AND NOT EXISTS (' +
          'SELECT 1 FROM lodging_write_ins w ' +
          'WHERE w.session_cm_id = a.session_cm_id AND w.year = a.year AND w.unit = a.unit)'
      )
      .execute();

    // 2 — and only then does the source row go. EXISTS is the proof the string
    // is already saved somewhere else; a row whose insert did not land keeps
    // its home rather than being deleted into nothing.
    app
      .db()
      .newQuery(
        'DELETE FROM lodging_availability ' +
          'WHERE family_available = 0 AND EXISTS (' +
          'SELECT 1 FROM lodging_write_ins w ' +
          'WHERE w.session_cm_id = lodging_availability.session_cm_id ' +
          'AND w.year = lodging_availability.year AND w.unit = lodging_availability.unit)'
      )
      .execute();
  },
  (app) => {
    // The inverse, in the mirrored order: restore first, prove, then remove.
    app
      .db()
      .newQuery(
        'INSERT INTO lodging_availability ' +
          '(id, created, updated, unit, session, session_cm_id, year, family_available, ' +
          'occupant_name, note) ' +
          'SELECT w.id, w.created, w.updated, w.unit, w.session, w.session_cm_id, w.year, 0, ' +
          'w.occupant_name, w.note ' +
          'FROM lodging_write_ins w ' +
          'WHERE NOT EXISTS (' +
          'SELECT 1 FROM lodging_availability a ' +
          'WHERE a.session_cm_id = w.session_cm_id AND a.year = w.year AND a.unit = w.unit)'
      )
      .execute();

    app
      .db()
      .newQuery(
        'DELETE FROM lodging_write_ins ' +
          'WHERE EXISTS (' +
          'SELECT 1 FROM lodging_availability a ' +
          'WHERE a.session_cm_id = lodging_write_ins.session_cm_id ' +
          'AND a.year = lodging_write_ins.year AND a.unit = lodging_write_ins.unit ' +
          'AND a.family_available = 0)'
      )
      .execute();
  }
);
