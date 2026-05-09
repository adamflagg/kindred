/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Remove deprecated JSON fields from households
 *
 * Phase 3 of JSON field extraction - removes JSON fields that have been replaced
 * by discrete, queryable columns:
 *
 * households:
 * - billing_address (JSON) -> replaced by billing_address1/2, billing_city/state/postal_code/country
 *
 * All consumers have been migrated to use the discrete columns.
 *
 * Note: persons portion was absorbed into the merged CREATE migration for
 * `persons` (the `address` and `email_addresses` JSON fields are no longer
 * present at create time).
 */

migrate((app) => {
  // Remove JSON field from households
  const households = app.findCollectionByNameOrId("households");
  households.fields.removeByName("billing_address");
  app.save(households);
}, (app) => {
  // Restore billing_address JSON field to households
  const households = app.findCollectionByNameOrId("households");
  households.fields.add(new Field({
    type: "json",
    name: "billing_address",
    required: false,
    presentable: false,
    maxSize: 0
  }));
  app.save(households);
});
