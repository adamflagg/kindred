/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: re-key every lodging index off the `session` relation and onto
 * `session_cm_id`. Resolves kindred#2042.
 *
 * CLAUDE.md section 1: "all cross-table relationships use CampMinder IDs, never
 * PocketBase IDs. This is what keeps data intact across syncs." Four lodging
 * tables have carried BOTH since 1500000124 (#1879) -- a `session` relation and
 * a required `session_cm_id` -- and every unique index, every repository filter
 * and every write path keyed on the relation. The durable key sat beside them,
 * correct and unused.
 *
 * THE FAILURE MODE is narrower than a cascade delete, and worth stating
 * precisely because 1500000124 already fixed the cascade. `session` is
 * cascadeDelete:false on purpose there -- a session vanishing from one
 * CampMinder response must 400 rather than silently take its lodging rows -- so
 * the rows SURVIVE. What they do not survive is a camp_sessions record being
 * RECREATED rather than updated (a delete-and-re-add re-sync, a restore, a
 * manual repair): the new record gets a new PocketBase id, and every row keyed
 * on the old one is still sitting in the table but is unreachable through the
 * normal filters. camp_sessions is unique on (cm_id, year), so
 * (session_cm_id, year) selects exactly the same one row that (session, year)
 * did -- it just keeps doing so afterwards.
 *
 * ALL FOUR TABLES OR NONE. Raised by review against lodging_slot_merges alone
 * on #2040 and deliberately not fixed there: the newest table copies the shape
 * of its siblings, and making one of four diverge is worse than four being
 * consistently imperfect.
 *
 * READ THE LIVE SCHEMA, NOT THE MIGRATION FILES. 1500000119 declares
 * idx_lodging_assign_hh_live / idx_lodging_assign_person_live with `scenario`
 * as a fourth key column; the live indexes do not carry it, and
 * lodging_assignments has no `scenario` field at all (1500000132 dropped it).
 * The index text below was read out of the production snapshot's
 * `_collections.indexes`, not copied forward from 1500000119.
 *
 * THE PREDICATES ARE VERBATIM. `> 0`, never `!= ''`: PocketBase declares number
 * fields as NUMERIC DEFAULT 0 NOT NULL and SQLite evaluates `0 != ''` as TRUE,
 * so `!= ''` on a party grain captures every row of the OTHER grain and
 * collides them. The same trap applies to `session_cm_id` and is the reason
 * nothing here compares it to a string.
 *
 * THE LOOKUP INDEXES MOVE TOO. `idx_lodging_assign_session_year`,
 * `idx_lodging_draft_session_year` and `idx_lodging_avail_session_year` are
 * plain (non-unique) covering indexes for exactly the reads this change
 * re-keys. Leaving them on `session` would index a column no lodging read
 * filters on any more and leave every roster read unindexed -- a silent full
 * scan rather than a wrong answer, but pointless either way.
 *
 * THE RELATION STAYS. `session` is still written on every row and is still what
 * an expand-based read joins through; it stops being an IDENTITY, not a column.
 * Dropping it is a separate decision with its own callers.
 *
 * HARM CHECK, run against the production snapshot before writing this: all 67
 * lodging_assignments, 61 lodging_assignments_draft, 2 lodging_slot_merges and
 * 8 lodging_availability rows carry session_cm_id > 0, and no camp_sessions
 * record has ever actually been recreated -- so this is a structural fix
 * against a latent risk, producing zero orphans and zero index collisions.
 */

/**
 * The index set as it exists BEFORE this migration, keyed on the relation.
 * Read out of the live `_collections.indexes`, one entry per index NAME.
 */
const ON_RELATION = {
  lodging_assignments: {
    idx_lodging_assign_session_year:
      "CREATE INDEX `idx_lodging_assign_session_year` ON `lodging_assignments` (`session`, `year`)",
    idx_lodging_assign_hh_live:
      "CREATE UNIQUE INDEX `idx_lodging_assign_hh_live` ON `lodging_assignments` " +
      "(`session`, `year`, `household_cm_id`) WHERE `household_cm_id` > 0",
    idx_lodging_assign_person_live:
      "CREATE UNIQUE INDEX `idx_lodging_assign_person_live` ON `lodging_assignments` " +
      "(`session`, `year`, `person_cm_id`) WHERE `person_cm_id` > 0",
  },
  lodging_assignments_draft: {
    idx_lodging_draft_session_year:
      "CREATE INDEX `idx_lodging_draft_session_year` ON `lodging_assignments_draft` (`session`, `year`)",
    idx_lodging_draft_hh:
      "CREATE UNIQUE INDEX `idx_lodging_draft_hh` ON `lodging_assignments_draft` " +
      "(`session`, `year`, `household_cm_id`, `scenario`) WHERE `household_cm_id` > 0",
    idx_lodging_draft_person:
      "CREATE UNIQUE INDEX `idx_lodging_draft_person` ON `lodging_assignments_draft` " +
      "(`session`, `year`, `person_cm_id`, `scenario`) WHERE `person_cm_id` > 0",
  },
  lodging_slot_merges: {
    idx_lodging_slot_merge_unique:
      "CREATE UNIQUE INDEX `idx_lodging_slot_merge_unique` ON `lodging_slot_merges` " +
      "(`unit`, `session`, `year`, `scenario`)",
  },
  lodging_availability: {
    idx_lodging_avail_session_year:
      "CREATE INDEX `idx_lodging_avail_session_year` ON `lodging_availability` (`session`, `year`)",
    idx_lodging_avail_unique:
      "CREATE UNIQUE INDEX `idx_lodging_avail_unique` ON `lodging_availability` (`session`, `year`, `unit`)",
  },
};

/**
 * The same index set keyed on the durable CampMinder id. Same names, same key
 * ORDER, same partial predicates -- one column substituted.
 */
const ON_CM_ID = {
  lodging_assignments: {
    idx_lodging_assign_session_year:
      "CREATE INDEX `idx_lodging_assign_session_year` ON `lodging_assignments` (`session_cm_id`, `year`)",
    idx_lodging_assign_hh_live:
      "CREATE UNIQUE INDEX `idx_lodging_assign_hh_live` ON `lodging_assignments` " +
      "(`session_cm_id`, `year`, `household_cm_id`) WHERE `household_cm_id` > 0",
    idx_lodging_assign_person_live:
      "CREATE UNIQUE INDEX `idx_lodging_assign_person_live` ON `lodging_assignments` " +
      "(`session_cm_id`, `year`, `person_cm_id`) WHERE `person_cm_id` > 0",
  },
  lodging_assignments_draft: {
    idx_lodging_draft_session_year:
      "CREATE INDEX `idx_lodging_draft_session_year` ON `lodging_assignments_draft` (`session_cm_id`, `year`)",
    idx_lodging_draft_hh:
      "CREATE UNIQUE INDEX `idx_lodging_draft_hh` ON `lodging_assignments_draft` " +
      "(`session_cm_id`, `year`, `household_cm_id`, `scenario`) WHERE `household_cm_id` > 0",
    idx_lodging_draft_person:
      "CREATE UNIQUE INDEX `idx_lodging_draft_person` ON `lodging_assignments_draft` " +
      "(`session_cm_id`, `year`, `person_cm_id`, `scenario`) WHERE `person_cm_id` > 0",
  },
  lodging_slot_merges: {
    idx_lodging_slot_merge_unique:
      "CREATE UNIQUE INDEX `idx_lodging_slot_merge_unique` ON `lodging_slot_merges` " +
      "(`unit`, `session_cm_id`, `year`, `scenario`)",
  },
  lodging_availability: {
    idx_lodging_avail_session_year:
      "CREATE INDEX `idx_lodging_avail_session_year` ON `lodging_availability` (`session_cm_id`, `year`)",
    idx_lodging_avail_unique:
      "CREATE UNIQUE INDEX `idx_lodging_avail_unique` ON `lodging_availability` (`session_cm_id`, `year`, `unit`)",
  },
};

/**
 * Drop the named indexes, then add the replacements.
 *
 * Matched on NAME, not on the word being replaced: the down path replaces
 * indexes that no longer mention `session_cm_id`, so a text match on the
 * column would keep them and then push a second index under the same name.
 * Lifted verbatim from 1500000135, which lifted it from 1500000132.
 *
 * Idempotent by construction -- editing an already-applied migration silently
 * skips it (`_migrations` keys on filename), so re-running this must not
 * duplicate an index. Filtering by name before pushing is what makes a second
 * run a no-op rather than a validation error.
 */
function replaceIndexes(col, byName) {
  const names = Object.keys(byName);
  col.indexes = col.indexes.filter(function (sql) {
    for (const name of names) {
      if (sql.indexOf("`" + name + "`") !== -1) {
        return false;
      }
    }
    return true;
  });
  for (const name of names) {
    col.indexes.push(byName[name]);
  }
}

/**
 * Refuse to build a unique index on a column that cannot key the rows.
 *
 * `session_cm_id` is `required: true, min: 1` on all four tables (1500000124),
 * so every row should carry a real CampMinder id -- but that is a claim about
 * the database this runs against, not the one it was written against, and a
 * row carrying 0 would collide with every other 0-row under the new unique
 * indexes instead of staying distinct by relation.
 *
 * FAILS CLOSED. `findRecordsByFilter` returns [] for an empty match; only
 * `findFirstRecordByFilter` throws the "no rows" sentinel. Anything reaching
 * the catch here is a query, collection or database failure, and a guard that
 * could not READ the table must not clear the way to re-key its unique indexes.
 */
function refuseIfSessionKeyMissing(app, name) {
  let rows;
  try {
    rows = app.findRecordsByFilter(name, "session_cm_id < 1", "", 1, 0);
  } catch (err) {
    throw new Error(
      name +
        " could not be read, so its session_cm_id coverage is unverified; " +
        "refusing to re-key its unique indexes. Underlying error: " +
        String((err && err.message) || err),
      { cause: err }
    );
  }
  if (rows.length > 0) {
    throw new Error(
      name +
        " holds row(s) with no session_cm_id, which the re-keyed unique indexes " +
        "would collide rather than keep distinct. Backfill session_cm_id from the " +
        "session relation before applying this migration."
    );
  }
}

function applyIndexSet(app, set, guard) {
  for (const name of Object.keys(set)) {
    if (guard) {
      refuseIfSessionKeyMissing(app, name);
    }
    const col = app.findCollectionByNameOrId(name);
    replaceIndexes(col, set[name]);
    app.save(col);
  }
}

migrate(
  (app) => {
    applyIndexSet(app, ON_CM_ID, true);
  },
  (app) => {
    // No guard on the way back: `session` is required on all four tables, so
    // the relation is always populated, and the down path is restoring the
    // shape that was already live.
    applyIndexSet(app, ON_RELATION, false);
  }
);
