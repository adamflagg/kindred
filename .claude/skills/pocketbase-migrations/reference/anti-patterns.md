# Anti-Patterns: WRONG vs CORRECT

Real failures from this project. Each "WRONG" example either compiled fine and silently broke, or caused a confusing runtime error.

---

## 1. The `options: {}` Wrapper (Silent Data Truncation)

**Severity: CRITICAL** — No error, no warning. Data silently truncated.

```javascript
// WRONG — options wrapper is IGNORED in v0.23+
// Field gets DEFAULT 5000 char limit even though you specified 100000
{
  type: "text",
  name: "value",
  options: { min: null, max: 100000, pattern: "" }
}

// CORRECT — properties applied as expected
{
  type: "text",
  name: "value",
  min: 0,
  max: 100000,
  pattern: ""
}
```

```javascript
// WRONG — select values inside options, field gets empty enum
{
  type: "select",
  name: "status",
  options: { values: ["active", "inactive"], maxSelect: 1 }
}

// CORRECT
{
  type: "select",
  name: "status",
  values: ["active", "inactive"],
  maxSelect: 1
}
```

```javascript
// WRONG — relation config inside options, relation breaks
{
  type: "relation",
  name: "person",
  options: { collectionId: personsCol.id, maxSelect: 1 }
}

// CORRECT
{
  type: "relation",
  name: "person",
  collectionId: personsCol.id,
  cascadeDelete: false,
  minSelect: null,
  maxSelect: 1
}
```

**Why it happens**: PocketBase pre-v0.23 used `options: {}`. Many AI models and documentation still show the old syntax. PocketBase v0.23+ silently ignores the `options` key.

---

## 2. `fields.push()` Instead of `fields.add(new Field(...))`

**Severity: HIGH** — Field silently not added.

```javascript
// WRONG — push does nothing on PocketBase field collections
collection.fields.push({
  type: "text",
  name: "description",
  min: 0,
  max: 50000,
  pattern: ""
});

// CORRECT — use add() with new Field()
collection.fields.add(new Field({
  type: "text",
  name: "description",
  min: 0,
  max: 50000,
  pattern: ""
}));
```

**Why it happens**: PocketBase fields look like an array but are a custom collection type.

---

## 3. `for...of` on Field Collections

**Severity: HIGH** — Runtime error: "object is not iterable"

```javascript
// WRONG — fields is not a JS iterable
for (const field of collection.fields) {
  if (field.name === "target") { ... }
}

// CORRECT — index-based loop
for (let i = 0; i < collection.fields.length; i++) {
  const field = collection.fields.getByIndex(i);
  if (field.name === "target") { ... }
}

// ALSO CORRECT — find by name directly
const field = collection.fields.getByName("target");
```

---

## 4. Number Field `max: 0` Means "Maximum of Zero"

**Severity: MEDIUM** — All positive values rejected.

```javascript
// WRONG — rejects any value > 0
{
  type: "number",
  name: "count",
  min: 0,
  max: 0,     // means "maximum value is 0"
  onlyInt: true
}

// CORRECT — null means no upper bound
{
  type: "number",
  name: "count",
  min: null,
  max: null,
  onlyInt: true
}

// ALSO CORRECT — explicit bounded range
{
  type: "number",
  name: "year",
  min: 2010,
  max: 2100,
  onlyInt: true
}
```

**Contrast with text**: For text fields, `max: 0` means "unlimited length" (safe). The inconsistency is the trap.

---

## 5. `return app.save()`

**Severity: LOW** — May cause subtle issues with migration sequencing.

```javascript
// AVOID
migrate((app) => {
  const col = app.findCollectionByNameOrId("my_collection");
  col.listRule = '@request.auth.id != ""';
  return app.save(col);  // unnecessary return
}, ...);

// CORRECT
migrate((app) => {
  const col = app.findCollectionByNameOrId("my_collection");
  col.listRule = '@request.auth.id != ""';
  app.save(col);
}, ...);
```

---

## 6. Hardcoded Collection IDs

**Severity: HIGH** — Works on your database, breaks on fresh DB or other environments.

```javascript
// WRONG — ID only exists in your specific database
{
  type: "relation",
  name: "person",
  collectionId: "abc123xyz",
  maxSelect: 1
}

// CORRECT — dynamic lookup
const personsCol = app.findCollectionByNameOrId("persons");
// then in the field definition:
{
  type: "relation",
  name: "person",
  collectionId: personsCol.id,
  maxSelect: 1
}
```

---

## 7. Missing Types Reference Comment

**Severity: LOW** — Lose TypeScript intellisense in editors.

```javascript
// WRONG — missing reference
migrate((app) => { ... });

// CORRECT — first line of every migration file
/// <reference path="../pb_data/types.d.ts" />
migrate((app) => { ... });
```

---

## 8. Missing Down Migration

**Severity: MEDIUM** — Cannot roll back if something goes wrong.

```javascript
// WRONG — no reverse migration
migrate((app) => {
  const col = app.findCollectionByNameOrId("persons");
  col.fields.add(new Field({ type: "text", name: "nickname", min: 0, max: 100, pattern: "" }));
  app.save(col);
});

// CORRECT — includes reverse
migrate((app) => {
  const col = app.findCollectionByNameOrId("persons");
  col.fields.add(new Field({ type: "text", name: "nickname", min: 0, max: 100, pattern: "" }));
  app.save(col);
}, (app) => {
  const col = app.findCollectionByNameOrId("persons");
  col.fields.removeByName("nickname");
  app.save(col);
});
```

---

## 9. Filter Syntax Without Spaces

**Severity: MEDIUM** — PocketBase silently evaluates the rule incorrectly or rejects it.

```javascript
// WRONG
col.listRule = '@request.auth.id!=""'

// CORRECT
col.listRule = '@request.auth.id != ""'
```

---

## 10. Forgetting `app.save()` After Multiple Collection Changes

**Severity: HIGH** — Changes to the first collection lost when you modify the second.

```javascript
// WRONG — first collection's changes may not persist
const col1 = app.findCollectionByNameOrId("persons");
col1.fields.add(new Field({ type: "text", name: "foo", min: 0, max: 100, pattern: "" }));

const col2 = app.findCollectionByNameOrId("attendees");
col2.fields.add(new Field({ type: "text", name: "bar", min: 0, max: 100, pattern: "" }));

app.save(col1);  // Too late? Depends on PB internals.
app.save(col2);

// CORRECT — save each collection immediately after its changes
const col1 = app.findCollectionByNameOrId("persons");
col1.fields.add(new Field({ type: "text", name: "foo", min: 0, max: 100, pattern: "" }));
app.save(col1);

const col2 = app.findCollectionByNameOrId("attendees");
col2.fields.add(new Field({ type: "text", name: "bar", min: 0, max: 100, pattern: "" }));
app.save(col2);
```
