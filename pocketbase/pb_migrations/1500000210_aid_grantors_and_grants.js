/// <reference path="../pb_data/types.d.ts" />
/**
 * Grants register (campership sub-project 6-core): aid_grantors, aid_grants, and
 * aid_sources.grantor_key in place of aid_sources.full_coverage.
 *
 * aid_grantors — the grantor directory (spec §8.2). GLOBAL, not per season, like
 * aid_sources: it describes funders; its history is aid_change_log. key is a stable
 * slug (the join key: aid_sources.grantor_key and aid_grants.grantor_key point at it;
 * neither side carries a CampMinder id, and a slug survives a reseed where a PocketBase
 * id would not). It holds the grantor facts, each in ONE home (owner ruling
 * 2026-09-28): full_coverage (a full-ride grantor pays the whole session) and
 * covers_canteen (D86: whether a full-coverage grant includes the canteen deposit;
 * "unknown" until staff answer). Its CampMinder descriptions are NOT stored here: they
 * map through aid_sources.grantor_key, the one description registry (D58).
 *
 * aid_grants — a grant COMMITTED BUT NOT YET POSTED in CampMinder, hand-entered (D55).
 * Ledger grant lines are never copied here: the register is derived from aid_postings
 * at read time, and a household-level line's camper is an aid_attribution_overrides
 * placement. A commitment counts until the ledger line that fulfils it arrives; then
 * the line counts instead. amount is positive dollars (aid_postings keeps CampMinder's
 * negative sign). status open|withdrawn; "fulfilled" is derived, never stored.
 *
 * aid_sources — grantor_key names the description's grantor ("" = unmapped). It is
 * staff data written by FastAPI (PUT /sources/{id}/grantor); the Go config run never
 * writes or clears it. full_coverage moves to aid_grantors: it was false on every row
 * (config file and prod), so nothing is carried over.
 *
 * All five rules are null on both new collections: only the superuser (FastAPI) reads
 * or writes them.
 */
migrate((app) => {
  const grantors = new Collection({
    type: "base",
    name: "aid_grantors",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: "text", name: "key", required: true, presentable: true, min: 1, max: 60, pattern: "^[a-z][a-z0-9_]*$" },
      { type: "text", name: "name", required: true, presentable: false, min: 1, max: 200, pattern: "" },
      { type: "json", name: "aliases", required: false, presentable: false, maxSize: 20000 },
      { type: "bool", name: "full_coverage", required: false, presentable: false },
      { type: "select", name: "covers_canteen", required: true, presentable: false, values: ["unknown", "yes", "no"], maxSelect: 1 },
      { type: "text", name: "eligibility", required: false, presentable: false, min: 0, max: 2000, pattern: "" },
      { type: "text", name: "contacts", required: false, presentable: false, min: 0, max: 2000, pattern: "" },
      { type: "text", name: "note", required: false, presentable: false, min: 0, max: 2000, pattern: "" },
      { type: "autodate", name: "created", required: false, presentable: false, onCreate: true, onUpdate: false },
      { type: "autodate", name: "updated", required: false, presentable: false, onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX `idx_aid_grantors_key` ON `aid_grantors` (`key`)"],
  });
  app.save(grantors);

  const grants = new Collection({
    type: "base",
    name: "aid_grants",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: "number", name: "year", required: true, presentable: false, min: 2017, max: 2100, onlyInt: true },
      { type: "text", name: "grantor_key", required: true, presentable: false, min: 1, max: 60, pattern: "^[a-z][a-z0-9_]*$" },
      { type: "number", name: "household_cm_id", required: true, presentable: false, min: 1, max: null, onlyInt: true },
      { type: "number", name: "person_cm_id", required: true, presentable: true, min: 1, max: null, onlyInt: true },
      { type: "number", name: "session_cm_id", required: false, presentable: false, min: null, max: null, onlyInt: true },
      { type: "select", name: "program_family", required: false, presentable: false, values: ["summer", "quest", "teen", "bmitzvah", "family_camp", "adult_weekend", "family_school", "other"], maxSelect: 1 },
      { type: "number", name: "amount", required: true, presentable: false, min: 0.01, max: null, onlyInt: false },
      { type: "date", name: "committed_on", required: true, presentable: false, min: "", max: "" },
      { type: "select", name: "status", required: true, presentable: false, values: ["open", "withdrawn"], maxSelect: 1 },
      { type: "date", name: "withdrawn_at", required: false, presentable: false, min: "", max: "" },
      { type: "text", name: "note", required: false, presentable: false, min: 0, max: 2000, pattern: "" },
      { type: "text", name: "actor", required: false, presentable: false, min: 0, max: 200, pattern: "" },
      { type: "autodate", name: "created", required: false, presentable: false, onCreate: true, onUpdate: false },
      { type: "autodate", name: "updated", required: false, presentable: false, onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE INDEX `idx_aid_grants_year_household` ON `aid_grants` (`year`, `household_cm_id`)",
      "CREATE INDEX `idx_aid_grants_year_status` ON `aid_grants` (`year`, `status`)",
    ],
  });
  app.save(grants);

  const sources = app.findCollectionByNameOrId("aid_sources");
  sources.fields.add(new Field({ type: "text", name: "grantor_key", required: false, presentable: false, min: 0, max: 60, pattern: "" }));
  sources.fields.removeByName("full_coverage");
  app.save(sources);
}, (app) => {
  const sources = app.findCollectionByNameOrId("aid_sources");
  sources.fields.add(new Field({ type: "bool", name: "full_coverage", required: false, presentable: false }));
  sources.fields.removeByName("grantor_key");
  app.save(sources);
  app.delete(app.findCollectionByNameOrId("aid_grants"));
  app.delete(app.findCollectionByNameOrId("aid_grantors"));
});
