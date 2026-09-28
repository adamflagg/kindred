/// <reference path="../pb_data/types.d.ts" />
/**
 * sync_runs: aid_ledger_warnings_count (2026-09 aid-ledger hardening, F1/F2).
 *
 * aid_postings needs a run-level, non-fatal warning counter for three data-quality
 * conditions found in the 2026-09-27 prod diagnosis: no aid_sources classification file
 * found, more than half of a season's live postings still unclassified_source, and
 * financial_transactions' last recorded run not succeeding (stale input).
 *
 * Deliberately NOT Stats.Rejected: rejection_sites_test.go pins that counter to per-record
 * transform rejections only (a structural census, not a style preference), and Rejected also
 * suppresses a collection's orphan sweep for the whole run (base_sync.go) -- neither behavior
 * belongs to a run-level config/staleness condition. This mirrors prod_audit_warnings_count
 * and lodging_prod_audit_warnings_count exactly: observe-only, warn-only, its own column.
 *
 * Field properties are direct (v0.23+ ignores an options wrapper silently).
 */

migrate((app) => {
  const collection = app.findCollectionByNameOrId("sync_runs")
  collection.fields.add(new Field({
    type: "number",
    name: "aid_ledger_warnings_count",
    required: false,
    presentable: false,
    min: 0,
    max: null,
    onlyInt: true
  }))
  app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("sync_runs")
  collection.fields.removeByName("aid_ledger_warnings_count")
  app.save(collection)
})
