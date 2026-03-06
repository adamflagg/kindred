/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Create user_roles junction collection for RBAC
 * Dependencies: roles (1500000070), users (system)
 *
 * Maps users to roles. Unique index prevents duplicate assignments.
 */

migrate((app) => {
  const rolesCol = app.findCollectionByNameOrId("roles")
  const usersCol = app.findCollectionByNameOrId("_pb_users_auth_")

  const collection = new Collection({
    id: "col_rbac_user_roles",
    type: "base",
    name: "user_roles",
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.is_admin = true || @request.auth.cached_permissions ~ "users.manage"',
    updateRule: '@request.auth.is_admin = true || @request.auth.cached_permissions ~ "users.manage"',
    deleteRule: '@request.auth.is_admin = true || @request.auth.cached_permissions ~ "users.manage"',
    fields: [
      {
        type: "relation",
        name: "user",
        required: true,
        presentable: true,
        collectionId: usersCol.id,
        cascadeDelete: true,
        minSelect: null,
        maxSelect: 1
      },
      {
        type: "relation",
        name: "role",
        required: true,
        presentable: true,
        collectionId: rolesCol.id,
        cascadeDelete: true,
        minSelect: null,
        maxSelect: 1
      },
      {
        type: "autodate",
        name: "created",
        onCreate: true,
        onUpdate: false
      },
      {
        type: "autodate",
        name: "updated",
        onCreate: true,
        onUpdate: true
      }
    ],
    indexes: [
      "CREATE UNIQUE INDEX `idx_user_roles_unique` ON `user_roles` (`user`, `role`)",
      "CREATE INDEX `idx_user_roles_user` ON `user_roles` (`user`)",
      "CREATE INDEX `idx_user_roles_role` ON `user_roles` (`role`)"
    ]
  });

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("user_roles");
  app.delete(collection);
});
