/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create financial_categories collection
 * Dependencies: None
 *
 * Stores financial category definitions from CampMinder /financials/financialcategories endpoint.
 * Global lookup table (not year-specific).
 * Categories classify transactions (e.g., "Fees - Summer Camp", "Financial Assistance").
 */

const COLLECTION_ID_FINANCIAL_CATEGORIES = "col_financial_categories";

migrate((app) => {
  const collection = new Collection({
    id: COLLECTION_ID_FINANCIAL_CATEGORIES,
    type: "base",
    name: "financial_categories",
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.id != ""',
    fields: [
      {
        type: "number",
        name: "cm_id",
        required: true,
        presentable: false,
        options: {
          min: 1,
          max: null,
          noDecimal: true
        }
      },
      {
        type: "text",
        name: "name",
        required: false,
        presentable: true,
        options: {
          min: null,
          max: 500,
          pattern: ""
        }
      },
      {
        type: "bool",
        name: "is_archived",
        required: false,
        presentable: false
      },
      {
        type: "autodate",
        name: "created",
        required: false,
        presentable: false,
        onCreate: true,
        onUpdate: false
      },
      {
        type: "autodate",
        name: "updated",
        required: false,
        presentable: false,
        onCreate: true,
        onUpdate: true
      }
    ],
    indexes: [
      "CREATE UNIQUE INDEX `idx_financial_categories_cm_id` ON `financial_categories` (`cm_id`)"
    ]
  });

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("financial_categories");
  app.delete(collection);
});
