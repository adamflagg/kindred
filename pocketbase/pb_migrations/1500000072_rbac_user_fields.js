/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Add RBAC fields to users collection
 * Dependencies: None (modifies existing system collection)
 *
 * Adds:
 * - is_admin (bool): Synced from OIDC admin group on login
 * - cached_permissions (json): Flattened permission array, recomputed by Go hooks
 */

migrate((app) => {
  const collection = app.findCollectionByNameOrId("_pb_users_auth_")

  collection.fields.add(new Field({
    type: "bool",
    name: "is_admin",
    required: false,
    presentable: false
  }))

  collection.fields.add(new Field({
    type: "json",
    name: "cached_permissions",
    required: false,
    presentable: false,
    maxSize: 5000
  }))

  app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("_pb_users_auth_")

  collection.fields.removeByName("is_admin")
  collection.fields.removeByName("cached_permissions")

  app.save(collection)
});
