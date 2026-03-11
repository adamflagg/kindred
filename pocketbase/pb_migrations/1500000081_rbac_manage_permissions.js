/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Add manage panel permissions to roles
 * Dependencies: RBAC consolidate (1500000079)
 *
 * - Adds registration.manage to Registrar role
 * - Adds sheets.export to Finance and Bunking Staff roles
 * - Restores users.manage support in user_roles collection rules
 * - Updates config collection to allow registration.manage for writes
 */

migrate((app) => {
  const rolesCol = app.findCollectionByNameOrId("roles")

  // 1. Add registration.manage to Registrar
  try {
    const registrarRecords = app.findRecordsByFilter(rolesCol.id, `slug = "registrar"`, "", 1, 0)
    if (registrarRecords.length > 0) {
      const registrar = registrarRecords[0]
      const perms = registrar.get("permissions") || []
      if (!perms.includes("registration.manage")) {
        perms.push("registration.manage")
        registrar.set("permissions", perms)
        app.save(registrar)
      }
    }
  } catch (_e) {
    // Registrar role may not exist
  }

  // 2. Add sheets.export to Finance
  try {
    const financeRecords = app.findRecordsByFilter(rolesCol.id, `slug = "finance"`, "", 1, 0)
    if (financeRecords.length > 0) {
      const finance = financeRecords[0]
      const perms = finance.get("permissions") || []
      if (!perms.includes("sheets.export")) {
        perms.push("sheets.export")
        finance.set("permissions", perms)
        app.save(finance)
      }
    }
  } catch (_e) {
    // Finance role may not exist
  }

  // 3. Add sheets.export to Bunking Staff
  try {
    const bsRecords = app.findRecordsByFilter(rolesCol.id, `slug = "bunking-staff"`, "", 1, 0)
    if (bsRecords.length > 0) {
      const bs = bsRecords[0]
      const perms = bs.get("permissions") || []
      if (!perms.includes("sheets.export")) {
        perms.push("sheets.export")
        bs.set("permissions", perms)
        app.save(bs)
      }
    }
  } catch (_e) {
    // Bunking Staff role may not exist
  }

  // 4. Restore users.manage in user_roles collection rules
  const urCol = app.findCollectionByNameOrId("user_roles")
  const usersManageRule = '@request.auth.is_admin = true || @request.auth.cached_permissions ~ "users.manage"'
  urCol.createRule = usersManageRule
  urCol.updateRule = usersManageRule
  urCol.deleteRule = usersManageRule
  app.save(urCol)

  // 5. Update config collection — allow registration.manage for writes on registration configs
  // Config writes are gated by a Go hook (checking business_category), so we update
  // the PocketBase rule to allow either admin OR registration.manage holders
  const configCol = app.findCollectionByNameOrId("config")
  const configWriteRule = '@request.auth.is_admin = true || @request.auth.cached_permissions ~ "registration.manage"'
  configCol.createRule = configWriteRule
  configCol.updateRule = configWriteRule
  // Delete stays admin-only
  configCol.deleteRule = '@request.auth.is_admin = true'
  app.save(configCol)

}, (app) => {
  // Revert: remove new permissions from roles, restore strict admin rules

  const rolesCol = app.findCollectionByNameOrId("roles")

  // 1. Remove registration.manage from Registrar
  try {
    const registrarRecords = app.findRecordsByFilter(rolesCol.id, `slug = "registrar"`, "", 1, 0)
    if (registrarRecords.length > 0) {
      const registrar = registrarRecords[0]
      const perms = (registrar.get("permissions") || []).filter((p) => p !== "registration.manage")
      registrar.set("permissions", perms)
      app.save(registrar)
    }
  } catch (_e) {}

  // 2. Remove sheets.export from Finance
  try {
    const financeRecords = app.findRecordsByFilter(rolesCol.id, `slug = "finance"`, "", 1, 0)
    if (financeRecords.length > 0) {
      const finance = financeRecords[0]
      const perms = (finance.get("permissions") || []).filter((p) => p !== "sheets.export")
      finance.set("permissions", perms)
      app.save(finance)
    }
  } catch (_e) {}

  // 3. Remove sheets.export from Bunking Staff
  try {
    const bsRecords = app.findRecordsByFilter(rolesCol.id, `slug = "bunking-staff"`, "", 1, 0)
    if (bsRecords.length > 0) {
      const bs = bsRecords[0]
      const perms = (bs.get("permissions") || []).filter((p) => p !== "sheets.export")
      bs.set("permissions", perms)
      app.save(bs)
    }
  } catch (_e) {}

  // 4. Revert user_roles rules to admin-only
  const urCol = app.findCollectionByNameOrId("user_roles")
  urCol.createRule = '@request.auth.is_admin = true'
  urCol.updateRule = '@request.auth.is_admin = true'
  urCol.deleteRule = '@request.auth.is_admin = true'
  app.save(urCol)

  // 5. Revert config collection to admin-only writes
  const configCol = app.findCollectionByNameOrId("config")
  configCol.createRule = '@request.auth.is_admin = true'
  configCol.updateRule = '@request.auth.is_admin = true'
  configCol.deleteRule = '@request.auth.is_admin = true'
  app.save(configCol)
})
