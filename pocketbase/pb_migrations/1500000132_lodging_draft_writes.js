/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: the lodging draft write layer.
 * Dependencies: lodging collections (1500000116-1500000124), lodging RBAC (1500000130),
 *               saved_scenarios (1500000021)
 *
 * THE WRITE TARGET IS A DRAFT TABLE, NOT A SCENARIO COLUMN
 *
 * `lodging_assignments` gets a twin, `lodging_assignments_draft`, and
 * `lodging_merges` gets `lodging_merges_draft`. The truth tables stay
 * `is_admin` and the ingest keeps sole ownership of them.
 *
 * This mirrors summer exactly, and summer's shape is the argument:
 *
 *   bunk_assignments        (year, person, session)             --        is_admin
 *   bunk_assignments_draft  (year, session, person, scenario)   scenario  is_admin || bunking.manage
 *
 * The rejected alternative was to widen `lodging_assignments` and scope staff
 * to non-empty scenarios via a `scenario != ""` write rule. That is a guard by
 * convention: one string edit from opening the synced rows, and it makes every
 * reader responsible for a filter. Scenario is a property of PLANNING, not of
 * record, and summer encodes exactly that by putting the column only on the
 * draft.
 *
 * THE DEAD SCENARIO COLUMN
 *
 * `lodging_assignments` and `lodging_merges` were created carrying a `scenario`
 * relation, and the assignments table keys its live unique indexes on it. That
 * is an artifact rather than a design -- the original field list does not
 * contain it, and all 67 assignment rows have `scenario = ''` (verified before
 * writing this). It is dropped here, in the same migration that introduces the
 * real one, so a later session does not find a third trap.
 *
 * `lodging_availability` KEEPS its scenario column and gets no twin. The
 * argument above turns on protecting rows the ingest owns, and nothing syncs
 * into availability -- it is empty, and the only writer it will ever have is
 * the board. There is no record of truth there to guard, so a twin would be
 * ceremony. It was already widened to bunking.manage by 1500000130.
 *
 * WHAT STAYS ADMIN-ONLY
 *
 * `lodging_assignments`, `lodging_assignment_history` and
 * `lodging_field_mappings`. 1500000130 deferred the first two explicitly --
 * "widen them in the PR that adds the writer" -- and the answer this PR gives
 * is that the writer never touches them. Summer has never granted
 * bunking.manage on `bunk_assignments` or `attendee_status_history` either.
 *
 * `lodging_merges` is NOT in that list and is left as 1500000130 set it:
 * staff-writable under bunking.manage, alongside areas, units, aliases and
 * availability. That is the uniform lodging rule -- reads open, writes
 * admin || bunking.manage -- and this migration does not change it. So the
 * draft twin here buys SCENARIO ISOLATION, not write protection: it keeps a
 * planning merge out of the row the ingest dedupes against. Whether the twin
 * now makes the truth grain admin-only the more consistent choice is
 * kindred#1916, deliberately left to its own PR rather than smuggled into a
 * migration whose subject is the draft tables.
 *
 * READS STAY OPEN, DRAFTS INCLUDED. summer gates list/view on
 * `bunk_assignments_draft`; lodging deliberately does not, because every other
 * `lodging_*` collection is readable by any authenticated user (1500000130) and
 * the board's no-scenario mode is a READ-ONLY mirror for everyone. Gating draft
 * reads would blank a scenario board for a user without bunking.manage rather
 * than freeze it, which is the opposite of the intended degradation.
 *
 * PocketBase v0.23 syntax: field properties are DIRECT, never inside
 * `options: {}`, which is silently ignored.
 */

const AUTHED_READ = '@request.auth.id != ""';
const BUNKING_MANAGE =
  '@request.auth.is_admin = true || @request.auth.cached_permissions ~ "bunking.manage"';

// The two truth grains that carry the dead column, and the indexes on each that
// key on it. Rebuilt without `scenario`; the `> 0` predicates are preserved
// verbatim, because PocketBase numbers are `NUMERIC DEFAULT 0 NOT NULL` and
// SQLite evaluates `0 != ''` as TRUE -- with `!= ''` the household index would
// capture every person-grain row (household_cm_id = 0), collide them, and
// permit only ONE adult assignment per session.
const ASSIGNMENT_INDEXES_WITHOUT_SCENARIO = [
  "CREATE UNIQUE INDEX `idx_lodging_assign_hh_live` ON `lodging_assignments` (`session`, `year`, `household_cm_id`) WHERE `household_cm_id` > 0",
  "CREATE UNIQUE INDEX `idx_lodging_assign_person_live` ON `lodging_assignments` (`session`, `year`, `person_cm_id`) WHERE `person_cm_id` > 0",
];

const ASSIGNMENT_INDEXES_WITH_SCENARIO = [
  "CREATE UNIQUE INDEX `idx_lodging_assign_hh_live` ON `lodging_assignments` (`session`, `year`, `household_cm_id`, `scenario`) WHERE `household_cm_id` > 0",
  "CREATE UNIQUE INDEX `idx_lodging_assign_person_live` ON `lodging_assignments` (`session`, `year`, `person_cm_id`, `scenario`) WHERE `person_cm_id` > 0",
];

const MERGES_SCENARIO_INDEX =
  "CREATE INDEX `idx_lodging_merges_scenario` ON `lodging_merges` (`scenario`)";

const ASSIGNMENT_INDEX_NAMES = ["idx_lodging_assign_hh_live", "idx_lodging_assign_person_live"];

/**
 * Drop the named indexes, then add the replacements.
 *
 * Matched on NAME, not on the word "scenario": the down path replaces indexes
 * that no longer mention the column, so a text match would keep them and then
 * push a second index under the same name.
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

migrate((app) => {
  const unitsCol = app.findCollectionByNameOrId("lodging_units");
  const mergesCol = app.findCollectionByNameOrId("lodging_merges");
  const sessionsCol = app.findCollectionByNameOrId("camp_sessions");
  const scenariosCol = app.findCollectionByNameOrId("saved_scenarios");

  // ---------------------------------------------------------- merges draft
  //
  // Created before the assignments draft, which relates to it.
  //
  // Merges are a board action (select adjacent rooms, drop the party), not a
  // pre-configured registry fact, so the draft twin is where the board makes
  // them. NOTHING VALIDATES THE MEMBER SET, deliberately: a merge-legality
  // rule -- members are the complete child set of some container -- was built
  // through nine tasks and removed in #1903, because every member set is
  // hand-authored, so a deliberate partial booking and a mis-click produce
  // byte-identical rows. See docs/architecture/lodging-occupancy.md before
  // proposing anything like it again.
  const mergesDraft = new Collection({
    type: "base",
    name: "lodging_merges_draft",
    listRule: AUTHED_READ,
    viewRule: AUTHED_READ,
    createRule: BUNKING_MANAGE,
    updateRule: BUNKING_MANAGE,
    deleteRule: BUNKING_MANAGE,
    fields: [
      // cascadeDelete false, and `session` required, for kindred#1879: a
      // camp_session vanishing from one CampMinder response must fail the
      // orphan delete with a 400 rather than silently taking its lodging rows.
      {
        type: "relation", name: "session", required: true, presentable: false,
        collectionId: sessionsCol.id, cascadeDelete: false, minSelect: null, maxSelect: 1
      },
      { type: "number", name: "session_cm_id", required: true, presentable: false, min: 1, max: null, onlyInt: true },
      { type: "number", name: "year", required: true, presentable: false, min: 2010, max: 2100, onlyInt: true },
      // REQUIRED, unlike the truth table's nullable column and unlike summer's
      // draft. A draft row with no scenario would shadow the CampMinder mirror
      // for everyone in production mode, which is precisely the read-only
      // guarantee the no-scenario board rests on. cascadeDelete true so
      // deleting a saved scenario sweeps its drafts server-side -- summer's
      // draft was created with false and flipped exactly to delete an N+1
      // client-side pre-delete loop.
      {
        type: "relation", name: "scenario", required: true, presentable: false,
        collectionId: scenariosCol.id, cascadeDelete: true, minSelect: null, maxSelect: 1
      },
      {
        type: "relation", name: "member_units", required: true, presentable: false,
        collectionId: unitsCol.id, cascadeDelete: false, minSelect: 2, maxSelect: 20
      },
      { type: "text", name: "display_name", required: false, presentable: true, min: 0, max: 200, pattern: "" },
      { type: "number", name: "capacity_override", required: false, presentable: false, min: null, max: null, onlyInt: true },
      { type: "text", name: "created_by", required: false, presentable: false, min: 0, max: 200, pattern: "" },
      { type: "autodate", name: "created", required: false, presentable: false, onCreate: true, onUpdate: false },
      { type: "autodate", name: "updated", required: false, presentable: false, onCreate: true, onUpdate: true }
    ],
    indexes: [
      "CREATE INDEX `idx_lodging_merges_draft_session_year` ON `lodging_merges_draft` (`session`, `year`)",
      "CREATE INDEX `idx_lodging_merges_draft_scenario` ON `lodging_merges_draft` (`scenario`)"
    ]
  });
  app.save(mergesDraft);

  // ----------------------------------------------------- assignments draft
  const assignmentsDraft = new Collection({
    type: "base",
    name: "lodging_assignments_draft",
    listRule: AUTHED_READ,
    viewRule: AUTHED_READ,
    createRule: BUNKING_MANAGE,
    updateRule: BUNKING_MANAGE,
    deleteRule: BUNKING_MANAGE,
    fields: [
      {
        type: "relation", name: "session", required: true, presentable: false,
        collectionId: sessionsCol.id, cascadeDelete: false, minSelect: null, maxSelect: 1
      },
      { type: "number", name: "session_cm_id", required: true, presentable: false, min: 1, max: null, onlyInt: true },
      { type: "number", name: "year", required: true, presentable: false, min: 2010, max: 2100, onlyInt: true },
      {
        type: "relation", name: "scenario", required: true, presentable: false,
        collectionId: scenariosCol.id, cascadeDelete: true, minSelect: null, maxSelect: 1
      },
      // THREE possible targets, not two. `unit` is an atomic room; `merge` is a
      // slot the INGEST built (six historical merges are seeded, and a board in
      // scenario mode must be able to place a party onto one); `merge_draft` is
      // a slot the board built in this scenario. A PocketBase relation names
      // one collection, so expressing "either kind of merge" takes two fields.
      //
      // As on the truth table, NO XOR IS ENFORCED HERE -- the fields are all
      // optional, there is no CHECK constraint, and the partial unique indexes
      // dedupe within a grain only. A row with two targets, or none, is
      // accepted by the DB. The invariant lives above the database; a row with
      // NO target is in fact meaningful and is how the API records "staff
      // explicitly unplaced this party in this scenario", which is not the same
      // as the party having no draft row at all.
      {
        type: "relation", name: "unit", required: false, presentable: false,
        collectionId: unitsCol.id, cascadeDelete: false, minSelect: null, maxSelect: 1
      },
      {
        type: "relation", name: "merge", required: false, presentable: false,
        collectionId: mergesCol.id, cascadeDelete: false, minSelect: null, maxSelect: 1
      },
      {
        type: "relation", name: "merge_draft", required: false, presentable: false,
        collectionId: mergesDraft.id, cascadeDelete: false, minSelect: null, maxSelect: 1
      },
      // Dual grain, exactly as the truth table: family camp places HOUSEHOLDS,
      // adult weekends place PERSONS, and a person row overrides its
      // household's.
      { type: "number", name: "household_cm_id", required: false, presentable: false, min: null, max: null, onlyInt: true },
      { type: "number", name: "person_cm_id", required: false, presentable: false, min: null, max: null, onlyInt: true },
      { type: "number", name: "party_size", required: false, presentable: false, min: null, max: null, onlyInt: true },
      {
        type: "select", name: "source", required: false, presentable: false,
        values: ["campminder_sync", "jotform_sync", "staff_manual"], maxSelect: 1
      },
      { type: "bool", name: "staff_touched", required: false, presentable: false },
      { type: "autodate", name: "created", required: false, presentable: false, onCreate: true, onUpdate: false },
      { type: "autodate", name: "updated", required: false, presentable: false, onCreate: true, onUpdate: true }
    ],
    indexes: [
      "CREATE INDEX `idx_lodging_draft_session_year` ON `lodging_assignments_draft` (`session`, `year`)",
      "CREATE INDEX `idx_lodging_draft_scenario` ON `lodging_assignments_draft` (`scenario`)",
      // The summer shape carried onto the dual grain: one row per party per
      // session PER SCENARIO. Same `> 0` predicates as the truth table, and for
      // the same reason -- a person-grain row still stores household_cm_id = 0,
      // so `!= ''` would collide every one of them and permit a single adult
      // placement per session. Do not "simplify" these.
      "CREATE UNIQUE INDEX `idx_lodging_draft_hh` ON `lodging_assignments_draft` (`session`, `year`, `household_cm_id`, `scenario`) WHERE `household_cm_id` > 0",
      "CREATE UNIQUE INDEX `idx_lodging_draft_person` ON `lodging_assignments_draft` (`session`, `year`, `person_cm_id`, `scenario`) WHERE `person_cm_id` > 0"
    ]
  });
  app.save(assignmentsDraft);

  // ------------------------------------------- drop the dead truth columns
  //
  // The indexes go first in the same in-memory collection: an index naming a
  // dropped column cannot be created, so removing the field while the old
  // index text survives would fail validation.
  const assignments = app.findCollectionByNameOrId("lodging_assignments");
  replaceIndexes(assignments, ASSIGNMENT_INDEX_NAMES, ASSIGNMENT_INDEXES_WITHOUT_SCENARIO);
  assignments.fields.removeByName("scenario");
  app.save(assignments);

  const merges = app.findCollectionByNameOrId("lodging_merges");
  replaceIndexes(merges, ["idx_lodging_merges_scenario"], []);
  merges.fields.removeByName("scenario");
  app.save(merges);
}, (app) => {
  const scenariosCol = app.findCollectionByNameOrId("saved_scenarios");

  // Restore the dead columns before dropping the drafts, so the down path
  // leaves the same schema the up path found.
  const merges = app.findCollectionByNameOrId("lodging_merges");
  merges.fields.add(new Field({
    type: "relation", name: "scenario", required: false, presentable: false,
    collectionId: scenariosCol.id, cascadeDelete: true, minSelect: null, maxSelect: 1
  }));
  merges.indexes.push(MERGES_SCENARIO_INDEX);
  app.save(merges);

  const assignments = app.findCollectionByNameOrId("lodging_assignments");
  assignments.fields.add(new Field({
    type: "relation", name: "scenario", required: false, presentable: false,
    collectionId: scenariosCol.id, cascadeDelete: true, minSelect: null, maxSelect: 1
  }));
  replaceIndexes(assignments, ASSIGNMENT_INDEX_NAMES, ASSIGNMENT_INDEXES_WITH_SCENARIO);
  app.save(assignments);

  app.delete(app.findCollectionByNameOrId("lodging_assignments_draft"));
  app.delete(app.findCollectionByNameOrId("lodging_merges_draft"));
});
