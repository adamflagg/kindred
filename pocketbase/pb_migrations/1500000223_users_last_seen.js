/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: users.last_seen — when the person last opened Kindred
 * (spec 2026-10-01-users-page-uplift-design §3.5).
 *
 * last_login only moves on a full Pocket ID sign-in; sessions refresh for
 * months without one. The rbac auth-refresh hook stamps last_seen (hourly at
 * most). Seeded from last_login so the column is not blank on day one.
 */
migrate((app) => {
  const users = app.findCollectionByNameOrId("_pb_users_auth_")
  users.fields.add(new Field({ type: "date", name: "last_seen", required: false, presentable: false, min: "", max: "" }))
  app.save(users)
  app.db().newQuery("UPDATE users SET last_seen = last_login WHERE last_seen = '' AND last_login != ''").execute()
}, (app) => {
  const users = app.findCollectionByNameOrId("_pb_users_auth_")
  users.fields.removeByName("last_seen")
  app.save(users)
})
