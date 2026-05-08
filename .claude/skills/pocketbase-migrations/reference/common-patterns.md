# Common Migration Patterns

## Pattern 1: Create a New Collection

```javascript
/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  // Dynamic lookups for relation targets
  const personsCol = app.findCollectionByNameOrId("persons");

  const collection = new Collection({
    type: "base",
    name: "my_collection",
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.id != ""',
    fields: [
      // Fields go here — see field-types.md for each type
    ],
    indexes: [
      "CREATE INDEX `idx_my_collection_year` ON `my_collection` (`year`)",
      "CREATE UNIQUE INDEX `idx_my_collection_uniq` ON `my_collection` (`field_a`, `field_b`) WHERE `field_a` != ''"
    ]
  });

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("my_collection");
  app.delete(collection);
});
```

**Notes:**
- Collection type is usually `"base"`. Auth collections use `"auth"`.
- Rules: `null` = admin-only, `""` = public, `'@request.auth.id != ""'` = any authenticated user.
- Indexes use backtick-quoted names and table/column identifiers.
- Conditional unique indexes use `WHERE` clause.

## Pattern 2: Add Fields to Existing Collection

```javascript
/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const collection = app.findCollectionByNameOrId("persons");

  collection.fields.add(new Field({
    type: "text",
    name: "address_city",
    required: false,
    presentable: false,
    min: 0,
    max: 200,
    pattern: ""
  }));

  collection.fields.add(new Field({
    type: "email",
    name: "primary_email",
    required: false,
    presentable: false,
    exceptDomains: [],
    onlyDomains: []
  }));

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("persons");
  collection.fields.removeByName("address_city");
  collection.fields.removeByName("primary_email");
  app.save(collection);
});
```

**Notes:**
- `fields.add()` with matching `name` on an existing field **updates** it (upsert behavior).
- This is how you change field limits — add the same field with new properties.
- Remove fields with `collection.fields.removeByName("field_name")`.
- Call `app.save(collection)` once after all field changes to the same collection.

## Pattern 3: Modify Field Limits

Same as adding a field — `fields.add()` upserts by name. The down function restores original limits.

```javascript
/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const collection = app.findCollectionByNameOrId("camper_history");

  // synagogue: 200 -> 400
  collection.fields.add(new Field({
    type: "text",
    name: "synagogue",
    required: false,
    presentable: false,
    min: 0,
    max: 400,
    pattern: ""
  }));

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("camper_history");

  // Restore: synagogue: 400 -> 200
  collection.fields.add(new Field({
    type: "text",
    name: "synagogue",
    required: false,
    presentable: false,
    min: 0,
    max: 200,
    pattern: ""
  }));

  app.save(collection);
});
```

**Notes:**
- You can update multiple fields across multiple collections in one migration.
- Call `app.save()` after each collection's changes (not batched across collections).

## Pattern 4: Raw SQL Data Migration

For transforming existing data without schema changes.

```javascript
/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const mappings = {
    "Old Value": "new_value",
    "Another Old": "another_new",
  };

  for (const [oldVal, newVal] of Object.entries(mappings)) {
    app.db()
      .newQuery(
        `UPDATE my_table SET my_field = {:new} WHERE my_field = {:old}`
      )
      .bind({ new: newVal, old: oldVal })
      .execute();
  }
}, (app) => {
  // Reverse the mapping
  const mappings = {
    "new_value": "Old Value",
    "another_new": "Another Old",
  };

  for (const [oldVal, newVal] of Object.entries(mappings)) {
    app.db()
      .newQuery(
        `UPDATE my_table SET my_field = {:new} WHERE my_field = {:old}`
      )
      .bind({ new: newVal, old: oldVal })
      .execute();
  }
});
```

**Notes:**
- Use parameterized queries with `.bind()` — never string interpolation.
- `{:paramName}` is PocketBase's bind syntax (not `?` or `$1`).
- `Object.entries()` iteration is fine for plain JS objects (unlike PocketBase field collections).
- For JSON columns, use `REPLACE()` and `LIKE` for pattern matching.

## Pattern 5: Modify Collection Rules (RBAC)

```javascript
/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const adminOnly = '@request.auth.is_admin = true';
  const anyRole = '@request.auth.is_admin = true || @request.auth.cached_permissions ~ "bunking.view"';

  const col = app.findCollectionByNameOrId("bunk_assignments");
  col.listRule = anyRole;
  col.viewRule = anyRole;
  col.createRule = adminOnly;
  col.updateRule = adminOnly;
  col.deleteRule = adminOnly;
  app.save(col);
}, (app) => {
  const authed = '@request.auth.id != ""';

  const col = app.findCollectionByNameOrId("bunk_assignments");
  col.listRule = authed;
  col.viewRule = authed;
  col.createRule = authed;
  col.updateRule = authed;
  col.deleteRule = authed;
  app.save(col);
});
```

**Notes:**
- Rules are strings assigned directly to collection properties.
- The `~` operator checks if a JSON array contains a value.
- Spaces around operators are required (`=`, `!=`, `~`).
- `null` rule = superadmin only. `""` = public access. String = evaluated per request.

## Pattern 6: Add Indexes

Indexes are part of the collection and set via the `indexes` array.

```javascript
/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const collection = app.findCollectionByNameOrId("my_collection");

  // Append to existing indexes
  collection.indexes.push(
    "CREATE INDEX `idx_my_collection_year` ON `my_collection` (`year`)"
  );

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("my_collection");

  // Remove the index by filtering it out
  collection.indexes = collection.indexes.filter(
    idx => !idx.includes("idx_my_collection_year")
  );

  app.save(collection);
});
```

**Index types:**
- `CREATE INDEX` — standard index
- `CREATE UNIQUE INDEX` — unique constraint
- `CREATE INDEX ... WHERE condition` — partial/conditional index
