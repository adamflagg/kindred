/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: widen bunk_assignments' unique index to include `bunk`.
 * Resolves kindred#2259.
 *
 * kindred#2259: `findMatchingSession` derives a session for a CampMinder
 * bunk assignment by intersecting a person's enrolled sessions with the
 * sessions a bunk plan covers -- it has no way to see WHICH bunk the
 * assignment names. When one bunk plan spans several sessions and a person
 * is enrolled in more than one of them (95 of 97 measured cases in the
 * production snapshot are Family Camp households booking two or more
 * weekends under the same multi-session plan), every assignment that
 * person holds under that plan can resolve to the same session. The write
 * key -- `person:session:year` -- then collides across assignments that
 * are genuinely different (different bunks), and the OLD unique index
 * below enforced that collision at the database layer: the first sync of a
 * season rejected the second assignment outright (a `Stats.Errors`
 * increment logged and swallowed), and every sync after that silently
 * overwrote the first assignment with the second. Exactly one row survived
 * either way.
 *
 * THE FIX IS A WIDER GRAIN, NOT A SMARTER SESSION LOOKUP. The paired PR
 * also narrows session resolution using the specific bunk on each
 * assignment where the data allows it (a main+AG plan, where main and AG
 * bunks are disjoint sets) -- but kindred#2259's own Fix direction rules
 * out relying on that alone: a bunk shared across every session of its plan
 * (every family-camp bunk) carries no disambiguating signal at all, no
 * matter how it is queried. The two assignments in that case still resolve
 * to the same session. What must not happen is losing one of them, and
 * that is what this index widening guarantees: two rows for one person
 * under one plan can now coexist whenever they name different bunks, which
 * every CampMinder assignment does by construction (two assignments in the
 * same bunk are the same assignment).
 *
 * WHY THIS MIGRATION IS NOT ENOUGH ON ITS OWN -- and is deliberately paired
 * with a Go change in the same PR. Grain in this codebase is checked in at
 * least four places for `bunk_assignments`, and they must all move
 * together (see pocketbase/sync/bunk_assignments.go's comments at
 * processAssignment, preloadExistingAssignments and deleteOrphans): the
 * WRITE key, the PRELOAD key, the ORPHAN key (tracked in three places:
 * processAssignment's TrackProcessedCompositeKey call,
 * protectNonActiveStaffAssignments, and deleteOrphans's own key rebuild),
 * and this UNIQUE INDEX. Widening only the index without widening the Go
 * keys would still collapse assignments in memory before they ever reach
 * the database. Widening only the Go keys without this index would let a
 * duplicate-looking write through the Go layer only to be rejected by the
 * OLD index underneath it. Widening the write key and this index but not
 * the preload/orphan keys is the sharper trap: every row looks new on every
 * sync (preload never finds it), so a widened write either duplicates
 * forever or -- if the orphan key is also unwidened -- deleteOrphans
 * rebuilds the OLD, narrower key from disk, finds no match in
 * ProcessedKeys (which was tracked in the NEW, wider shape), and deletes
 * the very rows this migration exists to stop losing. The Go PR widens all
 * three non-database keys in the same change as this migration.
 *
 * SAFE TO WIDEN WITHOUT A GUARD. Going from (year, person, session) to
 * (year, person, session, bunk) only ADDS a distinguishing column to an
 * already-unique constraint -- every pair of rows the OLD index already
 * kept apart stays apart under the NEW one; the new column can only
 * separate rows further, never collide two that were previously distinct.
 * There is no way for existing data to violate the wider constraint, so
 * unlike 1500000147 (which re-keyed lodging's indexes onto a different
 * column and had to refuse the migration if any row could not be keyed by
 * the new column), this migration needs no pre-flight harm check.
 *
 * NEXT FREE MIGRATION NUMBER, RE-DERIVED. The campaign plan claimed 153 was
 * next; 1500000153 (kindred#2308) and 1500000154 (kindred#2323) were both
 * already taken by the time this shipped. Re-derived from `origin/main` at
 * write time: 1500000155 is the first free number.
 */

const COLLECTION_NAME = "bunk_assignments";
const OLD_INDEX_NAME = "idx_bunk_assignments_person_session_year";
const NEW_INDEX_NAME = "idx_bunk_assignments_person_session_bunk_year";

const OLD_INDEX_SQL =
  "CREATE UNIQUE INDEX `" +
  OLD_INDEX_NAME +
  "` ON `" +
  COLLECTION_NAME +
  "` (`year`, `person`, `session`)";

const NEW_INDEX_SQL =
  "CREATE UNIQUE INDEX `" +
  NEW_INDEX_NAME +
  "` ON `" +
  COLLECTION_NAME +
  "` (`year`, `person`, `session`, `bunk`)";

/**
 * Drop any index carrying `name`, matched on the name itself rather than on
 * indexOf against a column -- the same idempotency shape 1500000147 and
 * 1500000151 use. `_migrations` keys on filename, so editing an
 * already-applied migration silently skips it; matching by name is what
 * keeps a re-run from pushing a second copy under the same name.
 */
function withoutIndex(col, name) {
  return col.indexes.filter(function (sql) {
    return sql.indexOf("`" + name + "`") === -1;
  });
}

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId(COLLECTION_NAME);
    collection.indexes = withoutIndex(collection, OLD_INDEX_NAME);
    collection.indexes = withoutIndex(collection, NEW_INDEX_NAME);
    collection.indexes.push(NEW_INDEX_SQL);
    app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId(COLLECTION_NAME);
    collection.indexes = withoutIndex(collection, NEW_INDEX_NAME);
    collection.indexes = withoutIndex(collection, OLD_INDEX_NAME);
    collection.indexes.push(OLD_INDEX_SQL);
    app.save(collection);
  }
);
