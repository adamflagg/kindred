/// <reference path="../pb_data/types.d.ts" />
/**
 * aid_registration_ask_history (PR 4a). APPEND-ONLY capture of the registration aid ask.
 *
 * CampMinder keeps ONE ask per camper per season (person custom field 28906
 * CA-FinancialAssistanceAmount; 209090 WW-FA Amount for adult weekends) and a later
 * registration overwrites it. This keeps our own dated copy so a later rule can attribute an
 * ask to the registration it was typed at. NOTHING READS IT YET.
 *
 * Written by the Go custom-values sync (person_custom_field_values.go, on a value OR
 * last_updated change, genesis on create) and made whole by the FA applications job
 * (financial_aid_applications.go reconcileAskHistory).
 *
 * Grain: one row per real change of the slot for (year, field_cm_id, person_cm_id). There is
 * deliberately NO unique index: the table is an append-only change history, so A -> B -> A -> B
 * keeps all of its transitions even when last_updated is empty or repeats. The Go writer
 * dedups against the NEWEST row only (ordered by created, then rowid); the non-unique lookup
 * index serves that read. person_cm_id is a CampMinder id, not a relation.
 * source_changed_at is CampMinder's last_updated verbatim, text so a failed parse cannot lose
 * a row. is_genesis is the first value this table holds, a floor and not proof nothing came
 * before.
 *
 * Deliberately absent: household (derived at read time) and session (the unknown this table
 * exists to resolve).
 *
 * All five rules are null (locked, superuser-only), as every aid_* table: the values are aid
 * amounts. The `name:` below is a LITERAL because scripts/dev/verify-migration-history.sh
 * CHECK 2 regexes it out of the up arm.
 */
migrate((app) => {
  const collection = new Collection({
    type: "base",
    name: "aid_registration_ask_history",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: "number", name: "year", required: true, presentable: false, min: 2010, max: 2100, onlyInt: true },
      { type: "number", name: "person_cm_id", required: true, presentable: false, min: 1, max: null, onlyInt: true },
      { type: "number", name: "field_cm_id", required: true, presentable: false, min: 1, max: null, onlyInt: true },
      { type: "text", name: "old_value", required: false, presentable: false, min: 0, max: 200, pattern: "" },
      { type: "text", name: "new_value", required: false, presentable: false, min: 0, max: 200, pattern: "" },
      { type: "number", name: "amount", required: false, presentable: false, min: null, max: null, onlyInt: false },
      { type: "text", name: "source_changed_at", required: false, presentable: false, min: 0, max: 100, pattern: "" },
      { type: "date", name: "observed_at", required: false, presentable: false, min: "", max: "" },
      { type: "text", name: "observed_by", required: false, presentable: false, min: 0, max: 64, pattern: "" },
      { type: "bool", name: "is_genesis", required: false, presentable: false },
      { type: "autodate", name: "created", required: false, presentable: false, onCreate: true, onUpdate: false },
    ],
    indexes: [
      "CREATE INDEX `idx_aid_registration_ask_history_lookup` ON `aid_registration_ask_history` (`year`, `field_cm_id`, `person_cm_id`, `created`)",
      "CREATE INDEX `idx_aid_registration_ask_history_person_year` ON `aid_registration_ask_history` (`person_cm_id`, `year`)",
    ],
  });
  app.save(collection);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("aid_registration_ask_history"));
});
