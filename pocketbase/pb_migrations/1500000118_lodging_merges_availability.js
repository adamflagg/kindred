/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: lodging_merges + lodging_availability
 *
 * lodging_merges binds an explicit SET of atomic units into one bookable slot
 * for one weekend. Member sets rather than parent/child toggles because merges
 * are frequently partial: a single staff-written string routinely merges 2
 * rooms of a 4-room building,
 * which a parent-activation model cannot express.
 *
 * Merges are created MID-ASSIGNMENT as a board action (select adjacent rooms,
 * drop the party), not pre-configured. scenario is nullable: null = the session's
 * live plan. Two scenarios of one weekend may merge differently.
 *
 * lodging_availability locks units out of the family pool, in both directions:
 *   family_pool   + reserved_staff/reserved_other  -> not family-available
 *   staff_default + (no row)                       -> not family-available
 *   staff_default + released_to_family             -> family-available
 * reserved_other covers maintenance and out-of-service so those are not
 * misfiled as staff housing.
 */

migrate((app) => {
  const unitsCol = app.findCollectionByNameOrId("lodging_units");
  const sessionsCol = app.findCollectionByNameOrId("camp_sessions");
  const scenariosCol = app.findCollectionByNameOrId("saved_scenarios");

  const merges = new Collection({
    type: "base",
    name: "lodging_merges",
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.is_admin = true',
    updateRule: '@request.auth.is_admin = true',
    deleteRule: '@request.auth.is_admin = true',
    fields: [
      {
        type: "relation", name: "session", required: true, presentable: false,
        collectionId: sessionsCol.id, cascadeDelete: true, minSelect: null, maxSelect: 1
      },
      { type: "number", name: "year", required: true, presentable: false, min: 2010, max: 2100, onlyInt: true },
      {
        type: "relation", name: "scenario", required: false, presentable: false,
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
      "CREATE INDEX `idx_lodging_merges_session_year` ON `lodging_merges` (`session`, `year`)",
      "CREATE INDEX `idx_lodging_merges_scenario` ON `lodging_merges` (`scenario`)"
    ]
  });
  app.save(merges);

  const availability = new Collection({
    type: "base",
    name: "lodging_availability",
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.is_admin = true',
    updateRule: '@request.auth.is_admin = true',
    deleteRule: '@request.auth.is_admin = true',
    fields: [
      {
        type: "relation", name: "session", required: true, presentable: false,
        collectionId: sessionsCol.id, cascadeDelete: true, minSelect: null, maxSelect: 1
      },
      { type: "number", name: "year", required: true, presentable: false, min: 2010, max: 2100, onlyInt: true },
      {
        type: "relation", name: "scenario", required: false, presentable: false,
        collectionId: scenariosCol.id, cascadeDelete: true, minSelect: null, maxSelect: 1
      },
      {
        type: "relation", name: "unit", required: true, presentable: false,
        collectionId: unitsCol.id, cascadeDelete: true, minSelect: null, maxSelect: 1
      },
      {
        type: "select", name: "state", required: true, presentable: false,
        values: ["reserved_staff", "reserved_other", "released_to_family"], maxSelect: 1
      },
      { type: "text", name: "note", required: false, presentable: false, min: 0, max: 2000, pattern: "" },
      { type: "autodate", name: "created", required: false, presentable: false, onCreate: true, onUpdate: false },
      { type: "autodate", name: "updated", required: false, presentable: false, onCreate: true, onUpdate: true }
    ],
    indexes: [
      "CREATE INDEX `idx_lodging_avail_session_year` ON `lodging_availability` (`session`, `year`)",
      "CREATE INDEX `idx_lodging_avail_unit` ON `lodging_availability` (`unit`)",
      // At most one override per unit per session/scenario. Without this, a unit
      // could hold both a reserved_staff row and a released_to_family row for the
      // same (session, year, scenario), making "is this unit family-available?"
      // non-deterministic. No WHERE predicate is needed: scenario is
      // `TEXT DEFAULT '' NOT NULL`, so live (scenario-less) rows key on '' naturally.
      "CREATE UNIQUE INDEX `idx_lodging_avail_unique` ON `lodging_availability` (`session`, `year`, `scenario`, `unit`)"
    ]
  });
  app.save(availability);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("lodging_availability"));
  app.delete(app.findCollectionByNameOrId("lodging_merges"));
});
