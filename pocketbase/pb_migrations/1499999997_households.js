/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create households collection
 * Dependencies: None
 *
 * Stores household data extracted from CampMinder persons response.
 * Households contain mailing titles, phone, and billing address.
 */

// Fixed collection ID for households
const COLLECTION_ID_HOUSEHOLDS = "col_households";

migrate((app) => {
  const collection = new Collection({
    id: COLLECTION_ID_HOUSEHOLDS,
    type: "base",
    name: "households",
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
        system: false,
        options: {
          min: 1,
          max: null,
          noDecimal: true
        }
      },
      {
        type: "text",
        name: "greeting",
        required: false,
        presentable: false,
        system: false,
        options: {
          min: null,
          max: 500,
          pattern: ""
        }
      },
      {
        type: "text",
        name: "mailing_title",
        required: false,
        presentable: true,
        system: false,
        options: {
          min: null,
          max: 500,
          pattern: ""
        }
      },
      {
        type: "text",
        name: "alternate_mailing_title",
        required: false,
        presentable: false,
        system: false,
        options: {
          min: null,
          max: 500,
          pattern: ""
        }
      },
      {
        type: "text",
        name: "billing_mailing_title",
        required: false,
        presentable: false,
        system: false,
        options: {
          min: null,
          max: 500,
          pattern: ""
        }
      },
      {
        type: "text",
        name: "household_phone",
        required: false,
        presentable: false,
        system: false,
        options: {
          min: null,
          max: 50,
          pattern: ""
        }
      },
      {
        type: "json",
        name: "billing_address",
        required: false,
        presentable: false,
        system: false,
        options: {
          maxSize: 10000
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
      "CREATE UNIQUE INDEX `idx_households_cm_id_year` ON `households` (`cm_id`, `year`)",
      "CREATE INDEX `idx_households_year` ON `households` (`year`)"
    ]
  });

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("households");
  app.delete(collection);
});
