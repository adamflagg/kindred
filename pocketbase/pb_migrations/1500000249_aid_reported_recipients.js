/// <reference path="../pb_data/types.d.ts" />
/**
 * aid_reported_recipients -- a past season's Campership sheet, loaded once as "as reported" recipients: one row per
 * camper, program and payer, matched to CampMinder by id (owner ruling 2026-10-16, CS-AGES25). Reports › Development
 * counts an as-reported season's summer age lines from these rows, and leaves them blank until they are loaded.
 *
 *   year / person_cm_id / household_cm_id   the season and who the sheet paid (CampMinder ids, never a name)
 *   program                                 summer, family_camp, bmitzvah, weekend or other
 *   source / funder                         camp (an award on the sheet's aid calculator, no funder) or outside (a
 *                                           grant on its Grants tab, naming its funder)
 *   amount                                  the money the sheet shows; always more than 0
 *   sheet_tab / sheet_row                   where on the sheet the row came from
 *   match                                   personal_id (the sheet's CampMinder id) or household_birthdate
 *
 * One row per natural key (the unique index): a second load of the same line corrects it, through 4a with its
 * aid_change_log row. person_cm_id and household_cm_id are CampMinder ids, not relations. All five rules are null
 * (spec 14.3), as every aid_* table: only the superuser (FastAPI) reads or writes it. The `name:` below is a LITERAL
 * because scripts/dev/verify-migration-history.sh CHECK 2 regexes it out of the up arm.
 */
migrate((app) => {
  const collection = new Collection({
    type: "base",
    name: "aid_reported_recipients",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: "number", name: "year", required: true, presentable: false, min: 2017, max: 2100, onlyInt: true },
      { type: "number", name: "person_cm_id", required: true, presentable: false, min: 1, max: null, onlyInt: true },
      { type: "number", name: "household_cm_id", required: true, presentable: false, min: 1, max: null, onlyInt: true },
      { type: "select", name: "program", required: true, presentable: true, values: ["summer", "family_camp", "bmitzvah", "weekend", "other"], maxSelect: 1 },
      { type: "select", name: "source", required: true, presentable: true, values: ["camp", "outside"], maxSelect: 1 },
      { type: "text", name: "funder", required: false, presentable: false, min: 0, max: 200, pattern: "" },
      { type: "number", name: "amount", required: true, presentable: false, min: 0.01, max: null, onlyInt: false },
      { type: "text", name: "sheet_tab", required: true, presentable: false, min: 1, max: 100, pattern: "" },
      { type: "number", name: "sheet_row", required: true, presentable: false, min: 1, max: null, onlyInt: true },
      { type: "select", name: "match", required: true, presentable: false, values: ["personal_id", "household_birthdate"], maxSelect: 1 },
      { type: "autodate", name: "created", required: false, presentable: false, onCreate: true, onUpdate: false },
      { type: "autodate", name: "updated", required: false, presentable: false, onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX `idx_aid_reported_recipients_key` ON `aid_reported_recipients` (`year`, `person_cm_id`, `program`, `source`, `funder`)",
    ],
  });
  app.save(collection);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("aid_reported_recipients"));
});
