/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create locked_groups and locked_group_members collections
 * Dependencies: saved_scenarios (1500000014), camp_sessions (1500000001), attendees (1500000007)
 *
 * Lock groups allow staff to "lock" a set of campers together so the solver
 * keeps them in the same bunk. Groups are per-scenario (draft).
 *
 * Uses dynamic collection lookups via findCollectionByNameOrId().
 */

migrate((app) => {
  // Dynamic lookups - these collections were created in earlier migrations
  const scenariosCol = app.findCollectionByNameOrId("saved_scenarios")
  const sessionsCol = app.findCollectionByNameOrId("camp_sessions")
  const attendeesCol = app.findCollectionByNameOrId("attendees")

  // Create locked_groups with relations
  const lockedGroups = new Collection({
    name: "locked_groups",
    type: "base",
    system: false,
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.id != ""',
    fields: [
      {
        type: "relation",
        name: "scenario",
        required: true,
        presentable: false,
        system: false,
        collectionId: scenariosCol.id,
        cascadeDelete: true,
        minSelect: null,
        maxSelect: 1
      },
      {
        type: "text",
        name: "name",
        required: false,
        presentable: true,
        system: false,
        options: {
          autogeneratePattern: "",
          min: 0,
          max: 0,
          pattern: "",
          primaryKey: false
        }
      },
      {
        type: "relation",
        name: "session",
        required: true,
        presentable: false,
        system: false,
        collectionId: sessionsCol.id,
        cascadeDelete: false,
        minSelect: null,
        maxSelect: 1
      },
      {
        type: "number",
        name: "year",
        required: true,
        presentable: false,
        system: false,
        options: {
          min: 2013,
          max: 2100,
          noDecimal: true
        }
      },
      {
        type: "text",
        name: "color",
        required: true,
        presentable: false,
        system: false,
        options: {
          min: 1,
          max: 20,
          pattern: ""
        }
      },
      {
        type: "text",
        name: "created_by",
        required: false,
        presentable: false,
        system: false,
        options: {
          min: null,
          max: 255,
          pattern: ""
        }
      },
      {
        type: "autodate",
        name: "created",
        required: false,
        presentable: false,
        system: false,
        onCreate: true,
        onUpdate: false
      },
      {
        type: "autodate",
        name: "updated",
        required: false,
        presentable: false,
        system: false,
        onCreate: true,
        onUpdate: true
      }
    ],
    indexes: [
      "CREATE INDEX `idx_locked_groups_scenario` ON `locked_groups` (`scenario`)",
      "CREATE INDEX `idx_locked_groups_session` ON `locked_groups` (`session`)",
      "CREATE INDEX `idx_locked_groups_scenario_session_year` ON `locked_groups` (`scenario`, `session`, `year`)"
    ],
    options: {}
  })

  app.save(lockedGroups)

  // Need to look up locked_groups after saving it
  const lockedGroupsCol = app.findCollectionByNameOrId("locked_groups")

  // Create locked_group_members with relations
  const lockedGroupMembers = new Collection({
    name: "locked_group_members",
    type: "base",
    system: false,
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
        system: false,
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
        system: false,
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
        system: false,
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
    ],
    options: {}
  })

  return app.save(lockedGroupMembers)

}, (app) => {
  // Rollback: Remove the collections
  const lockedGroupMembers = app.findCollectionByNameOrId("locked_group_members")
  if (lockedGroupMembers) {
    app.delete(lockedGroupMembers)
  }

  const lockedGroups = app.findCollectionByNameOrId("locked_groups")
  if (lockedGroups) {
    app.delete(lockedGroups)
  }
})
