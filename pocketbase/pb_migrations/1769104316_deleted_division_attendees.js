/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  // Defensive: collection may not exist on fresh databases
  try {
    const collection = app.findCollectionByNameOrId("col_div_attendees");
    if (collection) {
      app.delete(collection);
    }
  } catch (e) {
    // Collection doesn't exist - nothing to delete
  }
}, (app) => {
  const collection = new Collection({
    "createRule": "@request.auth.id != \"\"",
    "deleteRule": "@request.auth.id != \"\"",
    "fields": [
      {
        "autogeneratePattern": "[a-z0-9]{15}",
        "hidden": false,
        "id": "text3208210256",
        "max": 15,
        "min": 15,
        "name": "id",
        "pattern": "^[a-z0-9]+$",
        "presentable": false,
        "primaryKey": true,
        "required": true,
        "system": true,
        "type": "text"
      },
      {
        "hidden": false,
        "id": "number1224526204",
        "max": null,
        "min": null,
        "name": "cm_id",
        "onlyInt": false,
        "presentable": false,
        "required": true,
        "system": false,
        "type": "number"
      },
      {
        "hidden": false,
        "id": "number561756999",
        "max": null,
        "min": null,
        "name": "person_id",
        "onlyInt": false,
        "presentable": false,
        "required": true,
        "system": false,
        "type": "number"
      },
      {
        "cascadeDelete": false,
        "collectionId": "col_persons",
        "hidden": false,
        "id": "relation886886774",
        "maxSelect": 1,
        "minSelect": 0,
        "name": "person",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "relation"
      },
      {
        "hidden": false,
        "id": "number1099272841",
        "max": null,
        "min": null,
        "name": "division_id",
        "onlyInt": false,
        "presentable": false,
        "required": true,
        "system": false,
        "type": "number"
      },
      {
        "cascadeDelete": false,
        "collectionId": "col_divisions",
        "hidden": false,
        "id": "relation269960980",
        "maxSelect": 1,
        "minSelect": 0,
        "name": "division",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "relation"
      },
      {
        "hidden": false,
        "id": "number3145888567",
        "max": null,
        "min": null,
        "name": "year",
        "onlyInt": false,
        "presentable": false,
        "required": true,
        "system": false,
        "type": "number"
      },
      {
        "hidden": false,
        "id": "autodate2990389176",
        "name": "created",
        "onCreate": true,
        "onUpdate": false,
        "presentable": false,
        "system": false,
        "type": "autodate"
      },
      {
        "hidden": false,
        "id": "autodate3332085495",
        "name": "updated",
        "onCreate": true,
        "onUpdate": true,
        "presentable": false,
        "system": false,
        "type": "autodate"
      }
    ],
    "id": "col_div_attendees",
    "indexes": [
      "CREATE UNIQUE INDEX `idx_div_attendees_person_div_year` ON `division_attendees` (`person_id`, `division_id`, `year`)",
      "CREATE INDEX `idx_div_attendees_year` ON `division_attendees` (`year`)",
      "CREATE INDEX `idx_div_attendees_division` ON `division_attendees` (`division_id`)"
    ],
    "listRule": "@request.auth.id != \"\"",
    "name": "division_attendees",
    "system": false,
    "type": "base",
    "updateRule": "@request.auth.id != \"\"",
    "viewRule": "@request.auth.id != \"\""
  });

  return app.save(collection);
})
