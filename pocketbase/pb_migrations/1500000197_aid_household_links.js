/// <reference path="../pb_data/types.d.ts" />
/**
 * aid_household_links (campership sub-project 4).
 *
 * One family can span two CampMinder households (a child's primary and
 * alternate childhood homes; separated parents who each post for the child). A
 * row joins a household to a family_key for one season; a family is every
 * household reachable through shared keys. Family-level aid totals are read
 * across that household set and never split between requests by estimate.
 *
 * source = "auto": written and swept by the aid_postings transform from the
 *   childhood households of persons enrolled (any status) in a non-adult
 *   session that season. family_key is "hh-<smallest household cm id>".
 * source = "staff": written through FastAPI. Never touched by the transform. A
 *   staff row with the same (household, key) as an auto row replaces it (the
 *   unique index allows one), which is how an exclusion works: staff flips
 *   that row to excluded = true. Excluded rows join nothing.
 *
 * household_cm_id is required: a link to household 0 means nothing.
 * All five rules are null.
 */
migrate((app) => {
  const collection = new Collection({
    type: "base",
    name: "aid_household_links",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: "number", name: "year", required: true, presentable: false, min: 2010, max: 2100, onlyInt: true },
      { type: "number", name: "household_cm_id", required: true, presentable: false, min: 1, max: null, onlyInt: true },
      { type: "text", name: "family_key", required: true, presentable: true, min: 1, max: 100, pattern: "^[A-Za-z0-9_-]+$" },
      { type: "select", name: "source", required: true, presentable: false, values: ["auto", "staff"], maxSelect: 1 },
      { type: "bool", name: "excluded", required: false, presentable: false },
      { type: "text", name: "note", required: false, presentable: false, min: 0, max: 2000, pattern: "" },
      { type: "text", name: "actor", required: false, presentable: false, min: 0, max: 200, pattern: "" },
      { type: "autodate", name: "created", required: false, presentable: false, onCreate: true, onUpdate: false },
      { type: "autodate", name: "updated", required: false, presentable: false, onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX `idx_aid_household_links_household_family_year` ON `aid_household_links` (`household_cm_id`, `family_key`, `year`)",
      "CREATE INDEX `idx_aid_household_links_year_family` ON `aid_household_links` (`year`, `family_key`)",
    ],
  });
  app.save(collection);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("aid_household_links"));
});
