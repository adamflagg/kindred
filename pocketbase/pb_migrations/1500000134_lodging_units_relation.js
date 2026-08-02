/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: a placement points at a SET of units.
 * Dependencies: lodging_assignments (1500000119), the draft twins (1500000132)
 *
 * `unit` (one room) and `merge` / `merge_draft` (a row naming a set of rooms)
 * collapse into one multi-valued `units` relation, and both merge collections
 * are dropped.
 *
 * WHY. Alias resolution already produces a set -- AliasResolution.UnitIDs --
 * and EnsureMerge existed only because a placement could hold a single id. The
 * two merge tables cost a three-way target XOR that nothing enforced, two
 * delete guards, a three-relation expand whose partial use renders a placed
 * party as unplaced, and kindred#1923(b). None of it survives the set.
 *
 * A merged slot was never inventory: `lodging_availability.unit` is a required
 * relation to `lodging_units`, so a merge could never be reserved or released.
 * effective_bathroom already takes `merged_codes: frozenset[str]` -- "a
 * one-element set for an unmerged unit" -- so the bathroom upgrade is unchanged
 * by this migration.
 *
 * THE BACKFILL MUST EXPAND MERGES. The dev DB holds zero merge rows, but
 * production state is not known here (kindred#1917), so a row pointing at a
 * merge takes that merge's member_units. Dropping the column first would lose
 * those placements silently. Exercised by seeding merge rows -- truth and
 * draft, plus a row carrying two targets and a target-less tombstone -- into a
 * scratch copy of the dev database and running this migration over them.
 *
 * SAFETY NET. PocketBase runs every pending migration inside ONE transaction
 * (core/migrations_runner.go Up), so any throw below rolls the whole thing
 * back and leaves the database exactly as it was. That is why the failure
 * paths here throw rather than skip.
 *
 * NOT REVERSIBLE. A unit set cannot say which merge row produced it.
 *
 * `lodging_assignment_history` is deliberately untouched: its old_unit/new_unit
 * are TEXT cabin strings, not relations, precisely so an unresolvable
 * historical string is still recorded. Nothing there points at a merge.
 */

const TRUTH = "lodging_assignments"
const DRAFT = "lodging_assignments_draft"
const PLACEMENT_TABLES = [TRUTH, DRAFT]

/**
 * Read a merge row's `member_units` as a plain array of unit ids.
 *
 * `getStringSlice()` is the accessor, and the choice is NOT obvious -- the
 * closest precedent in this directory reaches for the opposite one.
 * 1500000130 readRolePermissions uses `getString()` + JSON.parse and documents
 * why: `get()` on a JSON field hands back types.JSONRaw, a Go byte slice that
 * goja presents as an Array, so `Array.isArray()` answers true and iterating it
 * yields BYTE VALUES.
 *
 * A multi-valued RELATION is a different stored type (types.JSONArray[string])
 * and behaves differently. Measured against the running VM on a seeded
 * lodging_merges row, not assumed:
 *
 *   get()            -> a real Array of 2 id STRINGS
 *   getStringSlice() -> a real Array of 2 id STRINGS, and writing that value
 *                       straight back into the relation round-trips unchanged
 *   getString()      -> "" -- THE EMPTY STRING
 *
 * So on a relation the 1500000130 pattern is the dangerous one: getString() +
 * JSON.parse returns [] every time, silently, which here would drop every
 * merged placement on the floor. getStringSlice() is the honest accessor for a
 * relation; getString() is the honest accessor for a json field. They are not
 * interchangeable, and neither one fails loudly on the wrong field type.
 */
function memberUnitsOf(app, collection, id) {
  let merge
  try {
    merge = app.findRecordById(collection, id)
  } catch (err) {
    // Deliberately NOT the broad catch the repo's convention allows for the
    // expected no-match path (docs/reference/pocketbase-migrations.md): a
    // placement pointing at a merge that is gone is a placement about to be
    // silently emptied, and this migration is the last moment it is
    // recoverable. Fail the boot with the ids in the message instead.
    //
    // `err` is in the message as well as in `cause` because this repo has not
    // pinned whether goja honours the ES2022 options bag, and a boot-loop
    // message that lost the underlying error is the wrong thing to discover
    // during an incident.
    throw new Error(
      "1500000134: placement references a missing " + collection + " row " + id + ": " + err,
      { cause: err }
    )
  }

  const members = merge.getStringSlice("member_units")
  if (members.length === 0) {
    // Not a data case: member_units has been `required` with minSelect 2 since
    // 1500000118, so no legitimate merge row can land here. What CAN land here
    // is the accessor silently returning nothing -- see above; getString()
    // does exactly that on a relation -- and that failure would empty EVERY
    // merged placement at once. Throwing rolls the whole migration back.
    throw new Error(
      "1500000134: " + collection + " row " + id + " resolved to no member units; " +
        "suspect the accessor, not the data"
    )
  }
  return members
}

/**
 * The unit ids a row's placement resolves to, in the READER's own precedence.
 *
 * merge_draft before merge before unit, matching
 * api/services/lodging_roster_service.py::_placement_of. Nothing -- schema, DB,
 * or hook -- enforces an XOR across the draft table's three targets, so a row
 * carrying two of them is accepted today and renders as the more specific one.
 * Matching that order is what makes this migration invisible to the board.
 * Taking the union instead would invent occupancy the board never showed.
 *
 * An empty result is a real answer, not a failure: on the truth table it is an
 * orphan (the unit was deleted out from under the row, which the optional
 * relation allows), and on the draft table it is the deliberate "staff took
 * this party off the board in this scenario" tombstone. Both already mean an
 * empty set.
 */
function placementUnits(app, row, hasMergeDraft) {
  if (hasMergeDraft) {
    const mergeDraftId = row.getString("merge_draft")
    if (mergeDraftId) {
      return { units: memberUnitsOf(app, "lodging_merges_draft", mergeDraftId), fromMerge: true }
    }
  }
  const mergeId = row.getString("merge")
  if (mergeId) {
    return { units: memberUnitsOf(app, "lodging_merges", mergeId), fromMerge: true }
  }
  const unitId = row.getString("unit")
  return { units: unitId ? [unitId] : [], fromMerge: false }
}

migrate(
  (app) => {
    const unitsCol = app.findCollectionByNameOrId("lodging_units")

    for (const name of PLACEMENT_TABLES) {
      const col = app.findCollectionByNameOrId(name)
      // v0.23 syntax: properties are DIRECT, never inside options:{}, and on an
      // EXISTING collection a bare add({...}) silently does nothing -- the
      // new Field() wrapper is required.
      //
      // maxSelect 20 is the merge tables' own member cap carried over, so no
      // set that fits in a merge today fails to fit in a placement tomorrow.
      // Not `required`: a row naming no unit is a real state on both tables
      // (orphan on the truth table, tombstone on the draft).
      col.fields.add(
        new Field({
          type: "relation",
          name: "units",
          required: false,
          presentable: false,
          collectionId: unitsCol.id,
          cascadeDelete: false,
          minSelect: null,
          maxSelect: 20,
        })
      )
      app.save(col)
    }

    // Backfill BEFORE dropping the old columns.
    for (const name of PLACEMENT_TABLES) {
      const hasMergeDraft = name === DRAFT
      let filled = 0
      let expanded = 0
      for (const row of app.findRecordsByFilter(name, "", "", 0, 0)) {
        const placement = placementUnits(app, row, hasMergeDraft)
        if (placement.units.length === 0) {
          // Nothing to write, and skipping the save keeps an orphan or a
          // tombstone out of the assignment-grain hook, which fires on every
          // app.save() in this loop.
          continue
        }
        row.set("units", placement.units)
        app.save(row)
        filled++
        if (placement.fromMerge) {
          // Counted off the BRANCH TAKEN, not off units.length > 1: a merge is
          // the branch that has no other test after this migration lands.
          expanded++
        }
      }
      // The only record anyone will have of what this did to production.
      console.log(
        "1500000134: " + name + " backfilled " + filled +
          " placement(s), " + expanded + " expanded from a merge"
      )
    }

    for (const name of PLACEMENT_TABLES) {
      const col = app.findCollectionByNameOrId(name)
      col.fields.removeByName("unit")
      col.fields.removeByName("merge")
      if (name === DRAFT) {
        col.fields.removeByName("merge_draft")
      }
      app.save(col)
    }

    // Only after every relation field pointing at them is gone: PocketBase
    // refuses to delete a collection another collection still references
    // (core/collection_model.go, FindCollectionReferences).
    app.delete(app.findCollectionByNameOrId("lodging_merges_draft"))
    app.delete(app.findCollectionByNameOrId("lodging_merges"))
  },
  () => {
    throw new Error(
      "1500000134 is not reversible: a unit set cannot say which lodging_merges row produced it"
    )
  }
)
