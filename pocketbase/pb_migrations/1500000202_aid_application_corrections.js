/// <reference path="../pb_data/types.d.ts" />
/**
 * aid_application_corrections -- staff corrections to intake values
 * (campership sub-project 5; spec 3.3 and 9.3).
 *
 * APPEND-ONLY. A correction records the field, the new value, the value it
 * replaced (`original_value`, the synced value at that moment; "" when the
 * family left it blank), the reason, who and when. The newest row for a field
 * wins. A row whose `new_value` is empty reverts the field to the synced value.
 * The calculator reads the corrected value and the screen shows both.
 * `request` is set only for a request-level field (the ask); it is empty for a
 * household answer. The household's income override (field `income_override`,
 * SP3's IncomeOverride: prior-year only, current-year only, confirmed, or
 * staff-entered with an amount) is a correction like any other, so it carries a
 * reason and history.
 *
 * Values are canonical strings ("85000.00", "3", "true",
 * "staff_entered:85000.00"), so a money correction never passes through a
 * float. Every write commits with its aid_change_log row in one batch
 * (sub-project 4a's commit_aid_writes). All five rules are null (spec 14.3).
 */

migrate((app) => {
  const applications = app.findCollectionByNameOrId("aid_applications");
  const requests = app.findCollectionByNameOrId("aid_requests");
  const collection = new Collection({
    type: "base",
    name: "aid_application_corrections",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { type: "number", name: "year", required: true, presentable: false, min: 2017, max: 2100, onlyInt: true },
      { type: "relation", name: "application", required: true, presentable: false, collectionId: applications.id, cascadeDelete: false, minSelect: null, maxSelect: 1 },
      { type: "relation", name: "request", required: false, presentable: false, collectionId: requests.id, cascadeDelete: false, minSelect: null, maxSelect: 1 },
      { type: "text", name: "field", required: true, presentable: true, min: 1, max: 64, pattern: "^[a-z_]+$" },
      { type: "text", name: "new_value", required: false, presentable: false, min: 0, max: 64, pattern: "" },
      { type: "text", name: "original_value", required: false, presentable: false, min: 0, max: 64, pattern: "" },
      { type: "text", name: "reason", required: true, presentable: false, min: 1, max: 2000, pattern: "" },
      { type: "text", name: "actor", required: true, presentable: false, min: 1, max: 200, pattern: "" },
      { type: "autodate", name: "created", required: false, presentable: false, onCreate: true, onUpdate: false },
    ],
    indexes: [
      "CREATE INDEX `idx_aid_corrections_application_field` ON `aid_application_corrections` (`application`, `field`, `created`)",
      "CREATE INDEX `idx_aid_corrections_year` ON `aid_application_corrections` (`year`)",
    ],
  });
  app.save(collection);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("aid_application_corrections"));
});
