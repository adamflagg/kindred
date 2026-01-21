/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Convert group_id from number to session_group relation
 * Dependencies: 1500000026_camp_sessions_full_sync.js, 1500000027_session_groups.js
 *
 * Replaces the numeric group_id field with a proper PocketBase relation to session_groups.
 * The sync service will resolve CampMinder group IDs to PocketBase record IDs.
 */

migrate((app) => {
  const collection = app.findCollectionByNameOrId("camp_sessions");
  const sessionGroupsCol = app.findCollectionByNameOrId("session_groups");

  // Remove old number field
  collection.fields.removeByName("group_id");

  // Add relation field
  collection.fields.add(new Field({
    type: "relation",
    name: "session_group",
    required: false,
    presentable: false,
    system: false,
    collectionId: sessionGroupsCol.id,
    cascadeDelete: false,
    minSelect: null,
    maxSelect: 1
  }));

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("camp_sessions");

  // Remove relation field
  collection.fields.removeByName("session_group");

  // Restore number field
  collection.fields.add(new Field({
    type: "number",
    name: "group_id",
    required: false,
    presentable: false,
    system: false,
    options: {
      min: null,
      max: null,
      noDecimal: true
    }
  }));

  app.save(collection);
});
