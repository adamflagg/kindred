/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: financial_transactions + financial_aid_applications become
 * superuser-only (campership spec §14.3, analysis §9.1 principle 1).
 * Dependencies: 1500000031, 1500000036
 *
 * Per-family money reaches a browser only through FastAPI endpoints gated by
 * require_permission, and, until kindred#2836 lands, the live Google Sheets
 * export; FastAPI reads PocketBase as a superuser, and the Go sync and Sheets
 * exporter read through the DAO. None of them is affected by these rules.
 * Before this, both tables were `@request.auth.is_admin = true` on all five
 * rules, so any admin could read or WRITE them through the SDK.
 *
 * Searched 2026-09-25 (git grep, all of api/ bunking/ frontend/src scripts/
 * pb_hooks/): no SDK or REST reader of either table exists -- every mention is
 * a sync-job id, generated types, or SQLite tooling. Evidence is in the PR.
 *
 * null = superusers only. NEVER '' -- that is PUBLIC (kindred#2833).
 * Idempotent: rules are set to a fixed target.
 */

const TABLES = ["financial_transactions", "financial_aid_applications"]
const ADMIN_ONLY = "@request.auth.is_admin = true"

function setAllRules(app, name, rule) {
  const col = app.findCollectionByNameOrId(name)
  col.listRule = rule
  col.viewRule = rule
  col.createRule = rule
  col.updateRule = rule
  col.deleteRule = rule
  app.save(col)
}

migrate((app) => {
  for (const name of TABLES) {
    setAllRules(app, name, null)
  }
}, (app) => {
  for (const name of TABLES) {
    setAllRules(app, name, ADMIN_ONLY)
  }
});
