/// <reference path="../pb_data/types.d.ts" />
/**
 * aid_scenario_snapshots, aid_scenario_options, aid_scenario_trail -- Camperships scenarios
 * (sub-project 9b; spec 7.4; D35-D38).
 *
 *   aid_scenario_snapshots  a frozen season: every read the live season read made, as JSON
 *                           (`inputs`), so every scenario prices the same applications (spec 7.4).
 *                           Immutable. `requests` counts the live requests frozen; `awaiting_rules` those
 *                           of them intake holds for approved programs and cost rules (held in every scenario).
 *   aid_scenario_options    a kept option: an immutable, unnamed rules document with a spoken code
 *                           (A, A1, B2). `starting_point` is "" for a starting point, else the one it
 *                           sits under (two levels, D38). `from_code` is what it was kept from ("" when
 *                           started from the rules); `origin_version` the rules version its lineage
 *                           started from. `results` and `round1_by_request` are its figures on `snapshot`.
 *   aid_scenario_trail      every setting released in someone's draft, with its results, who and when.
 *                           A person's newest row IS their draft. Append-only, except `kept_code`, set
 *                           when that row is kept.
 *
 * ALL FIVE RULES ARE NULL on all three (spec 14.3): FastAPI's superuser client, behind
 * financial_aid.rules, is the only reader and writer. The JSON fields are not `required` because
 * PocketBase treats {} as blank; the service always writes them. Field properties are direct:
 * v0.23 silently ignores an options wrapper.
 */
migrate((app) => {
  const snapshots = new Collection({
    type: "base",
    name: "aid_scenario_snapshots",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: "number", name: "year", required: true, presentable: false, min: 2017, max: 2100, onlyInt: true },
      { type: "json", name: "inputs", required: false, presentable: false, maxSize: 20000000 },
      { type: "number", name: "requests", required: false, presentable: false, min: 0, max: null, onlyInt: true },
      { type: "number", name: "awaiting_rules", required: false, presentable: false, min: 0, max: null, onlyInt: true },
      { type: "text", name: "actor", required: true, presentable: false, min: 1, max: 200, pattern: "" },
      { type: "autodate", name: "created", required: false, presentable: false, onCreate: true, onUpdate: false },
    ],
    indexes: ["CREATE INDEX `idx_aid_scenario_snapshots_year` ON `aid_scenario_snapshots` (`year`, `created`)"],
  });
  app.save(snapshots);

  const kept = new Collection({
    type: "base",
    name: "aid_scenario_options",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: "number", name: "year", required: true, presentable: false, min: 2017, max: 2100, onlyInt: true },
      { type: "text", name: "code", required: true, presentable: true, min: 1, max: 12, pattern: "^[A-Z]+[0-9]*$" },
      { type: "text", name: "starting_point", required: false, presentable: false, min: 0, max: 12, pattern: "^([A-Z]+)?$" },
      { type: "text", name: "from_code", required: false, presentable: false, min: 0, max: 12, pattern: "^([A-Z]+[0-9]*)?$" },
      { type: "number", name: "origin_version", required: true, presentable: false, min: 1, max: null, onlyInt: true },
      { type: "json", name: "document", required: false, presentable: false, maxSize: 2000000 },
      { type: "json", name: "results", required: false, presentable: false, maxSize: 200000 },
      { type: "json", name: "round1_by_request", required: false, presentable: false, maxSize: 1000000 },
      { type: "relation", name: "snapshot", required: true, presentable: false, collectionId: snapshots.id, cascadeDelete: false, minSelect: null, maxSelect: 1 },
      { type: "text", name: "actor", required: true, presentable: false, min: 1, max: 200, pattern: "" },
      { type: "autodate", name: "created", required: false, presentable: false, onCreate: true, onUpdate: false },
    ],
    indexes: ["CREATE UNIQUE INDEX `idx_aid_scenario_options_year_code` ON `aid_scenario_options` (`year`, `code`)"],
  });
  app.save(kept);

  const trail = new Collection({
    type: "base",
    name: "aid_scenario_trail",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: "number", name: "year", required: true, presentable: false, min: 2017, max: 2100, onlyInt: true },
      { type: "text", name: "actor", required: true, presentable: false, min: 1, max: 200, pattern: "" },
      { type: "text", name: "from_code", required: true, presentable: false, min: 1, max: 12, pattern: "^[A-Z]+[0-9]*$" },
      { type: "json", name: "document", required: false, presentable: false, maxSize: 2000000 },
      { type: "text", name: "change", required: true, presentable: false, min: 1, max: 2000, pattern: "" },
      { type: "json", name: "results", required: false, presentable: false, maxSize: 200000 },
      { type: "relation", name: "snapshot", required: true, presentable: false, collectionId: snapshots.id, cascadeDelete: false, minSelect: null, maxSelect: 1 },
      { type: "text", name: "kept_code", required: false, presentable: false, min: 0, max: 12, pattern: "^([A-Z]+[0-9]*)?$" },
      { type: "autodate", name: "created", required: false, presentable: false, onCreate: true, onUpdate: false },
      { type: "autodate", name: "updated", required: false, presentable: false, onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE INDEX `idx_aid_scenario_trail_year_actor` ON `aid_scenario_trail` (`year`, `actor`, `created`)",
      "CREATE INDEX `idx_aid_scenario_trail_year_created` ON `aid_scenario_trail` (`year`, `created`)",
    ],
  });
  app.save(trail);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("aid_scenario_trail"));
  app.delete(app.findCollectionByNameOrId("aid_scenario_options"));
  app.delete(app.findCollectionByNameOrId("aid_scenario_snapshots"));
});
