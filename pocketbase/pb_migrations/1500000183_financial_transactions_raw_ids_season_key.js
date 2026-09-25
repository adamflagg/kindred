/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: financial_transactions keeps CampMinder's raw ids and keys on season
 * (campership sub-project 1, design §6.1).
 *
 * 1. Four raw CampMinder id columns (number, optional, 0 = CampMinder sent none):
 *    person_cm_id, household_cm_id, session_cm_id, financial_category_cm_id.
 *    The relation columns stay. They are set only when the id resolves to a row
 *    PocketBase holds, and until now an id that did not resolve was lost; these
 *    keep it.
 * 2. The unique index gains `year`: (cm_id, amount) -> (cm_id, amount, year).
 *    `year` is CampMinder's per-row season. Existing rows already satisfy the
 *    wider key, so the swap cannot fail on data. The down path restores the
 *    narrower key and fails loudly if two seasons now share a (cm_id, amount).
 *    That is correct: it refuses rather than deleting.
 * 3. (year, financial_category_cm_id) serves the aid-cohort read
 *    (sync/aid_cohort.go) and the sub-project 4 ledger.
 *
 * Collection rules are NOT touched. Sub-project 2 owns them.
 */

const COLLECTION = "financial_transactions";

const OLD_UNIQUE_NAME = "idx_financial_transactions_cm_id_amount";
const OLD_UNIQUE_SQL =
  "CREATE UNIQUE INDEX `idx_financial_transactions_cm_id_amount` ON `financial_transactions` (`cm_id`, `amount`)";

const NEW_UNIQUE_NAME = "idx_financial_transactions_cm_id_amount_year";
const NEW_UNIQUE_SQL =
  "CREATE UNIQUE INDEX `idx_financial_transactions_cm_id_amount_year` ON `financial_transactions` (`cm_id`, `amount`, `year`)";

const CATEGORY_NAME = "idx_financial_transactions_year_category_cm";
const CATEGORY_SQL =
  "CREATE INDEX `idx_financial_transactions_year_category_cm` ON `financial_transactions` (`year`, `financial_category_cm_id`)";

const CM_ID_FIELDS = ["person_cm_id", "household_cm_id", "session_cm_id", "financial_category_cm_id"];

// Drops every index statement carrying this exact backticked name. The closing backtick
// keeps OLD_UNIQUE_NAME from matching NEW_UNIQUE_NAME, which it prefixes.
function withoutIndex(collection, name) {
  collection.indexes = collection.indexes.filter((sql) => !sql.includes("`" + name + "`"));
}

migrate((app) => {
  const collection = app.findCollectionByNameOrId(COLLECTION);

  for (let i = 0; i < CM_ID_FIELDS.length; i++) {
    collection.fields.add(new Field({
      type: "number",
      name: CM_ID_FIELDS[i],
      required: false,
      presentable: false,
      min: null,
      max: null,
      onlyInt: true,
    }));
  }

  withoutIndex(collection, OLD_UNIQUE_NAME);
  withoutIndex(collection, NEW_UNIQUE_NAME);
  withoutIndex(collection, CATEGORY_NAME);
  collection.indexes.push(NEW_UNIQUE_SQL);
  collection.indexes.push(CATEGORY_SQL);

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId(COLLECTION);

  withoutIndex(collection, NEW_UNIQUE_NAME);
  withoutIndex(collection, CATEGORY_NAME);
  withoutIndex(collection, OLD_UNIQUE_NAME);
  collection.indexes.push(OLD_UNIQUE_SQL);

  for (let i = 0; i < CM_ID_FIELDS.length; i++) {
    collection.fields.removeByName(CM_ID_FIELDS[i]);
  }

  app.save(collection);
});
