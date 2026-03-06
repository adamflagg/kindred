/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Apply RBAC rules to geo_overrides collection
 * Dependencies: RBAC user fields (1500000072)
 *
 * geo_overrides is a Tier 1 collection (frontend-accessed) that was created
 * before the RBAC system. This migration locks it down to metrics.geo permission.
 * Read and write both require metrics.geo since managing overrides is the
 * primary purpose of the geo admin page.
 */

migrate((app) => {
  const metricsGeo = '@request.auth.is_admin = true || @request.auth.cached_permissions ~ "metrics.geo"'

  const col = app.findCollectionByNameOrId("geo_overrides")
  col.listRule = metricsGeo
  col.viewRule = metricsGeo
  col.createRule = metricsGeo
  col.updateRule = metricsGeo
  col.deleteRule = metricsGeo
  app.save(col)
}, (app) => {
  const authed = '@request.auth.id != ""'

  const col = app.findCollectionByNameOrId("geo_overrides")
  col.listRule = authed
  col.viewRule = authed
  col.createRule = authed
  col.updateRule = authed
  col.deleteRule = authed
  app.save(col)
});
