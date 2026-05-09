/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create households collection
 * Dependencies: None
 *
 * Stores household data extracted from CampMinder persons response.
 * Households contain mailing titles, phone, and discrete billing address columns.
 */

const COLLECTION_ID_HOUSEHOLDS = "col_households";

migrate((app) => {
  const collection = new Collection({
    id: COLLECTION_ID_HOUSEHOLDS,
    type: "base",
    name: "households",
    listRule: '@request.auth.is_admin = true',
    viewRule: '@request.auth.is_admin = true',
    createRule: '@request.auth.is_admin = true',
    updateRule: '@request.auth.is_admin = true',
    deleteRule: '@request.auth.is_admin = true',
    fields: [
      {
        type: "number",
        name: "cm_id",
        required: true,
        presentable: false,
        min: 1,
        max: null,
        onlyInt: true
      },
      {
        type: "text",
        name: "greeting",
        required: false,
        presentable: false,
        min: 0,
        max: 0,
        pattern: ""
      },
      {
        type: "text",
        name: "mailing_title",
        required: false,
        presentable: true,
        min: 0,
        max: 0,
        pattern: ""
      },
      {
        type: "text",
        name: "alternate_mailing_title",
        required: false,
        presentable: false,
        min: 0,
        max: 0,
        pattern: ""
      },
      {
        type: "text",
        name: "billing_mailing_title",
        required: false,
        presentable: false,
        min: 0,
        max: 0,
        pattern: ""
      },
      {
        type: "text",
        name: "household_phone",
        required: false,
        presentable: false,
        min: 0,
        max: 0,
        pattern: ""
      },
      {
        type: "number",
        name: "year",
        required: true,
        presentable: false,
        min: 2010,
        max: 2100,
        onlyInt: true
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
      },
      {
        type: "text",
        name: "billing_address1",
        required: false,
        presentable: false,
        min: 0,
        max: 500,
        pattern: ""
      },
      {
        type: "text",
        name: "billing_address2",
        required: false,
        presentable: false,
        min: 0,
        max: 500,
        pattern: ""
      },
      {
        type: "text",
        name: "billing_city",
        required: false,
        presentable: false,
        min: 0,
        max: 200,
        pattern: ""
      },
      {
        type: "text",
        name: "billing_state",
        required: false,
        presentable: false,
        min: 0,
        max: 50,
        pattern: ""
      },
      {
        type: "text",
        name: "billing_postal_code",
        required: false,
        presentable: false,
        min: 0,
        max: 20,
        pattern: ""
      },
      {
        type: "text",
        name: "billing_country",
        required: false,
        presentable: false,
        min: 0,
        max: 10,
        pattern: ""
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
