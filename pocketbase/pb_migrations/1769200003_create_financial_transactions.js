/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create financial_transactions collection
 * Dependencies: financial_categories, payment_methods, camp_sessions, session_groups,
 *               divisions, persons, households
 *
 * Stores transaction details from CampMinder /financials/transactionreporting/transactiondetails endpoint.
 * Year-scoped table with relations to lookup tables, sessions, persons, and households.
 * Includes all transactions (normal and reversed) for complete audit trail.
 */

// Fixed collection ID for financial_transactions
const COLLECTION_ID_FINANCIAL_TRANSACTIONS = "col_financial_transactions";

migrate((app) => {
  // Lookup related collections for relations
  const financialCategoriesCol = app.findCollectionByNameOrId("financial_categories");
  const paymentMethodsCol = app.findCollectionByNameOrId("payment_methods");
  const sessionsCol = app.findCollectionByNameOrId("camp_sessions");
  const sessionGroupsCol = app.findCollectionByNameOrId("session_groups");
  const divisionsCol = app.findCollectionByNameOrId("divisions");
  const personsCol = app.findCollectionByNameOrId("persons");
  const householdsCol = app.findCollectionByNameOrId("households");

  const collection = new Collection({
    id: COLLECTION_ID_FINANCIAL_TRANSACTIONS,
    type: "base",
    name: "financial_transactions",
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.id != ""',
    fields: [
      // Identity
      {
        type: "number",
        name: "cm_id",
        required: true,
        presentable: false,
        system: false,
        options: {
          min: 1,
          max: null,
          noDecimal: true
        }
      },
      {
        type: "number",
        name: "transaction_number",
        required: false,
        presentable: true,
        system: false,
        options: {
          min: null,
          max: null,
          noDecimal: true
        }
      },
      {
        type: "number",
        name: "year",
        required: true,
        presentable: false,
        system: false,
        options: {
          min: 2010,
          max: 2100,
          noDecimal: true
        }
      },

      // Dates
      {
        type: "date",
        name: "post_date",
        required: false,
        presentable: false,
        system: false,
        options: {
          min: "",
          max: ""
        }
      },
      {
        type: "date",
        name: "effective_date",
        required: false,
        presentable: false,
        system: false,
        options: {
          min: "",
          max: ""
        }
      },
      {
        type: "date",
        name: "service_start_date",
        required: false,
        presentable: false,
        system: false,
        options: {
          min: "",
          max: ""
        }
      },
      {
        type: "date",
        name: "service_end_date",
        required: false,
        presentable: false,
        system: false,
        options: {
          min: "",
          max: ""
        }
      },

      // Reversal tracking
      {
        type: "bool",
        name: "is_reversed",
        required: false,
        presentable: false,
        system: false
      },
      {
        type: "date",
        name: "reversal_date",
        required: false,
        presentable: false,
        system: false,
        options: {
          min: "",
          max: ""
        }
      },

      // Financial category relation
      {
        type: "relation",
        name: "financial_category",
        required: false,
        presentable: false,
        system: false,
        collectionId: financialCategoriesCol.id,
        cascadeDelete: false,
        minSelect: null,
        maxSelect: 1
      },

      // Description & notes
      {
        type: "text",
        name: "description",
        required: false,
        presentable: false,
        system: false,
        options: {
          min: null,
          max: 1000,
          pattern: ""
        }
      },
      {
        type: "text",
        name: "transaction_note",
        required: false,
        presentable: false,
        system: false,
        options: {
          min: null,
          max: 2000,
          pattern: ""
        }
      },
      {
        type: "text",
        name: "gl_account_note",
        required: false,
        presentable: false,
        system: false,
        options: {
          min: null,
          max: 500,
          pattern: ""
        }
      },

      // Amounts
      {
        type: "number",
        name: "quantity",
        required: false,
        presentable: false,
        system: false,
        options: {
          min: null,
          max: null,
          noDecimal: true
        }
      },
      {
        type: "number",
        name: "unit_amount",
        required: false,
        presentable: false,
        system: false,
        options: {
          min: null,
          max: null,
          noDecimal: false
        }
      },
      {
        type: "number",
        name: "amount",
        required: false,
        presentable: false,
        system: false,
        options: {
          min: null,
          max: null,
          noDecimal: false
        }
      },

      // GL accounts (string IDs, not relations)
      {
        type: "text",
        name: "recognition_gl_account_id",
        required: false,
        presentable: false,
        system: false,
        options: {
          min: null,
          max: 100,
          pattern: ""
        }
      },
      {
        type: "text",
        name: "deferral_gl_account_id",
        required: false,
        presentable: false,
        system: false,
        options: {
          min: null,
          max: 100,
          pattern: ""
        }
      },

      // Payment method relation
      {
        type: "relation",
        name: "payment_method",
        required: false,
        presentable: false,
        system: false,
        collectionId: paymentMethodsCol.id,
        cascadeDelete: false,
        minSelect: null,
        maxSelect: 1
      },

      // Session relation
      {
        type: "relation",
        name: "session",
        required: false,
        presentable: false,
        system: false,
        collectionId: sessionsCol.id,
        cascadeDelete: false,
        minSelect: null,
        maxSelect: 1
      },

      // Program (CM ID only - no program table exists)
      {
        type: "number",
        name: "program_id",
        required: false,
        presentable: false,
        system: false,
        options: {
          min: null,
          max: null,
          noDecimal: true
        }
      },

      // Session group relation
      {
        type: "relation",
        name: "session_group",
        required: false,
        presentable: false,
        system: false,
        collectionId: sessionGroupsCol.id,
        cascadeDelete: false,
        minSelect: null,
        maxSelect: 1
      },

      // Division relation
      {
        type: "relation",
        name: "division",
        required: false,
        presentable: false,
        system: false,
        collectionId: divisionsCol.id,
        cascadeDelete: false,
        minSelect: null,
        maxSelect: 1
      },

      // Person relation
      {
        type: "relation",
        name: "person",
        required: false,
        presentable: false,
        system: false,
        collectionId: personsCol.id,
        cascadeDelete: false,
        minSelect: null,
        maxSelect: 1
      },

      // Household relation
      {
        type: "relation",
        name: "household",
        required: false,
        presentable: false,
        system: false,
        collectionId: householdsCol.id,
        cascadeDelete: false,
        minSelect: null,
        maxSelect: 1
      },

      // Auto dates
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
      // Unique on cm_id + amount because CampMinder returns both original and reversal
      // with same transactionId but opposite amounts (debit/credit pairs)
      "CREATE UNIQUE INDEX `idx_financial_transactions_cm_id_amount` ON `financial_transactions` (`cm_id`, `amount`)",
      "CREATE INDEX `idx_financial_transactions_year` ON `financial_transactions` (`year`)",
      "CREATE INDEX `idx_financial_transactions_post_date` ON `financial_transactions` (`post_date`)",
      "CREATE INDEX `idx_financial_transactions_person` ON `financial_transactions` (`person`)",
      "CREATE INDEX `idx_financial_transactions_session` ON `financial_transactions` (`session`)",
      "CREATE INDEX `idx_financial_transactions_category` ON `financial_transactions` (`financial_category`)",
      "CREATE INDEX `idx_financial_transactions_division` ON `financial_transactions` (`division`)"
    ]
  });

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("financial_transactions");
  app.delete(collection);
});
