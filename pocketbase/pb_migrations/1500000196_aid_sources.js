/// <reference path="../pb_data/types.d.ts" />
/**
 * aid_sources (campership sub-project 4).
 *
 * Classifies a CampMinder aid posting DESCRIPTION -- the only source identifier
 * CampMinder carries on an aid row -- into a source name, a source family, a
 * funder type, whether it counts as aid, and whether it counts toward the camp's
 * own aid budget (counts_toward_budget, the name the rules document's decision
 * types use too). Only the camp's own aid (source_family camp_fa) may count
 * toward the budget: every outside grant and fund is external to it (owner
 * ruling 2026-09-25), and the config loader and FastAPI both refuse otherwise.
 * full_coverage marks a full-ride source: an outside grantor that pays a
 * family's whole session. Default false; sub-projects 6 and 11 read it.
 *
 * ── NOTHING IS SEEDED HERE, ON PURPOSE ─────────────────────────────────────
 * The real descriptions name the camp, and this repository is public. Rows
 * arrive two ways: the aid_postings transform creates an `unclassified` row for
 * every new description it sees in the aid categories, and it applies the
 * private config/aid_sources.local.json (kindred-local) on every run. The file
 * may also define rows CampMinder never sends, as targets for a per-posting
 * reclassification (aid_attribution_overrides.source_key_override). Staff edits
 * through FastAPI set classified_by = "staff", and the config file never
 * overwrites those.
 *
 * Global, not year-scoped: a classification belongs to the description, not
 * the season. description_key is the normalized description (trimmed,
 * lower-cased, dashes unified, whitespace and hyphen spacing collapsed); the Go
 * normalizeAidLabel is the one implementation (Python keeps a tested twin).
 *
 * All five rules are null: only the superuser (the Go sync, FastAPI) reads or
 * writes it.
 */
migrate((app) => {
  const collection = new Collection({
    type: "base",
    name: "aid_sources",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: "text", name: "description_key", required: true, presentable: true, min: 1, max: 500, pattern: "" },
      { type: "text", name: "description", required: false, presentable: false, min: 0, max: 500, pattern: "" },
      { type: "text", name: "source_name", required: false, presentable: false, min: 0, max: 200, pattern: "" },
      {
        type: "select",
        name: "source_family",
        required: true,
        presentable: false,
        values: ["camp_fa", "one_happy_camper", "synagogue_federation", "new_israeli", "pj", "jfcs", "jfam_incentive", "named_fund", "other_outside", "application_marker", "placeholder", "unclassified"],
        maxSelect: 1,
      },
      { type: "select", name: "funder_type", required: true, presentable: false, values: ["camp", "outside", "incentive", "unknown"], maxSelect: 1 },
      { type: "bool", name: "counts_as_aid", required: false, presentable: false },
      { type: "bool", name: "counts_toward_budget", required: false, presentable: false },
      { type: "bool", name: "full_coverage", required: false, presentable: false },
      { type: "json", name: "implied_program_families", required: false, presentable: false, maxSize: 2000 },
      { type: "select", name: "classified_by", required: true, presentable: false, values: ["unclassified", "config_file", "staff"], maxSelect: 1 },
      { type: "text", name: "note", required: false, presentable: false, min: 0, max: 2000, pattern: "" },
      { type: "autodate", name: "created", required: false, presentable: false, onCreate: true, onUpdate: false },
      { type: "autodate", name: "updated", required: false, presentable: false, onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX `idx_aid_sources_description_key` ON `aid_sources` (`description_key`)",
    ],
  });
  app.save(collection);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("aid_sources"));
});
