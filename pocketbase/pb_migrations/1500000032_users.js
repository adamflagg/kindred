/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Modify users collection listRule
 * Dependencies: None (modifies existing system collection)
 *
 * Allows all authenticated users to list all users (for admin panel).
 * Previously: "id = @request.auth.id" (could only see yourself)
 *
 * NOTE: OAuth2 configuration is handled by the bootstrap script, not migrations.
 */

migrate((app) => {
  const collection = app.findCollectionByNameOrId("_pb_users_auth_");

  // Allow all authenticated users to list all users (for admin panel)
  // Previously: "id = @request.auth.id" (could only see yourself)
  collection.listRule = '@request.auth.id != ""';

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("_pb_users_auth_");

  // Revert to original rule
  collection.listRule = "id = @request.auth.id";

  app.save(collection);
});
