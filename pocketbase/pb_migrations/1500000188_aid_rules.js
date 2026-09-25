/// <reference path="../pb_data/types.d.ts" />
/**
 * aid_rules -- the versioned per-season financial-aid rules document
 * (campership design, sections 5 and 7).
 *
 * One row per (year, version). `document` is the whole AidRules JSON
 * (bunking/financial_aid/rules/schema.py); Pydantic in FastAPI validates it,
 * nothing here does. `section_status` holds each section's draft / approved /
 * locked state, with who approved it and when. `parent_year` + `parent_version`
 * record what a version was copied from ("start from last year" crosses a
 * year, so the parent needs both); 0 means none.
 *
 * ALL FIVE RULES ARE NULL: superuser only. FastAPI's superuser client is the
 * only reader and writer, behind the financial_aid.rules permission. An
 * empty-string rule would make the policy, and the names of the staff who
 * approved it, public.
 *
 * `year` is the camp season, as on every other table. The two JSON fields are
 * not `required` because PocketBase treats {} as blank; the service always
 * writes both. Field properties are direct: v0.23 silently ignores an options
 * wrapper.
 */
migrate((app) => {
  const collection = new Collection({
    type: "base",
    name: "aid_rules",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: "number", name: "year", required: true, presentable: false, min: 2000, max: 2100, onlyInt: true },
      { type: "number", name: "version", required: true, presentable: false, min: 1, max: null, onlyInt: true },
      { type: "json", name: "document", required: false, presentable: false, maxSize: 2000000 },
      { type: "json", name: "section_status", required: false, presentable: false, maxSize: 100000 },
      { type: "number", name: "parent_year", required: false, presentable: false, min: 0, max: 2100, onlyInt: true },
      { type: "number", name: "parent_version", required: false, presentable: false, min: 0, max: null, onlyInt: true },
      { type: "autodate", name: "created", required: false, presentable: false, onCreate: true, onUpdate: false },
      { type: "autodate", name: "updated", required: false, presentable: false, onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX `idx_aid_rules_year_version` ON `aid_rules` (`year`, `version`)"],
  });
  app.save(collection);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("aid_rules"));
});
