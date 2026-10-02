/// <reference path="../pb_data/types.d.ts" />
/**
 * aid_grant_placements -- where the grants register placed each grant, logged when Kindred priced
 * the season (campership 3c-2; owner ruling 2026-09-30; main spec 2 item 11, 14.4).
 *
 * The register places each grant line and commitment on aid requests at read time, from
 * enrollments and records that aren't dated, so a past date could not know which request a grant
 * sat on. Each live pricing of a season compares the register with the newest row per grant and
 * appends a row only for a grant whose placement is new or changed (`place`, with the register row
 * in `placement`) or that has left the register (`remove`, placement null). A past date replays
 * the newest row per grant created by then (api/services/financial_aid_grant_placements.py).
 *
 * APPEND-ONLY: a row is never edited or deleted, so there is no updated field and no unique index
 * (a grant has one row per change by design). `grant` is "ledger:<transaction id>" or
 * "commitment:<aid_grants id>". All five rules are null (spec 14.3): only the superuser (FastAPI)
 * reads or writes it.
 */
migrate((app) => {
  const collection = new Collection({
    type: "base",
    name: "aid_grant_placements",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: "number", name: "year", required: true, presentable: false, min: 2017, max: 2100, onlyInt: true },
      { type: "text", name: "grant", required: true, presentable: true, min: 1, max: 64, pattern: "^(ledger:[0-9]+|commitment:[a-z0-9]{15})$" },
      { type: "number", name: "household_cm_id", required: false, presentable: false, min: 0, max: null, onlyInt: true },
      { type: "select", name: "event", required: true, presentable: false, values: ["place", "remove"], maxSelect: 1 },
      { type: "json", name: "placement", required: false, presentable: false, maxSize: 20000 },
      { type: "text", name: "actor", required: true, presentable: false, min: 1, max: 200, pattern: "" },
      { type: "autodate", name: "created", required: false, presentable: false, onCreate: true, onUpdate: false },
    ],
    indexes: [
      "CREATE INDEX `idx_aid_grant_placements_year_created` ON `aid_grant_placements` (`year`, `created`)",
      "CREATE INDEX `idx_aid_grant_placements_year_grant` ON `aid_grant_placements` (`year`, `grant`)",
    ],
  });
  app.save(collection);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("aid_grant_placements"));
});
