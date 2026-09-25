/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: harden access to users, solver_runs and debug_parse_results
 *
 * Codifies the rules applied live to production on 2026-09-24, so a fresh, CI
 * or local database matches it. On production this migration is a no-op.
 *
 * PocketBase rule semantics, which the earlier migrations got backwards:
 *   null = superusers only;  '' = ANYONE, unauthenticated guests included.
 * 1500000023 and 1500000027 set '' believing it denied access, and users kept
 * PocketBase's default public create rule, so an anonymous request could
 * create an account with is_admin set, and solver_runs / debug_parse_results
 * were readable and writable by anyone.
 *
 * users
 *   createRule '@request.context = "oauth2"' -- OAuth2 sign-up runs through
 *     the normal record-create handler with that request context, so a new
 *     staff member's first login still works and every other create is
 *     refused. null would break first login.
 *   updateRule / deleteRule null -- no self-service edits. is_admin and
 *     cached_permissions are server-owned; rbac/users_guard.go enforces that
 *     on API writes even if these rules are loosened again.
 *   passwordAuth off -- staff sign in through the IdP only. Every password
 *     login in this repo targets _superusers, a separate collection.
 *   list/view rules and the OAuth2 provider config are left untouched.
 * solver_runs
 *   list/view admin-only: the Solver Debug page reads it with the signed-in
 *   admin's token (frontend/src/hooks/useSolverRuns.ts). Every writer is a
 *   superuser or in-process, so create/update/delete are null.
 * debug_parse_results
 *   all five null: only FastAPI touches it, as a superuser.
 */

migrate((app) => {
  const adminOnly = '@request.auth.is_admin = true'

  const users = app.findCollectionByNameOrId("_pb_users_auth_")
  users.createRule = '@request.context = "oauth2"'
  users.updateRule = null
  users.deleteRule = null
  users.passwordAuth.enabled = false
  app.save(users)

  const solverRuns = app.findCollectionByNameOrId("solver_runs")
  solverRuns.listRule = adminOnly
  solverRuns.viewRule = adminOnly
  solverRuns.createRule = null
  solverRuns.updateRule = null
  solverRuns.deleteRule = null
  app.save(solverRuns)

  const debugParse = app.findCollectionByNameOrId("debug_parse_results")
  debugParse.listRule = null
  debugParse.viewRule = null
  debugParse.createRule = null
  debugParse.updateRule = null
  debugParse.deleteRule = null
  app.save(debugParse)
}, (app) => {
  // Rollback symmetry only. This restores the pre-2026-09-24 state, which
  // RE-OPENS anonymous account creation, self-service is_admin edits, password
  // login and public solver_runs / debug_parse_results. Never run it against
  // production.
  const ownerOnly = 'id = @request.auth.id'

  const users = app.findCollectionByNameOrId("_pb_users_auth_")
  users.createRule = ''
  users.updateRule = ownerOnly
  users.deleteRule = ownerOnly
  users.passwordAuth.enabled = true
  app.save(users)

  for (const name of ["solver_runs", "debug_parse_results"]) {
    const col = app.findCollectionByNameOrId(name)
    col.listRule = ''
    col.viewRule = ''
    col.createRule = ''
    col.updateRule = ''
    col.deleteRule = ''
    app.save(col)
  }
});
