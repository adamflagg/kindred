/// <reference path="../pb_data/types.d.ts" />
/**
 * aid_applications -- one financial-aid application per family per season
 * (campership sub-project 5; spec 5 and 9.1).
 *
 * Built by api/services/financial_aid_intake_service.py from
 * financial_aid_applications, which mirrors CampMinder's FA answers one row per
 * PERSON. Income is a household fact, so the builder groups those rows by the
 * FA row's household and keeps ONE set of answers here, every financial field
 * included (spec 2 item 22: every income field is stored and shown).
 *
 * An income figure the family left blank is stored as null (unknown), never 0
 * (spec principle 5); a reported 0 is stored as 0. Where the family's rows
 * report DIFFERENT income figures, the figure is stored as null and an
 * `income_conflict` flag lists every variant: Kindred never picks a figure
 * itself, staff call the family and enter a correction (spec 8).
 *
 * `answers` is the builder's copy of the synced values and is rewritten on every
 * run. Staff corrections live in aid_application_corrections, which no run ever
 * touches. `status` becomes `withdrawn` when the family no longer has any FA
 * program answer. Intake never deletes a row: decisions (sub-project 10) hang
 * off the requests below.
 *
 * `household_cm_id` is a required CampMinder id. The manual applicant path
 * (spec 9.4, sub-project 5b) is on hold with the owner; a Kindred-only key would
 * need its own migration then.
 *
 * All five rules are null (superuser only; spec 14.3). FastAPI's superuser
 * client is the only reader and writer, behind require_permission.
 */

migrate((app) => {
  const collection = new Collection({
    type: "base",
    name: "aid_applications",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: "number", name: "year", required: true, presentable: false, min: 2017, max: 2100, onlyInt: true },
      { type: "number", name: "household_cm_id", required: true, presentable: true, min: 1, max: null, onlyInt: true },
      { type: "select", name: "status", required: true, presentable: false, values: ["active", "withdrawn"], maxSelect: 1 },
      { type: "json", name: "answers", required: false, presentable: false, maxSize: 100000 },
      { type: "json", name: "member_person_cm_ids", required: false, presentable: false, maxSize: 20000 },
      { type: "json", name: "flags", required: false, presentable: false, maxSize: 100000 },
      { type: "autodate", name: "created", required: false, presentable: false, onCreate: true, onUpdate: false },
      { type: "autodate", name: "updated", required: false, presentable: false, onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX `idx_aid_applications_year_household` ON `aid_applications` (`year`, `household_cm_id`)",
      "CREATE INDEX `idx_aid_applications_year_status` ON `aid_applications` (`year`, `status`)",
    ],
  });
  app.save(collection);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("aid_applications"));
});
