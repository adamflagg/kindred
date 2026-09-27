/// <reference path="../pb_data/types.d.ts" />
/**
 * financial_aid_applications.reported_income_fields (campership sub-project 5).
 *
 * PocketBase stores a blank number as 0, so the mirror cannot tell "the family
 * left gross income blank" from "the family reported $0". The difference
 * decides pricing (spec 2 item 22, principle 5): a blank is unknown and holds
 * the request for input; a reported 0 is priced and trips placeholder_income.
 * The FA transform (pocketbase/sync/financial_aid_applications.go) fills this
 * with the income COLUMNS whose CampMinder answer was non-blank and numeric:
 * total_gross_income, expected_gross_income, total_adjusted_income,
 * income_confirmed. Rows written before this migration read as [] until the
 * next FA run, which intake treats as "every 0 is unknown" (the safe side).
 *
 * Collection rules are NOT touched (sub-project 2 owns them).
 */

migrate((app) => {
  const collection = app.findCollectionByNameOrId("financial_aid_applications");
  collection.fields.add(new Field({
    type: "json",
    name: "reported_income_fields",
    required: false,
    presentable: false,
    maxSize: 2000,
  }));
  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("financial_aid_applications");
  collection.fields.removeByName("reported_income_fields");
  app.save(collection);
});
