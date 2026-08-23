/// <reference path="../pb_data/types.d.ts" />
/**
 * lodging_write_ins.party_size + the draft twin — how many people a write-in
 * is for.
 *
 * ── WHY A COLUMN AND NOT A DERIVATION ───────────────────────────────────────
 *
 * `lodging_write_ins` has carried `occupant_name` and `note` and nothing else
 * since 1500000161, and the absence was deliberate: the card draws an EM DASH
 * rather than a numerator, because `0/5` beside a full room is a lie and `5/5`
 * is a different one. Nothing in the row, and nothing derivable from it,
 * answers "how many people".
 *
 * kindred#2432 then made a written-into cabin take a family like any other —
 * "mix and match: a family and a write-in may share a space in either order,
 * on a leaf or on a container". From that moment every bed statement about a
 * shared space has been wrong in the same direction, because `slotOccupancy`
 * sums `partySize` over parties and a write-in is not a party. kindred#2528
 * handled it the only way it could without this column: it REFUSES TO CLAIM
 * (`dragCapacity.known` withheld on `writtenInto`, and the Assign modal's
 * "occupancy not counted (write-in)"). This column is what those refusals were
 * waiting for.
 *
 * ── NULLABLE, AND `null` MEANS *OCCUPIES WHOLESALE* ─────────────────────────
 *
 * Not "unknown, treat as zero". A row with no count still asserts somebody is
 * in the room, which is exactly what the card's em dash has always said, so
 * the arithmetic reads an absent count as the whole capacity of the unit the
 * row names. That is the existing semantic written down, not a new invention.
 *
 * OPTIONAL AT THE CONTROL TOO, which is what makes `null` a permanent state
 * rather than a decaying one. Owner ruling 2026-08-21: "staff doesn't want the
 * integer field mandatory on input since most will be staff, and she isn't
 * concerned about staff housing hitting quantity limits, and the paper
 * write-ins are fewer."
 *
 * The two populations want opposite things. A non-rostered STAFF write-in --
 * most of them -- wants the cabin out of family inventory wholesale, and
 * nobody is counting beds against it. A PAPER REGISTRATION -- fewer -- wants
 * exactly its own beds subtracted so the rest of the space can still be let.
 * So the wholesale reading is the right answer for the common case, not a
 * degraded one, and this column serves the rarer case that needs precision.
 * Nothing downstream may treat the null branch as a legacy path to tidy away.
 *
 * ── NO BACKFILL, DELIBERATELY ───────────────────────────────────────────────
 *
 * All 24 production rows stay null. Measured on the 2026 snapshot: the
 * wholesale reading reproduces today's stats-bar figures exactly, so leaving
 * them null moves no number that is currently right, and moves the one that is
 * wrong (a combined container whose rooms are all written into). Writing a
 * guessed count would invent data to make a column look full.
 *
 * `min: 1` — zero people is not a write-in. Clearing the count is null.
 *
 * PocketBase v0.23 syntax: fields.add(new Field({...})) on an existing
 * collection, properties DIRECT rather than inside options{}. A bare
 * add({...}) silently does nothing. addField() is a no-op when the column
 * already exists, because PB records an applied migration by FILENAME -- a
 * later edit to this file would never re-run on a database that has already
 * seen it, and `Set` on a missing column is a silent no-op that never
 * persists.
 */

/**
 * Adds a field unless the collection already has one by that name.
 * @param {core.Collection} collection
 * @param {core.Field} field
 */
function addField(collection, field) {
  if (!collection.fields.getByName(field.name)) {
    collection.fields.add(field);
  }
}

migrate(
  (app) => {
    // Built per collection rather than once and reused: PocketBase MUTATES the
    // field object it is handed (stamping an id), so two collections sharing
    // one literal collide. 1500000161 carries the same note for the same pair.
    for (const name of ['lodging_write_ins', 'lodging_write_ins_draft']) {
      const collection = app.findCollectionByNameOrId(name);
      addField(
        collection,
        new Field({
          type: 'number', name: 'party_size', required: false, presentable: false,
          min: 1, max: null, onlyInt: true,
        })
      );
      app.save(collection);
    }
  },
  (app) => {
    for (const name of ['lodging_write_ins', 'lodging_write_ins_draft']) {
      const collection = app.findCollectionByNameOrId(name);
      collection.fields.removeByName('party_size');
      app.save(collection);
    }
  }
);
