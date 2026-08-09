/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: weekend friend groups — a staff-authored set of HOUSEHOLDS.
 * Dependencies: camp_sessions (core), lodging RBAC (1500000130).
 *
 * kindred#1913 half 1. Summer's analogue is `locked_groups` /
 * `locked_group_members`; this is the same idea one program over, at the grain
 * a weekend actually enrols at. Three things differ from summer, each on
 * purpose, and each is argued below rather than left to be discovered.
 *
 * THE MEMBER IS A HOUSEHOLD CampMinder ID, NOT A RELATION
 *
 * Summer's member row holds `attendee` — a PocketBase relation. This one holds
 * `household_cm_id`, a number, because that is what every other household-grain
 * lodging row holds: `lodging_assignments` and `lodging_assignments_draft` both
 * key on `household_cm_id`, and the repo-wide rule is that cross-table
 * relationships use CampMinder ids so they survive a resync (CLAUDE.md §1).
 * A relation to `households` would be the one household-grain lodging column
 * that a re-sync could repoint.
 *
 * THERE IS NO `scenario` COLUMN, AND THAT IS THE DIVERGENCE FROM SUMMER
 *
 * `locked_groups.scenario` is required: summer treats a lock group as part of
 * a plan. This table follows `lodging_availability` instead, whose scenario
 * dimension 1500000135 deleted, and for the same shape of reason. A friend
 * group records what households ASKED FOR — "these two families want the same
 * cabin" is true of the weekend in every plan for it, exactly as a burst pipe
 * is. It is an INPUT to placement, not a placement.
 *
 * The practical half of the argument is stronger than the theoretical one. The
 * weekend board's default state is NO scenario — the CampMinder mirror — and
 * that is where staff land on every fresh visit. A scenario-scoped group would
 * be invisible there, and would have to be re-authored in each scenario a
 * planner tried. Nothing about the object wants that.
 *
 * `year` IS REQUIRED, like every CampMinder-adjacent table here
 *
 * Not ceremony: CampMinder REUSES session ids across years, and membership is
 * spelled with `household_cm_id`, which is only meaningful against a
 * particular season's roster. A group with no year could not be told apart
 * from last year's group for the same weekend. `session` is carried BESIDE it
 * as a relation for joins, with `session_cm_id` as the durable key — the
 * #1879 pattern every neighbouring lodging table uses, and `cascadeDelete:
 * false` for the reason #1879 gives: a camp_session vanishing from one
 * CampMinder response must fail the orphan delete with a 400 rather than
 * silently taking its lodging rows.
 *
 * THERE IS NO `intent` COLUMN, AND THAT IS AN OWNER RULING, NOT AN OMISSION
 *
 * A friend group is "lock these households together," full stop. Whether
 * that means the same cabin (NEAR is satisfied by distance between units,
 * WITH only by putting both parties in one room) is a property of whatever
 * later CONSUMES the group -- the solver tool kindred#1913 half 2 will
 * build -- not of the group itself. An earlier revision stored it here; the
 * owner struck it before this migration ever reached production, so removing
 * it cost nothing but a line in an unapplied migration rather than a second,
 * required-column migration after the fact.
 *
 * `source` IS THE SEAM, AND IS THE WHOLE OF IT
 *
 * The issue asks for a place a later solver or "processed requests" pipeline
 * can plug into, while explicitly not building one. Recording WHAT created a
 * group is the cheap version: a proposer writes `proposed` into the same
 * table, and every reader already handles it. No other accommodation is made
 * for a machine author, and none should be until one exists.
 *
 * NOTHING ENFORCES THAT A HOUSEHOLD BELONGS TO AT MOST ONE GROUP
 *
 * Deliberate. A household can legitimately want to be locked with one family
 * and separately with a different one, which is two groups, not a conflict.
 * The unique index below is per-group only: a household appears at most once
 * INSIDE a group. Summer has the same permissiveness and warns in the UI
 * rather than in the schema.
 *
 * PocketBase v0.23 syntax: field properties are DIRECT, never inside
 * `options: {}`, which is silently ignored.
 */

const AUTHED_READ = '@request.auth.id != ""';
const BUNKING_MANAGE =
  '@request.auth.is_admin = true || @request.auth.cached_permissions ~ "bunking.manage"';

migrate((app) => {
  const sessionsCol = app.findCollectionByNameOrId("camp_sessions");

  // Reads stay open to any authenticated user, as every other `lodging_*`
  // collection is (1500000130): a viewer looking at the read-only mirror board
  // needs to see that two families are grouped, even though they may not edit
  // it. Writes are `bunking.manage`, the same gate the placement drafts use --
  // the people who do this job are bunking staff, not admins.
  const groups = new Collection({
    type: "base",
    name: "lodging_friend_groups",
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
      // Optional: a blank name means "show the auto-name derived from the
      // members' surnames", which is summer's behaviour and is computed at
      // render rather than frozen into the row. Storing the auto-name would
      // go stale the moment membership changed.
      { type: "text", name: "name", required: false, presentable: true, min: 0, max: 200, pattern: "" },
      // A hex triplet from the nine-colour palette the UI offers. Not a
      // select: the palette is a presentation choice that belongs in the
      // frontend, and pinning it here would need a migration to add a colour.
      { type: "text", name: "color", required: true, presentable: false, min: 0, max: 7, pattern: "^#[0-9a-fA-F]{6}$" },
      {
        type: "select", name: "source", required: true, presentable: false,
        values: ["staff_manual", "proposed"], maxSelect: 1
      },
      { type: "text", name: "created_by", required: false, presentable: false, min: 0, max: 200, pattern: "" },
      { type: "autodate", name: "created", required: false, presentable: false, onCreate: true, onUpdate: false },
      { type: "autodate", name: "updated", required: false, presentable: false, onCreate: true, onUpdate: true }
    ],
    indexes: [
      "CREATE INDEX `idx_lodging_friend_groups_session_year` ON `lodging_friend_groups` (`session`, `year`)"
    ]
  });
  app.save(groups);

  const members = new Collection({
    type: "base",
    name: "lodging_friend_group_members",
    listRule: AUTHED_READ,
    viewRule: AUTHED_READ,
    createRule: BUNKING_MANAGE,
    updateRule: BUNKING_MANAGE,
    deleteRule: BUNKING_MANAGE,
    fields: [
      // cascadeDelete TRUE, unlike the `session` relation above: dissolving a
      // group must take its membership with it, and there is nothing to
      // protect -- a member row has no meaning without its group. Summer's
      // `locked_group_members` cascades for the same reason.
      {
        type: "relation", name: "group", required: true, presentable: false,
        collectionId: groups.id, cascadeDelete: true, minSelect: null, maxSelect: 1
      },
      // `min: 1` is load-bearing, not decoration. 0 is the wire value a
      // person-grain roster party carries in this column, so a 0 here would be
      // a member that matches every adult-weekend guest at once.
      { type: "number", name: "household_cm_id", required: true, presentable: false, min: 1, max: null, onlyInt: true },
      { type: "text", name: "added_by", required: false, presentable: false, min: 0, max: 200, pattern: "" },
      { type: "autodate", name: "created", required: false, presentable: false, onCreate: true, onUpdate: false }
    ],
    indexes: [
      "CREATE INDEX `idx_lodging_fg_members_group` ON `lodging_friend_group_members` (`group`)",
      // Per-group only. A household may sit in more than one group on the same
      // weekend -- see the header -- but never twice in the same one.
      "CREATE UNIQUE INDEX `idx_lodging_fg_members_unique` ON `lodging_friend_group_members` (`group`, `household_cm_id`)"
    ]
  });
  app.save(members);
}, (app) => {
  // Members first: the relation cascades, but deleting the parent collection
  // while a child still points at it is not something to rely on.
  app.delete(app.findCollectionByNameOrId("lodging_friend_group_members"));
  app.delete(app.findCollectionByNameOrId("lodging_friend_groups"));
});
