/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("col_financial_transactions")

  // update collection data
  unmarshal({
    "indexes": [
      "CREATE UNIQUE INDEX `idx_financial_transactions_cm_id_year` ON `financial_transactions` (\n  `cm_id`,\n  `amount`\n)",
      "CREATE INDEX `idx_financial_transactions_year` ON `financial_transactions` (`year`)",
      "CREATE INDEX `idx_financial_transactions_post_date` ON `financial_transactions` (`post_date`)",
      "CREATE INDEX `idx_financial_transactions_person` ON `financial_transactions` (`person_cm_id`)",
      "CREATE INDEX `idx_financial_transactions_household` ON `financial_transactions` (`household_cm_id`)",
      "CREATE INDEX `idx_financial_transactions_session` ON `financial_transactions` (`session_cm_id`)",
      "CREATE INDEX `idx_financial_transactions_category` ON `financial_transactions` (`financial_category_id`)"
    ]
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("col_financial_transactions")

  // update collection data
  unmarshal({
    "indexes": [
      "CREATE UNIQUE INDEX `idx_financial_transactions_cm_id_year` ON `financial_transactions` (`cm_id`, `year`)",
      "CREATE INDEX `idx_financial_transactions_year` ON `financial_transactions` (`year`)",
      "CREATE INDEX `idx_financial_transactions_post_date` ON `financial_transactions` (`post_date`)",
      "CREATE INDEX `idx_financial_transactions_person` ON `financial_transactions` (`person_cm_id`)",
      "CREATE INDEX `idx_financial_transactions_household` ON `financial_transactions` (`household_cm_id`)",
      "CREATE INDEX `idx_financial_transactions_session` ON `financial_transactions` (`session_cm_id`)",
      "CREATE INDEX `idx_financial_transactions_category` ON `financial_transactions` (`financial_category_id`)"
    ]
  }, collection)

  return app.save(collection)
})
