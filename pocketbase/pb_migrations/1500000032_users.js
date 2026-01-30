/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Modify users collection listRule and enable OAuth2
 * Dependencies: None (modifies existing system collection)
 *
 * - Allows all authenticated users to list all users (for admin panel)
 *   Previously: "id = @request.auth.id" (could only see yourself)
 * - Enables OAuth2 authentication
 *
 * NOTE: OAuth2 provider configuration is handled by the bootstrap script, not migrations.
 *
 * CONSOLIDATED: Includes changes from migration 1769210262 (oauth2 enabled)
 */

migrate((app) => {
  const collection = app.findCollectionByNameOrId("_pb_users_auth_");

  // Allow all authenticated users to list all users (for admin panel)
  collection.listRule = '@request.auth.id != ""';

  // Enable OAuth2 authentication
  unmarshal({
    "oauth2": {
      "enabled": true
    }
  }, collection);

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("_pb_users_auth_");

  // Revert to original rule
  collection.listRule = "id = @request.auth.id";

  // Disable OAuth2
  unmarshal({
    "oauth2": {
      "enabled": false
    }
  }, collection);

  app.save(collection);
});
