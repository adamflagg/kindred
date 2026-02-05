/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Add discrete billing address fields to households
 *
 * Adds queryable columns for billing address data that was previously stored in JSON:
 * - billing_address1, billing_address2: Street address lines
 * - billing_city, billing_state: City and state/province
 * - billing_postal_code: ZIP/postal code
 * - billing_country: Country code (defaults to "US")
 *
 * Strategy: New columns populated alongside existing billing_address JSON for
 * backward compatibility. JSON field will be removed in a future migration.
 */

migrate((app) => {
  const collection = app.findCollectionByNameOrId("households");

  // Add billing_address1 field
  collection.fields.add(new Field({
    type: "text",
    name: "billing_address1",
    required: false,
    presentable: false,
    min: 0,
    max: 500,
    pattern: ""
  }));

  // Add billing_address2 field (optional second line)
  collection.fields.add(new Field({
    type: "text",
    name: "billing_address2",
    required: false,
    presentable: false,
    min: 0,
    max: 500,
    pattern: ""
  }));

  // Add billing_city field
  collection.fields.add(new Field({
    type: "text",
    name: "billing_city",
    required: false,
    presentable: false,
    min: 0,
    max: 200,
    pattern: ""
  }));

  // Add billing_state field
  collection.fields.add(new Field({
    type: "text",
    name: "billing_state",
    required: false,
    presentable: false,
    min: 0,
    max: 50,
    pattern: ""
  }));

  // Add billing_postal_code field
  collection.fields.add(new Field({
    type: "text",
    name: "billing_postal_code",
    required: false,
    presentable: false,
    min: 0,
    max: 20,
    pattern: ""
  }));

  // Add billing_country field (default: US)
  collection.fields.add(new Field({
    type: "text",
    name: "billing_country",
    required: false,
    presentable: false,
    min: 0,
    max: 10,
    pattern: ""
  }));

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("households");

  // Remove new fields in reverse order
  collection.fields.removeByName("billing_country");
  collection.fields.removeByName("billing_postal_code");
  collection.fields.removeByName("billing_state");
  collection.fields.removeByName("billing_city");
  collection.fields.removeByName("billing_address2");
  collection.fields.removeByName("billing_address1");

  app.save(collection);
});
