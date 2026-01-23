/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create payment_methods collection
 * Dependencies: None
 *
 * Stores payment method definitions from CampMinder /financials/paymentmethods endpoint.
 * Global lookup table (not year-specific).
 * Methods include Check, Credit Card, Cash, etc.
 */

const COLLECTION_ID_PAYMENT_METHODS = "col_payment_methods";

migrate((app) => {
  const collection = new Collection({
    id: COLLECTION_ID_PAYMENT_METHODS,
    type: "base",
    name: "payment_methods",
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
          max: 200,
          pattern: ""
        }
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
      "CREATE UNIQUE INDEX `idx_payment_methods_cm_id` ON `payment_methods` (`cm_id`)"
    ]
  });

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("payment_methods");
  app.delete(collection);
});
