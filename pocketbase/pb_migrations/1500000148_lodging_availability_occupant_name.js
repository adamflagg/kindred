/// <reference path="../pb_data/types.d.ts" />
/**
 * Add `occupant_name` to lodging_availability — WHO is in the room.
 *
 * Owner ruling, 2026-08-09 (kindred#2078): *"only one, hold is the write in"*.
 * Staff have never used Hold to reserve an empty cabin. They use it to write
 * in an occupant the system does not know about — almost always non-rostered
 * weekend staff. The row already closed the cabin; it had nowhere to put the
 * person, so the name went into `note`, which the API surfaces as `reason` and
 * the card printed as a small italic line under the badge row.
 *
 * A hold IS a write-in. That is ONE control and one column more, not a second
 * concept: a staff member who types "burst pipe" into the occupant field gets
 * a card showing an occupant called "burst pipe", and that is an ACCEPTED COST
 * ruled on rather than a gap to close later.
 *
 * ── THE BACKFILL IS BLANKET, BY RULING ──────────────────────────────────────
 *
 * *"all of the existing 2078 prod rows are the occupant names."* There is no
 * mapping table and no per-row judgement: every existing `note` IS an occupant
 * name, so it moves wholesale. Written as a PREDICATE over the table rather
 * than a list, for the reason 1500000138's and 1500000145's backfills give — a
 * predicate names nobody, so it cannot leak a name into this directory (which
 * `verify-no-hardcoded-lodging.sh` scans) and cannot go stale as rows arrive.
 *
 * ── NON-DESTRUCTIVE, AND A TRUE RE-RUNNABLE NO-OP ───────────────────────────
 *
 * Two guarded statements, IN THIS ORDER:
 *
 *   1. copy `note` -> `occupant_name`, ONLY where `occupant_name` is empty;
 *   2. clear `note`, ONLY where it is now byte-identical to `occupant_name`.
 *
 * After run 1, `note` is `''` on every row it touched, so neither predicate
 * matches on run 2 — statement 1 skips rows that now have a name, statement 2
 * finds no non-empty note equal to one. Nothing is lost in between: the string
 * exists in `occupant_name` before step 2 reads it, and step 2 only clears
 * what it can prove is already saved. This satisfies the standing "no
 * destructive data migrations" rule.
 *
 * ⛔ NO `refuseIfPopulated` GUARD, and this is deliberate rather than an
 * omission. 1500000135 carried one because it DROPPED columns and could not
 * safely meet a populated table. This migration is ADDITIVE and the population
 * is the entire point — refusing a populated table here would refuse the only
 * case that matters.
 *
 * ── WHY CLEARING `note` IS LOAD-BEARING, NOT TIDINESS ───────────────────────
 *
 * `UnitAvailabilityControl.tsx` renders `unit.reason` — which IS this `note`
 * column, translated in `_build_units` — as a standalone italic muted line
 * under the badge row, and the approved mockup puts the same string in the
 * occupant well as the write-in's NAME. Leaving `note` populated would print
 * the identical string TWICE on one card.
 *
 * ── THE NOTE COLUMN SHIPS EMPTY EVERYWHERE, AND THAT IS CORRECT ─────────────
 *
 * Step 2 clears every note it copies, so NO historical row carries one. The
 * "say why, so next week's staff can act on it" affordance is kept, but it is
 * PROSPECTIVE ONLY — it applies to write-ins recorded from this migration
 * onward. Nobody should later "repair" the empty column by re-populating it
 * from `occupant_name`: that would restore the double-print this removed.
 *
 * ── SIZING ──────────────────────────────────────────────────────────────────
 *
 * `max: 2000` mirrors `note`'s own cap (1500000118), so statement 1 cannot be
 * rejected for length by any value the column it copies from could hold. The
 * API caps the field it accepts at 500, which is a UI-side judgement about a
 * name and is deliberately the tighter of the two — a stored value longer than
 * that can only have arrived from the pre-existing `note`.
 */

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('lodging_availability');

    // Idempotent: editing an already-applied migration silently skips it
    // (`_migrations` keys on filename), so every add in this codebase is
    // written to tolerate the field already being present.
    if (!col.fields.getByName('occupant_name')) {
      col.fields.add(
        new Field({
          type: 'text',
          name: 'occupant_name',
          // NOT `required`. A required text field would refuse every existing
          // row before statement 1 below could fill it, and would make the
          // release branch (a staff cabin opened to families, which has no
          // occupant at all) unwritable.
          required: false,
          presentable: false,
          min: 0,
          max: 2000,
          pattern: '',
        })
      );
      app.save(col);
    }

    // 1 — the name moves. Gated on `occupant_name = ''`, so it only ever
    // FILLS: a value already written through the control outranks this and is
    // never overwritten, and a second run matches nothing.
    app
      .db()
      .newQuery(
        'UPDATE lodging_availability SET occupant_name = note ' +
          "WHERE occupant_name = '' AND note != ''"
      )
      .execute();

    // 2 — and only then does the note go. `note = occupant_name` is the proof
    // that the string is already saved somewhere else; a row whose note was
    // NOT copied (because it already had an occupant) keeps its note, which is
    // exactly right — those two are different facts.
    app
      .db()
      .newQuery(
        "UPDATE lodging_availability SET note = '' " + "WHERE note != '' AND note = occupant_name"
      )
      .execute();
  },
  (app) => {
    // The down migration restores `note` from `occupant_name` before dropping
    // the column, so a rollback does not take the names with it. Same guard
    // shape: it only ever fills an empty note.
    const col = app.findCollectionByNameOrId('lodging_availability');
    if (!col.fields.getByName('occupant_name')) return;
    app
      .db()
      .newQuery(
        'UPDATE lodging_availability SET note = occupant_name ' +
          "WHERE note = '' AND occupant_name != ''"
      )
      .execute();
    col.fields.removeByName('occupant_name');
    app.save(col);
  }
);
