/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: lodging_availability loses its scenario dimension
 * Dependencies: lodging collections (1500000116-1500000124), lodging draft writes (1500000132)
 *
 * kindred#1974 removed the overlay pattern for placements -- a scenario's
 * draft rows REPLACE the CampMinder mirror rather than showing through it --
 * and left availability behind as the last overlay in the lodging model.
 * 1500000132 recorded that asymmetry as deliberate ("lodging_availability
 * KEEPS its scenario column and gets no twin"). It was not.
 *
 * Availability is a fact about the WEEKEND, not about the plan: a burst pipe
 * closes a cabin in every scenario for that weekend, so there is nothing for a
 * scenario to disagree about. The overlay therefore disappears by deleting one
 * of its two layers rather than by growing a `lodging_availability_draft` twin.
 *
 * `state` (reserved_staff / reserved_other / released_to_family) collapses to
 * `family_available`. Those three were REASONS, not states -- the resolved
 * question is binary, and each value only meant anything read against the
 * unit's role, so `released_to_family` on a family_pool unit was storable and
 * meaningless. The reason survives as display-only text.
 *
 * EXPLICIT, not a reversal. The smaller encoding -- a row meaning "the
 * opposite of this unit's current default" -- was rejected: an ordinary
 * registry edit flipping a unit from family_pool to staff_default would
 * silently invert every existing row for it, turning a cabin closed for a
 * burst pipe into the one cabin RELEASED to families. Same shape as the
 * tombstone bug #1974 removed.
 *
 * DIVERGENCE FROM THE DESIGN DOC: it names the display column `reason`. The
 * table already carries `note` for exactly that, and it is empty, so `note` is
 * kept rather than adding `reason` and dropping `note` -- identical semantics,
 * one less schema change, and `set_availability` already writes it. The API
 * field is still called `reason`; `set_availability` and `_build_units` are the
 * only two places that translate, and a third would mean renaming the column.
 *
 * Safe to drop columns: the table has never held a row (verified 0 before
 * writing this). The up path REFUSES to run against a non-empty table -- or
 * against one it cannot read, since an unanswered question is not a "no" --
 * rather than silently discarding data.
 *
 * PocketBase v0.23 syntax: field properties are DIRECT, never inside
 * `options: {}`, which is silently ignored.
 */

const AVAIL_INDEX_WITH_SCENARIO =
  "CREATE UNIQUE INDEX `idx_lodging_avail_unique` ON `lodging_availability` (`session`, `year`, `scenario`, `unit`)";

const AVAIL_INDEX_WITHOUT_SCENARIO =
  "CREATE UNIQUE INDEX `idx_lodging_avail_unique` ON `lodging_availability` (`session`, `year`, `unit`)";

/**
 * Drop the named indexes, then add the replacements.
 *
 * Matched on NAME, not on the word "scenario": the down path replaces indexes
 * that no longer mention the column, so a text match would keep them and then
 * push a second index under the same name. Lifted verbatim from 1500000132,
 * which solved this exact problem for lodging_assignments.
 */
function replaceIndexes(col, dropNames, replacements) {
  col.indexes = col.indexes.filter(function (sql) {
    for (const name of dropNames) {
      if (sql.indexOf("`" + name + "`") !== -1) {
        return false;
      }
    }
    return true;
  });
  for (const sql of replacements) {
    col.indexes.push(sql);
  }
}

/**
 * Refuse to drop columns out from under real rows.
 *
 * The whole argument for altering this table in place rather than migrating
 * data is that it has never held a row. That is a claim about the database
 * this runs against, not about the one it was written against, so it is
 * checked here rather than trusted.
 */
function refuseIfPopulated(app) {
  let rows = [];
  try {
    rows = app.findRecordsByFilter("lodging_availability", "id != ''", "", 1, 0);
  } catch (err) {
    // FAIL CLOSED. `findRecordsByFilter` returns [] for an empty match -- it is
    // `findFirstRecordByFilter` that throws "no rows", and only that sentinel
    // is swallowed here. Anything else reaching this block is a query,
    // collection or database failure, and a guard that could not READ the
    // table must not go on to clear the way to DROP its columns: the bare
    // `catch {}` this replaces turned every such failure into "looks empty".
    const message = String((err && err.message) || err);
    if (message.indexOf("no rows in result set") === -1) {
      throw new Error(
        "lodging_availability could not be read, so its emptiness is unverified; " +
          "refusing to drop columns. Underlying error: " +
          message,
        { cause: err }
      );
    }
  }
  if (rows.length > 0) {
    throw new Error(
      "lodging_availability is not empty; this migration drops columns. " +
        "Decide what the existing rows should become before applying it."
    );
  }
}

migrate(
  (app) => {
    refuseIfPopulated(app);

    const col = app.findCollectionByNameOrId("lodging_availability");

    // Indexes first, exactly as 1500000132 does it: an index naming a dropped
    // column cannot be created, so removing the field while the old index text
    // survives fails validation.
    replaceIndexes(col, ["idx_lodging_avail_unique"], [AVAIL_INDEX_WITHOUT_SCENARIO]);

    col.fields.removeByName("scenario");
    col.fields.removeByName("state");

    // Idempotent: editing an already-applied migration silently skips it
    // (`_migrations` keys on filename), so every add in this codebase is
    // written to survive being run twice.
    //
    // required:false is LOAD-BEARING. PocketBase reads `required: true` on a
    // bool as "must be TRUE", not "must be present", so a required
    // family_available would reject every reservation -- which is most of the
    // writes this column exists for.
    if (!col.fields.getByName("family_available")) {
      col.fields.add(
        new Field({
          type: "bool",
          name: "family_available",
          required: false,
          presentable: false,
        })
      );
    }

    app.save(col);
  },
  (app) => {
    const col = app.findCollectionByNameOrId("lodging_availability");
    const scenariosCol = app.findCollectionByNameOrId("saved_scenarios");

    col.fields.removeByName("family_available");

    if (!col.fields.getByName("scenario")) {
      col.fields.add(
        new Field({
          type: "relation",
          name: "scenario",
          required: false,
          presentable: false,
          collectionId: scenariosCol.id,
          cascadeDelete: true,
          minSelect: null,
          maxSelect: 1,
        })
      );
    }
    // `required: true` restores 1500000118's shape exactly, which is the whole
    // job of a down path -- `scenario` above is `required: false` there and
    // stays that way for the same reason. Unlike a bool, `required` on a select
    // does mean "must be present", so this is the constraint the column
    // actually had. It applies on record save rather than on schema save, so
    // adding it back cannot fail here; any rows written since the up path
    // carry `family_available`, which this same block deletes.
    if (!col.fields.getByName("state")) {
      col.fields.add(
        new Field({
          type: "select",
          name: "state",
          required: true,
          presentable: false,
          values: ["reserved_staff", "reserved_other", "released_to_family"],
          maxSelect: 1,
        })
      );
    }

    replaceIndexes(col, ["idx_lodging_avail_unique"], [AVAIL_INDEX_WITH_SCENARIO]);
    app.save(col);
  }
);
