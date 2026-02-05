/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Remove deprecated JSON fields from persons and households
 *
 * Phase 3 of JSON field extraction - removes JSON fields that have been replaced
 * by discrete, queryable columns:
 *
 * persons:
 * - address (JSON) -> replaced by address_city, address_state
 * - email_addresses (JSON) -> replaced by primary_email, secondary_email
 *
 * households:
 * - billing_address (JSON) -> replaced by billing_address1/2, billing_city/state/postal_code/country
 *
 * All consumers have been migrated to use the discrete columns.
 */

migrate((app) => {
  // Remove JSON fields from persons
  const persons = app.findCollectionByNameOrId("persons");
  persons.fields.removeByName("address");
  persons.fields.removeByName("email_addresses");
  app.save(persons);

  // Remove JSON field from households
  const households = app.findCollectionByNameOrId("households");
  households.fields.removeByName("billing_address");
  app.save(households);
}, (app) => {
  // Restore address JSON field to persons
  const persons = app.findCollectionByNameOrId("persons");
  persons.fields.add(new Field({
    type: "json",
    name: "address",
    required: false,
    presentable: false,
    maxSize: 0
  }));
  persons.fields.add(new Field({
    type: "json",
    name: "email_addresses",
    required: false,
    presentable: false,
    maxSize: 0
  }));
  app.save(persons);

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
