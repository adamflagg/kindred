/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create locked_group_members collection
 * Dependencies: locked_groups (1500000024), attendees (1500000015)
 *
 * Junction table linking attendees to locked groups. Each member record
 * represents a camper who is part of a lock group and should be kept
 * together with other group members during solver runs.
 *
 * Uses dynamic collection lookups via findCollectionByNameOrId().
 */

migrate((app) => {
  // Dynamic lookups - these collections were created in earlier migrations
  const lockedGroupsCol = app.findCollectionByNameOrId("locked_groups")
  const attendeesCol = app.findCollectionByNameOrId("attendees")

  const collection = new Collection({
    id: "col_locked_members",
    type: "base",
    name: "locked_group_members",
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.id != ""',
    fields: [
      {
        type: "relation",
        name: "group",
        required: true,
        presentable: false,
        collectionId: lockedGroupsCol.id,
        cascadeDelete: true,
        minSelect: null,
        maxSelect: 1
      },
      {
        type: "relation",
        name: "attendee",
        required: true,
        presentable: true,
        collectionId: attendeesCol.id,
        cascadeDelete: false,
        minSelect: null,
        maxSelect: 1
      },
      {
        type: "text",
        name: "added_by",
        required: false,
        presentable: false,
        options: {
          min: null,
          max: 255,
          pattern: ""
        }
      }
    ],
    indexes: [
      "CREATE INDEX `idx_locked_group_members_group` ON `locked_group_members` (`group`)",
      "CREATE INDEX `idx_locked_group_members_attendee` ON `locked_group_members` (`attendee`)",
      "CREATE UNIQUE INDEX `idx_locked_group_members_unique` ON `locked_group_members` (`group`, `attendee`)"
    ]
  });

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("locked_group_members");
  app.delete(collection);
});
