/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: lodging_slot_merges.scenario becomes optional.
 * Dependencies: lodging_slot_merges (1500000139)
 *
 * A MERGE IS A FACT ABOUT THE WEEKEND, NOT ONLY ABOUT A PLAN. Unlike a
 * placement, no sync ever writes a draw level -- there is no CampMinder
 * record of truth a writable mirror would corrupt, so there was never a real
 * reason the mirror had to be read-only for it. 1500000139's own docstring
 * argued the opposite ("SCENARIO IS A REQUIRED RELATION... that is what
 * makes 'the CampMinder mirror is never overridable' a schema guarantee");
 * the owner has since reversed that call. The precedent is
 * lodging_availability, whose scenario column 1500000135 deleted outright for
 * the identical reason ("a burst pipe closes a cabin in every plan for that
 * weekend"). A merge keeps its scenario dimension -- a scenario CAN still
 * split a container the weekend has combined, or vice versa -- but gains a
 * second, coarser tier: a `scenario = ""` row is a WEEKEND-LEVEL override,
 * seen on the CampMinder mirror (which is where most staff look,
 * LodgingBoard.tsx:100-104) and inherited by every scenario that has not
 * said otherwise.
 *
 * DOES NOT TOUCH THE UNIQUE INDEX. idx_lodging_slot_merge_unique is UNIQUE on
 * (unit, session, year, scenario); SQLite's UNIQUE treats an empty string as
 * an ordinary value like any other (NOT NULL, unlike the NULL-is-distinct
 * case that would need a partial index), so `scenario = ''` already
 * participates correctly -- one weekend-level row per (unit, session, year),
 * exactly as one scenario row per (unit, session, year, scenario) does. No
 * index change is required or made.
 *
 * ONLY `required` CHANGES. cascadeDelete stays true: a merge of a deleted
 * scenario still holds no human's placement worth preserving, and a
 * weekend-level row has no scenario relation to cascade from in the first
 * place. Resolution order (highest first) lives in
 * api/services/lodging_roster_service.py:resolve_combined -- this migration
 * only removes the schema-level refusal that made the second tier
 * unstorable.
 *
 * PocketBase v0.23 syntax: mutate the existing Field object's property and
 * `app.save(col)` -- the identical idiom 1500000124 used to flip
 * `session.cascadeDelete` on this table family without a remove/re-add
 * round trip, which would needlessly reallocate the field's id.
 */

migrate(
  (app) => {
    const col = app.findCollectionByNameOrId('lodging_slot_merges');

    // No guard beyond existence: a missing `scenario` is the one state this
    // migration must never shrug at, since its whole purpose is to relax
    // that field's constraint.
    const scenario = col.fields.getByName('scenario');
    if (!scenario) {
      throw new Error('lodging_slot_merges: expected an existing "scenario" relation field');
    }
    scenario.required = false;
    app.save(col);
  },
  (app) => {
    const col = app.findCollectionByNameOrId('lodging_slot_merges');
    const scenario = col.fields.getByName('scenario');
    if (!scenario) {
      throw new Error('lodging_slot_merges: expected an existing "scenario" relation field');
    }
    // Restores 1500000139's original shape exactly. Any weekend-level rows
    // written since the up path (scenario = "") would violate this
    // constraint on their next save, but PocketBase applies `required` at
    // record-save time, not at schema-save time, so flipping it back here
    // cannot itself fail.
    scenario.required = true;
    app.save(col);
  }
);
