/// <reference path="../pb_migrations_types.d.ts" />

// Add last_updated field to person_custom_values and household_custom_values
// for delta sync optimization
migrate(
  (app) => {
    // Add last_updated to person_custom_values
    const personCol = app.findCollectionByNameOrId("person_custom_values");
    personCol.fields.add(
      new Field({
        type: "text",
        name: "last_updated",
        required: false,
        presentable: false,
        system: false,
        options: { min: null, max: null, pattern: "" },
      })
    );
    app.save(personCol);

    // Add last_updated to household_custom_values
    const householdCol = app.findCollectionByNameOrId(
      "household_custom_values"
    );
    householdCol.fields.add(
      new Field({
        type: "text",
        name: "last_updated",
        required: false,
        presentable: false,
        system: false,
        options: { min: null, max: null, pattern: "" },
      })
    );
    app.save(householdCol);
  },
  (app) => {
    // Remove last_updated from person_custom_values
    const personCol = app.findCollectionByNameOrId("person_custom_values");
    personCol.fields.removeByName("last_updated");
    app.save(personCol);

    // Remove last_updated from household_custom_values
    const householdCol = app.findCollectionByNameOrId(
      "household_custom_values"
    );
    householdCol.fields.removeByName("last_updated");
    app.save(householdCol);
  }
);
