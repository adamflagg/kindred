/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Set emailVisibility = true for all existing users
 * Dependencies: None (modifies existing system collection records)
 *
 * PocketBase hides the email field from other users unless emailVisibility is true.
 * This migration enables email visibility for all existing users so the user list
 * page can display emails. New users get emailVisibility set via the OIDC login hook.
 *
 * Closes #700
 */

migrate((app) => {
  const users = app.findRecordsByFilter("_pb_users_auth_", "1=1", "", 0, 0)

  let updated = 0
  for (const user of users) {
    if (!user.getBool("emailVisibility")) {
      user.set("emailVisibility", true)
      app.save(user)
      updated++
    }
  }

  if (updated > 0) {
    console.log(`Set emailVisibility=true for ${updated} users`)
  }
}, (app) => {
  // Revert: set emailVisibility back to false for all users
  const users = app.findRecordsByFilter("_pb_users_auth_", "1=1", "", 0, 0)

  for (const user of users) {
    user.set("emailVisibility", false)
    app.save(user)
  }
})
