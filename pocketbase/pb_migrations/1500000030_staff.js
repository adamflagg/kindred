/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create staff collection
 * Dependencies: persons, staff_positions, staff_org_categories, divisions, bunks
 *
 * Stores staff records from CampMinder /staff endpoint.
 * Year-scoped table with relations to lookup tables and persons.
 * BunkAssignments stored as multi-relation to bunks.
 *
 * IMPORTANT: Uses fixed collection ID so dependent migrations can reference
 * it directly without findCollectionByNameOrId (which fails in fresh DB).
 */

const COLLECTION_ID_STAFF = "col_staff";

migrate((app) => {
  const adminOnly = '@request.auth.is_admin = true';

  // Lookup related collections for relations
  const personsCol = app.findCollectionByNameOrId("persons");
  const positionsCol = app.findCollectionByNameOrId("staff_positions");
  const orgCategoriesCol = app.findCollectionByNameOrId("staff_org_categories");
  const divisionsCol = app.findCollectionByNameOrId("divisions");
  const bunksCol = app.findCollectionByNameOrId("bunks");

  const collection = new Collection({
    id: COLLECTION_ID_STAFF,
    type: "base",
    name: "staff",
    listRule: adminOnly,
    viewRule: adminOnly,
    createRule: adminOnly,
    updateRule: adminOnly,
    deleteRule: adminOnly,
    fields: [
      // Person relation
      {
        type: "relation",
        name: "person",
        required: false,
        presentable: true,
        collectionId: personsCol.id,
        cascadeDelete: false,
        minSelect: null,
        maxSelect: 1
      },
      // CampMinder person ID for transform job lookups
      {
        type: "number",
        name: "person_id",
        required: false,
        presentable: false,
        min: 1,
        max: 999999999,
        onlyInt: true
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

      // Status
      {
        type: "number",
        name: "status_id",
        required: false,
        presentable: false,
        min: 1,
        max: 4,
        onlyInt: true
      },
      {
        type: "select",
        name: "status",
        required: false,
        presentable: false,
        values: ["active", "resigned", "dismissed", "cancelled"],
        maxSelect: 1
      },

      // Organization
      {
        type: "relation",
        name: "organizational_category",
        required: false,
        presentable: false,
        collectionId: orgCategoriesCol.id,
        cascadeDelete: false,
        minSelect: null,
        maxSelect: 1
      },
      {
        type: "relation",
        name: "position1",
        required: false,
        presentable: false,
        collectionId: positionsCol.id,
        cascadeDelete: false,
        minSelect: null,
        maxSelect: 1
      },
      {
        type: "relation",
        name: "position2",
        required: false,
        presentable: false,
        collectionId: positionsCol.id,
        cascadeDelete: false,
        minSelect: null,
        maxSelect: 1
      },
      {
        type: "relation",
        name: "division",
        required: false,
        presentable: false,
        collectionId: divisionsCol.id,
        cascadeDelete: false,
        minSelect: null,
        maxSelect: 1
      },

      // Bunk assignments (multi-relation)
      {
        type: "relation",
        name: "bunks",
        required: false,
        presentable: false,
        collectionId: bunksCol.id,
        cascadeDelete: false,
        minSelect: 0,
        maxSelect: 999
      },
      {
        type: "bool",
        name: "bunk_staff",
        required: false,
        presentable: false
      },

      // Employment dates
      {
        type: "date",
        name: "hire_date",
        required: false,
        presentable: false
      },
      {
        type: "date",
        name: "employment_start_date",
        required: false,
        presentable: false
      },
      {
        type: "date",
        name: "employment_end_date",
        required: false,
        presentable: false
      },

      // Contract tracking
      {
        type: "date",
        name: "contract_in_date",
        required: false,
        presentable: false
      },
      {
        type: "date",
        name: "contract_out_date",
        required: false,
        presentable: false
      },
      {
        type: "date",
        name: "contract_due_date",
        required: false,
        presentable: false
      },

      // Other fields
      {
        type: "select",
        name: "international",
        required: false,
        presentable: false,
        values: ["domestic", "international"],
        maxSelect: 1
      },
      {
        type: "number",
        name: "years",
        required: false,
        presentable: false,
        min: 0,
        max: null,
        onlyInt: true
      },
      {
        type: "number",
        name: "salary",
        required: false,
        presentable: false,
        min: null,
        max: null,
        onlyInt: false
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
      "CREATE UNIQUE INDEX `idx_staff_person_year` ON `staff` (`year`, `person`)",
      "CREATE INDEX `idx_staff_year` ON `staff` (`year`)",
      "CREATE INDEX `idx_staff_status_id` ON `staff` (`status_id`)",
      "CREATE INDEX `idx_staff_person` ON `staff` (`person`)",
      "CREATE INDEX `idx_staff_person_id` ON `staff` (`person_id`)"
    ]
  });

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("staff");
  app.delete(collection);
});
