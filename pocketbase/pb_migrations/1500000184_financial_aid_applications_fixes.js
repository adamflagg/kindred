/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: financial_aid_applications column fixes (campership sub-project 1, design §6.4).
 *
 * 1. amount_awarded -> registration_request_amount. It is fed by
 *    CA-FinancialAssistanceAmount and WW-FA Amount, both typed by the family at
 *    registration. It was never an award. Its partial index follows the rename.
 * 2. income_confirmed: bool -> number. The source ("FA-confirmpretax income") is a
 *    typed dollar figure. PocketBase refuses a type change on an existing field id,
 *    so the bool is removed in the first save and the number added in a second.
 *    The column is derived; the next financial_aid_applications run refills it.
 * 3. amount_requested and deposit_paid are dropped. The first read an inactive
 *    CampMinder field and was 0 in every year; the second was 0 in every year.
 * 4. is_applicant (bool): the row holds at least one seasonal aid answer.
 *    Donation-only and carry-over-only rows stay false.
 * 5. carryover_last_updated (json): CampMinder field name -> "YYYY-MM-DD", the
 *    last-updated date of each non-seasonal ("carry-over") answer on the row.
 *
 * Collection rules are NOT touched. Sub-project 2 owns them.
 * Down restores the old shape. The restored columns come back empty, and the
 * previous code refills what it maps.
 */

const COLLECTION = "financial_aid_applications";

const AWARDED_INDEX_NAME = "idx_fa_apps_awarded";
const AWARDED_INDEX_SQL =
  "CREATE INDEX `idx_fa_apps_awarded` ON `financial_aid_applications` (`year`, `amount_awarded`) WHERE `amount_awarded` > 0";

const REQUEST_INDEX_NAME = "idx_fa_apps_registration_request";
const REQUEST_INDEX_SQL =
  "CREATE INDEX `idx_fa_apps_registration_request` ON `financial_aid_applications` (`year`, `registration_request_amount`) WHERE `registration_request_amount` > 0";

const APPLICANT_INDEX_NAME = "idx_fa_apps_applicant";
const APPLICANT_INDEX_SQL =
  "CREATE INDEX `idx_fa_apps_applicant` ON `financial_aid_applications` (`year`, `is_applicant`) WHERE `is_applicant` = 1";

function withoutIndex(collection, name) {
  collection.indexes = collection.indexes.filter((sql) => !sql.includes("`" + name + "`"));
}

migrate((app) => {
  let collection = app.findCollectionByNameOrId(COLLECTION);

  withoutIndex(collection, AWARDED_INDEX_NAME);
  withoutIndex(collection, REQUEST_INDEX_NAME);
  withoutIndex(collection, APPLICANT_INDEX_NAME);
  collection.fields.getByName("amount_awarded").name = "registration_request_amount";

  collection.fields.removeByName("amount_requested");
  collection.fields.removeByName("deposit_paid");
  collection.fields.removeByName("income_confirmed");

  collection.fields.add(new Field({
    type: "bool",
    name: "is_applicant",
    required: false,
    presentable: false,
  }));
  collection.fields.add(new Field({
    type: "json",
    name: "carryover_last_updated",
    required: false,
    presentable: false,
    maxSize: 10000,
  }));

  collection.indexes.push(REQUEST_INDEX_SQL);
  collection.indexes.push(APPLICANT_INDEX_SQL);
  app.save(collection);

  collection = app.findCollectionByNameOrId(COLLECTION);
  collection.fields.add(new Field({
    type: "number",
    name: "income_confirmed",
    required: false,
    presentable: false,
    min: null,
    max: null,
    onlyInt: false,
  }));
  app.save(collection);
}, (app) => {
  let collection = app.findCollectionByNameOrId(COLLECTION);

  withoutIndex(collection, REQUEST_INDEX_NAME);
  withoutIndex(collection, APPLICANT_INDEX_NAME);
  withoutIndex(collection, AWARDED_INDEX_NAME);
  collection.fields.getByName("registration_request_amount").name = "amount_awarded";

  collection.fields.removeByName("is_applicant");
  collection.fields.removeByName("carryover_last_updated");
  collection.fields.removeByName("income_confirmed");

  collection.fields.add(new Field({
    type: "number",
    name: "amount_requested",
    required: false,
    presentable: false,
    min: null,
    max: null,
    onlyInt: false,
  }));
  collection.fields.add(new Field({
    type: "number",
    name: "deposit_paid",
    required: false,
    presentable: false,
    min: null,
    max: null,
    onlyInt: false,
  }));

  collection.indexes.push(AWARDED_INDEX_SQL);
  app.save(collection);

  collection = app.findCollectionByNameOrId(COLLECTION);
  collection.fields.add(new Field({
    type: "bool",
    name: "income_confirmed",
    required: false,
    presentable: false,
  }));
  app.save(collection);
});
