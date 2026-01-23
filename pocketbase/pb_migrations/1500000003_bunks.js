/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create bunks collection
 * Dependencies: None
 *
 * IMPORTANT: Uses fixed collection ID so dependent migrations can reference
 * it directly without findCollectionByNameOrId (which fails in fresh DB).
 */

const COLLECTION_ID_BUNKS = "col_bunks";

migrate((app) => {
  const collection = new Collection({
    id: COLLECTION_ID_BUNKS,
    name: "bunks",
    type: "base",
    system: false,
    fields: [
      {
        name: "cm_id",
        type: "number",
        required: true,
        presentable: false,
        system: false,
        options: {
          min: null,
          max: null,
          noDecimal: true
        }
      },
      {
        name: "name",
        type: "text",
        required: true,
        presentable: true,
        system: false,
        options: {
          min: null,
          max: null,
          pattern: ""
        }
      },
      {
        name: "year",
        type: "number",
        required: true,
        presentable: false,
        system: false,
        options: {
          min: null,
          max: null,
          noDecimal: true
        }
      },
      {
        name: "gender",
        type: "text",
        required: false,
        presentable: false,
        system: false,
        options: {
          min: null,
          max: 10,
          pattern: ""
        }
      },
      {
        name: "is_active",
        type: "bool",
        required: false,
        presentable: false
      },
      {
        name: "sort_order",
        type: "number",
        required: false,
        presentable: false,
        options: {
          min: null,
          max: null,
          noDecimal: true
        }
      },
      {
        name: "area_id",
        type: "number",
        required: false,
        presentable: false,
        options: {
          min: null,
          max: null,
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
      "CREATE UNIQUE INDEX `idx_bunks_campminder_year` ON `bunks` (`cm_id`, `year`)",
      "CREATE INDEX `idx_zL6XKZjgMQ` ON `bunks` (`name`)",
      "CREATE INDEX `idx_03EsqBQcEG` ON `bunks` (`cm_id`)"
    ],
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.id != ""',
    options: {}
  })

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("bunks")
  return app.delete(collection)
})
