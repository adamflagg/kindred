/// <reference path="../pb_data/types.d.ts" />
/**
 * Migration: Add new fields to camp_sessions for complete CampMinder sync
 * Dependencies: 1500000001_camp_sessions.js
 *
 * Adds 13 new fields to capture all available CampMinder session data:
 * - description: Session description text
 * - is_active: Whether session is active
 * - sort_order: Display ordering
 * - group_id: Reference to session group (CampMinder ID)
 * - is_day: Whether this is a day session
 * - is_residential: Whether this is a residential session
 * - is_for_children: Whether session is for children
 * - is_for_adults: Whether session is for adults
 * - start_age: Minimum age for session
 * - end_age: Maximum age for session
 * - start_grade_id: Minimum grade ID
 * - end_grade_id: Maximum grade ID
 * - gender_id: Gender restriction ID
 */

migrate((app) => {
  const collection = app.findCollectionByNameOrId("camp_sessions");

  // Add description field
  collection.fields.add(new Field({
    type: "text",
    name: "description",
    required: false,
    presentable: false,
    system: false,
    options: {
      min: null,
      max: null,
      pattern: ""
    }
  }));

  // Add is_active field
  collection.fields.add(new Field({
    type: "bool",
    name: "is_active",
    required: false,
    presentable: false,
    system: false
  }));

  // Add sort_order field
  collection.fields.add(new Field({
    type: "number",
    name: "sort_order",
    required: false,
    presentable: false,
    system: false,
    options: {
      min: null,
      max: null,
      noDecimal: true
    }
  }));

  // Add group_id field (CampMinder group ID, not PocketBase relation)
  collection.fields.add(new Field({
    type: "number",
    name: "group_id",
    required: false,
    presentable: false,
    system: false,
    options: {
      min: null,
      max: null,
      noDecimal: true
    }
  }));

  // Add is_day field
  collection.fields.add(new Field({
    type: "bool",
    name: "is_day",
    required: false,
    presentable: false,
    system: false
  }));

  // Add is_residential field
  collection.fields.add(new Field({
    type: "bool",
    name: "is_residential",
    required: false,
    presentable: false,
    system: false
  }));

  // Add is_for_children field
  collection.fields.add(new Field({
    type: "bool",
    name: "is_for_children",
    required: false,
    presentable: false,
    system: false
  }));

  // Add is_for_adults field
  collection.fields.add(new Field({
    type: "bool",
    name: "is_for_adults",
    required: false,
    presentable: false,
    system: false
  }));

  // Add start_age field
  collection.fields.add(new Field({
    type: "number",
    name: "start_age",
    required: false,
    presentable: false,
    system: false,
    options: {
      min: null,
      max: null,
      noDecimal: true
    }
  }));

  // Add end_age field
  collection.fields.add(new Field({
    type: "number",
    name: "end_age",
    required: false,
    presentable: false,
    system: false,
    options: {
      min: null,
      max: null,
      noDecimal: true
    }
  }));

  // Add start_grade_id field
  collection.fields.add(new Field({
    type: "number",
    name: "start_grade_id",
    required: false,
    presentable: false,
    system: false,
    options: {
      min: null,
      max: null,
      noDecimal: true
    }
  }));

  // Add end_grade_id field
  collection.fields.add(new Field({
    type: "number",
    name: "end_grade_id",
    required: false,
    presentable: false,
    system: false,
    options: {
      min: null,
      max: null,
      noDecimal: true
    }
  }));

  // Add gender_id field
  collection.fields.add(new Field({
    type: "number",
    name: "gender_id",
    required: false,
    presentable: false,
    system: false,
    options: {
      min: null,
      max: null,
      noDecimal: true
    }
  }));

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("camp_sessions");

  // Remove fields in reverse order
  collection.fields.removeByName("gender_id");
  collection.fields.removeByName("end_grade_id");
  collection.fields.removeByName("start_grade_id");
  collection.fields.removeByName("end_age");
  collection.fields.removeByName("start_age");
  collection.fields.removeByName("is_for_adults");
  collection.fields.removeByName("is_for_children");
  collection.fields.removeByName("is_residential");
  collection.fields.removeByName("is_day");
  collection.fields.removeByName("group_id");
  collection.fields.removeByName("sort_order");
  collection.fields.removeByName("is_active");
  collection.fields.removeByName("description");

  app.save(collection);
});
