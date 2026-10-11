/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: staff session tokens last 12 hours, not days
 *
 * Kindred checks the identity provider only at sign-in. After that a staff
 * session is a PocketBase auth token, and nothing asks the provider again, so
 * disabling or deleting someone there does not end a session they already
 * hold. How long it keeps working is this duration.
 *
 * Neither database had chosen one. A fresh database takes PocketBase's
 * default for the version it is created on (5 days at v0.40); one created on
 * an earlier version keeps that version's default (7 days before v0.40).
 *
 * 12 hours is a sliding window, not an absolute cap: AuthContext calls
 * authRefresh on every app load, and PocketBase mints the new token from the
 * old one without asking the provider. So an account removed at the provider
 * stops working once 12 hours pass without the app being loaded, and an open
 * tab older than 12 hours is sent back to sign in. Someone who keeps loading
 * the app is not stopped by this alone; removing their user row in PocketBase
 * is the immediate lever.
 *
 * The value is an owner decision, recorded in the PR that adds this file.
 * rbac/auth_token_duration_booted_test.go asserts it on a migrated database.
 */

migrate((app) => {
  const users = app.findCollectionByNameOrId("_pb_users_auth_")
  users.authToken.duration = 43200 // 12h
  app.save(users)
}, (app) => {
  // Rollback symmetry only: the 7-day value long-lived databases carried.
  const users = app.findCollectionByNameOrId("_pb_users_auth_")
  users.authToken.duration = 604800
  app.save(users)
})
