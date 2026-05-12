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
 * Note: camper_dietary trimmed — final adminOnly rules baked into
 * merged CREATE migration #044.
 * Note: camper_transportation trimmed — final adminOnly rules baked into
 * merged CREATE migration #043.
 * Note: staff_vehicle_info trimmed — final adminOnly rules baked into
 * merged CREATE migration #047.
 * Note: family_camp_adults trimmed — final adminOnly rules baked into
 * merged CREATE migration #035.
 * Note: family_camp_medical trimmed — final adminOnly rules baked into
 * merged CREATE migration #035.
 * Note: family_camp_registrations trimmed — final adminOnly rules baked into
 * merged CREATE migration #035.
 * Note: session_groups trimmed — final adminOnly rules baked into
 * merged CREATE migration #005.
 * Note: config_sections trimmed — final adminOnly rules baked into
 * merged CREATE migration #012.
 * Note: custom_field_defs trimmed — final adminOnly rules baked into
 * merged CREATE migration #002.
 * Note: financial_categories trimmed — final adminOnly rules baked into
 * merged CREATE migration #009.
 * Note: financial_transactions trimmed — final adminOnly rules baked into
 * merged CREATE migration #031.
 * Note: household_custom_values trimmed — final adminOnly rules baked into
 * merged CREATE migration #029.
 * Note: payment_methods trimmed — final adminOnly rules baked into
 * merged CREATE migration #010.
 * Note: person_custom_values trimmed — final adminOnly rules baked into
 * merged CREATE migration #028.
 * Note: person_tag_defs trimmed — final adminOnly rules baked into
 * merged CREATE migration #001.
 * Note: sheets_workbooks trimmed — final adminOnly rules baked into
 * merged CREATE migration #039.
 * Note: staff trimmed — final adminOnly rules baked into
 * merged CREATE migration #030.
 * Note: staff_org_categories trimmed — final adminOnly rules baked into
 * merged CREATE migration #008.
 * Note: staff_positions trimmed — final adminOnly rules baked into
 * merged CREATE migration #014.
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
    "staff_program_areas", "staff_skills"
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
    "staff_program_areas", "staff_skills",
    "debug_parse_results", "solver_runs"
  ]

  for (const name of all) {
    revertRules(name)
  }
});
