/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Lock down Tier 2 (admin-only) and Tier 3 (deny) collections
 * Dependencies: RBAC user fields (1500000072)
 *
 * Tier 2: Sensitive collections not accessed by frontend. Admin-only.
 * Tier 3: Collections only accessed via FastAPI admin endpoints. Deny direct access.
 *
 * Note: staff_applications trimmed — final adminOnly rules baked into
 * merged CREATE migration #046.
 */

migrate((app) => {
  const adminOnly = '@request.auth.is_admin = true'

  function setRules(name, list, view, create, update, del_) {
    const col = app.findCollectionByNameOrId(name)
    col.listRule = list
    col.viewRule = view
    col.createRule = create
    col.updateRule = update
    col.deleteRule = del_
    app.save(col)
  }

  // Tier 2: Admin-only (sensitive data not accessed by frontend)
  const tier2 = [
    "household_custom_values",
    "financial_transactions", "financial_categories",
    "payment_methods", "camper_dietary", "camper_transportation",
    "staff", "staff_org_categories", "staff_positions",
    "staff_program_areas", "staff_skills", "staff_vehicle_info",
    "person_custom_values", "person_tag_defs", "custom_field_defs",
    "family_camp_adults", "family_camp_medical",
    "family_camp_registrations", "session_groups",
    "config_sections", "sheets_workbooks"
  ]

  for (const name of tier2) {
    setRules(name, adminOnly, adminOnly, adminOnly, adminOnly, adminOnly)
  }

  // Tier 3: Deny direct access (FastAPI-only via admin auth)
  const tier3 = ["debug_parse_results", "solver_runs"]

  for (const name of tier3) {
    setRules(name, '', '', '', '', '')
  }

}, (app) => {
  // Revert to original permissive rules
  const authed = '@request.auth.id != ""'

  function revertRules(name) {
    const col = app.findCollectionByNameOrId(name)
    col.listRule = authed
    col.viewRule = authed
    col.createRule = authed
    col.updateRule = authed
    col.deleteRule = authed
    app.save(col)
  }

  const all = [
    "household_custom_values",
    "financial_transactions", "financial_categories",
    "payment_methods", "camper_dietary", "camper_transportation",
    "staff", "staff_org_categories", "staff_positions",
    "staff_program_areas", "staff_skills", "staff_vehicle_info",
    "person_custom_values", "person_tag_defs", "custom_field_defs",
    "family_camp_adults", "family_camp_medical",
    "family_camp_registrations", "session_groups",
    "config_sections", "sheets_workbooks",
    "debug_parse_results", "solver_runs"
  ]

  for (const name of all) {
    revertRules(name)
  }
});
