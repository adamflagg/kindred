/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create sheets_workbooks collection
 * Dependencies: none
 *
 * Tracks Google Sheets workbooks created by the export system.
 * One globals workbook plus one workbook per year.
 * Stores spreadsheet IDs to avoid env var sprawl and prevent duplicate creation.
 */

const COLLECTION_ID_SHEETS_WORKBOOKS = "col_sheets_workbooks";

migrate((app) => {
  const collection = new Collection({
    id: COLLECTION_ID_SHEETS_WORKBOOKS,
    type: "base",
    name: "sheets_workbooks",
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.id != ""',
    fields: [
      // Google Sheets spreadsheet ID (from URL)
      {
        type: "text",
        name: "spreadsheet_id",
        required: true,
        presentable: true,
        min: 1,
        max: 200,
        pattern: ""
      },
      // Workbook type: "globals" or "year"
      {
        type: "select",
        name: "workbook_type",
        required: true,
        presentable: true,
        values: ["globals", "year"],
        maxSelect: 1
      },
      // Year (null for globals workbook)
      {
        type: "number",
        name: "year",
        required: false,
        presentable: true,
        min: 2010,
        max: 2100,
        onlyInt: true
      },
      // Human-readable workbook title
      {
        type: "text",
        name: "title",
        required: true,
        presentable: true,
        min: 1,
        max: 500,
        pattern: ""
      },
      // Direct URL to the workbook
      {
        type: "url",
        name: "url",
        required: false,
        presentable: false
      },
      // Number of tabs in the workbook
      {
        type: "number",
        name: "tab_count",
        required: false,
        presentable: false,
        min: 0,
        max: 1000,
        onlyInt: true
      },
      // Total records across all tabs
      {
        type: "number",
        name: "total_records",
        required: false,
        presentable: false,
        min: 0,
        max: null,
        onlyInt: true
      },
      // Sync status
      {
        type: "select",
        name: "status",
        required: false,
        presentable: false,
        values: ["ok", "error", "syncing"],
        maxSelect: 1
      },
      // Error message if status is "error"
      {
        type: "text",
        name: "error_message",
        required: false,
        presentable: false,
        min: 0,
        max: 5000,
        pattern: ""
      },
      // Auto timestamps
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
        name: "last_sync",
        required: false,
        presentable: false,
        onCreate: true,
        onUpdate: true
      }
    ],
    indexes: [
      // Ensure only one globals workbook and one workbook per year
      "CREATE UNIQUE INDEX `idx_sheets_workbooks_type_year` ON `sheets_workbooks` (`workbook_type`, `year`)",
      // Fast lookup by spreadsheet ID
      "CREATE INDEX `idx_sheets_workbooks_spreadsheet` ON `sheets_workbooks` (`spreadsheet_id`)"
    ]
  });

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("sheets_workbooks");
  app.delete(collection);
});
