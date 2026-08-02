/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: lodging_areas + lodging_units
 *
 * Canonical registry of weekend-program housing. Populated on boot from the
 * private config/lodging_registry.json (docs/reference/lodging-registry.md),
 * and fully editable in the Family Camp admin UI — no unit list lives in
 * source code. 1500000120 seeded it until the data moved out of this repo.
 *
 * lodging_units holds ATOMIC rooms. Merges (e.g. "Tenaya 1and2") are separate
 * rows in lodging_merges, not parent activations, because merges are frequently
 * partial (2 of a 4-room building).
 *
 * bathroom is none|private|shared. "none" means no bathroom with respect to your
 * housing — a bathhouse walk is "none". private-vs-shared depends on merge state,
 * so bathroom_group identifies the set of units sharing one bathroom: a merge
 * covering an entire group upgrades the slot's effective bathroom to private.
 */

migrate((app) => {
  const areas = new Collection({
    type: "base",
    name: "lodging_areas",
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.is_admin = true',
    updateRule: '@request.auth.is_admin = true',
    deleteRule: '@request.auth.is_admin = true',
    fields: [
      { type: "text", name: "name", required: true, presentable: true, min: 1, max: 100, pattern: "" },
      { type: "text", name: "code", required: true, presentable: false, min: 1, max: 20, pattern: "" },
      { type: "number", name: "map_x", required: false, presentable: false, min: 0, max: 1, onlyInt: false },
      { type: "number", name: "map_y", required: false, presentable: false, min: 0, max: 1, onlyInt: false },
      { type: "number", name: "sort_order", required: false, presentable: false, min: null, max: null, onlyInt: true },
      { type: "autodate", name: "created", required: false, presentable: false, onCreate: true, onUpdate: false },
      { type: "autodate", name: "updated", required: false, presentable: false, onCreate: true, onUpdate: true }
    ],
    indexes: [
      "CREATE UNIQUE INDEX `idx_lodging_areas_code` ON `lodging_areas` (`code`)"
    ]
  });
  app.save(areas);

  const areasCol = app.findCollectionByNameOrId("lodging_areas");

  const units = new Collection({
    type: "base",
    name: "lodging_units",
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.is_admin = true',
    updateRule: '@request.auth.is_admin = true',
    deleteRule: '@request.auth.is_admin = true',
    fields: [
      {
        type: "relation", name: "area", required: true, presentable: false,
        collectionId: areasCol.id, cascadeDelete: false, minSelect: null, maxSelect: 1
      },
      { type: "text", name: "name", required: true, presentable: true, min: 1, max: 200, pattern: "" },
      { type: "text", name: "code", required: true, presentable: false, min: 1, max: 100, pattern: "" },
      // NOTE: parent_unit is NOT declared here. It is a self-relation, so it needs
      // this collection's own id — added after app.save(units) below.
      { type: "number", name: "map_x", required: false, presentable: false, min: 0, max: 1, onlyInt: false },
      { type: "number", name: "map_y", required: false, presentable: false, min: 0, max: 1, onlyInt: false },
      { type: "number", name: "sleeps", required: false, presentable: false, min: null, max: null, onlyInt: true },
      {
        type: "select", name: "bathroom", required: false, presentable: false,
        values: ["none", "private", "shared"], maxSelect: 1
      },
      { type: "text", name: "bathroom_group", required: false, presentable: false, min: 0, max: 100, pattern: "" },
      { type: "bool", name: "near_bathhouse", required: false, presentable: false },
      { type: "bool", name: "has_power", required: false, presentable: false },
      { type: "bool", name: "has_ac", required: false, presentable: false },
      { type: "bool", name: "has_fridge", required: false, presentable: false },
      { type: "bool", name: "is_accessible", required: false, presentable: false },
      {
        type: "select", name: "allocation_default", required: false, presentable: false,
        values: ["family_pool", "staff_default"], maxSelect: 1
      },
      // false = value is a seed guess (from historical peak occupancy), not staff-verified.
      { type: "bool", name: "is_confirmed", required: false, presentable: false },
      { type: "bool", name: "is_active", required: false, presentable: false },
      // true = a building/grouping row that must never be booked or counted
      // toward capacity (e.g. gt-tenaya, the building containing gt-tenaya-1..4).
      // false = an ordinary bookable room. PocketBase's default for an unset
      // bool is false, which is the safe default for units staff add later
      // through the admin UI.
      { type: "bool", name: "is_container", required: false, presentable: false },
      // max 4000 deliberately, NOT 5000: 5000 is PocketBase's silent default, so
      // the harness uses "max != 5000" to prove the options:{} trap was avoided.
      { type: "text", name: "notes", required: false, presentable: false, min: 0, max: 4000, pattern: "" },
      { type: "autodate", name: "created", required: false, presentable: false, onCreate: true, onUpdate: false },
      { type: "autodate", name: "updated", required: false, presentable: false, onCreate: true, onUpdate: true }
    ],
    indexes: [
      "CREATE UNIQUE INDEX `idx_lodging_units_code` ON `lodging_units` (`code`)",
      "CREATE INDEX `idx_lodging_units_area` ON `lodging_units` (`area`)",
      "CREATE INDEX `idx_lodging_units_bathroom_group` ON `lodging_units` (`bathroom_group`)"
    ]
  });
  app.save(units);

  // parent_unit: the building a room belongs to. Display/adjacency grouping only
  // — NOT merge state (merges are explicit member sets in lodging_merges, because
  // they are frequently partial). Added here rather than in the field list above
  // because a self-relation needs the collection's own id, which only exists once
  // app.save(units) has run.
  const unitsCol = app.findCollectionByNameOrId("lodging_units");
  unitsCol.fields.add(new Field({
    type: "relation", name: "parent_unit", required: false, presentable: false,
    collectionId: unitsCol.id, cascadeDelete: false, minSelect: null, maxSelect: 1
  }));
  app.save(unitsCol);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("lodging_units"));
  app.delete(app.findCollectionByNameOrId("lodging_areas"));
});
