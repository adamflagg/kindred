/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Add discrete address and email fields to persons, remove phone_numbers
 *
 * Adds queryable columns for address and email data that was previously stored in JSON:
 * - address_city, address_state: Extracted from address JSON
 * - primary_email, secondary_email: Extracted from email_addresses JSON
 * - phone_numbers: REMOVED (unused in application)
 *
 * Strategy: New columns populated alongside existing JSON for backward compatibility.
 * JSON fields will be removed in a future migration after all consumers are migrated.
 */

migrate((app) => {
  const collection = app.findCollectionByNameOrId("persons");

  // Add address_city field
  collection.fields.add(new Field({
    type: "text",
    name: "address_city",
    required: false,
    presentable: false,
    min: 0,
    max: 200,
    pattern: ""
  }));

  // Add address_state field
  collection.fields.add(new Field({
    type: "text",
    name: "address_state",
    required: false,
    presentable: false,
    min: 0,
    max: 50,
    pattern: ""
  }));

  // Add primary_email field (email type for validation)
  collection.fields.add(new Field({
    type: "email",
    name: "primary_email",
    required: false,
    presentable: false,
    exceptDomains: [],
    onlyDomains: []
  }));

  // Add secondary_email field (email type for validation)
  collection.fields.add(new Field({
    type: "email",
    name: "secondary_email",
    required: false,
    presentable: false,
    exceptDomains: [],
    onlyDomains: []
  }));

  // Remove phone_numbers field (unused)
  collection.fields.removeByName("phone_numbers");

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("persons");

  // Restore phone_numbers field
  collection.fields.add(new Field({
    type: "json",
    name: "phone_numbers",
    required: false,
    presentable: false,
    maxSize: 0
  }));

  // Remove new fields
  collection.fields.removeByName("address_city");
  collection.fields.removeByName("address_state");
  collection.fields.removeByName("primary_email");
  collection.fields.removeByName("secondary_email");

  app.save(collection);
});
