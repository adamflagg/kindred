# PocketBase Migration Verification Checklist

Migrations live in `pocketbase/pb_migrations/*.js`.

## 1. Header Check

Every migration file MUST start with the type reference header:

```javascript
/// <reference path="../pb_data/types.d.ts" />
```

Without this, the IDE and linter cannot resolve PocketBase types.

## 2. No `options: {}` Wrapper Anti-Pattern

**CRITICAL**: PocketBase v0.23+ changed field property syntax. The old `options: {}` wrapper is SILENTLY IGNORED, causing fields to use default values (e.g., 5000 char max for text fields instead of your specified value).

Search your migration for `options:` or `options :`. If found, it is almost certainly wrong.

Correct pattern -- properties are DIRECT on the field object:
```javascript
// CORRECT
{ type: "text", name: "value", min: 0, max: 100000, pattern: "" }

// WRONG -- options wrapper is IGNORED, field gets 5000 char default
{ type: "text", name: "value", options: { min: 0, max: 100000 } }
```

This applies to: text, number, select, relation, json, file, date, url, email, editor fields.

## 3. Dynamic Collection Lookups

Never hardcode collection IDs. Always use:
```javascript
const col = app.findCollectionByNameOrId("collection_name")
// then use col.id for relation fields
```

Hardcoded IDs break on fresh databases where IDs differ.

## 4. Field Addition Pattern

Use `new Field()` constructor with `fields.add()`:
```javascript
collection.fields.add(new Field({
  type: "text",
  name: "description",
  min: 0,
  max: 50000,
}));
```

Do NOT use `collection.fields.push({...})` -- plain objects are not recognized.

## 5. Schema Iteration

Use index-based `for` loops:
```javascript
for (let i = 0; i < collection.fields.length; i++) {
  const field = collection.fields[i];
}
```

Do NOT use `for...of` on fields -- causes "object is not iterable" error.

## 6. Build Verification

```bash
cd pocketbase && go build .
```

Go loads and parses all migration JS files at build time. If a migration has syntax errors, the build fails.

## 7. JS Lint

```bash
cd pocketbase && npm run lint
```

This runs `eslint pb_migrations pb_hooks` with the PocketBase-specific eslint config.

## 8. Number Field Gotcha

For number fields, `min: 0, max: 0` means "maximum value is 0" (rejects all positive numbers). Use `min: null, max: null` for no limits on number fields.

For text fields, `max: 0` means "unlimited". The semantics differ by field type.

## Full Checklist

Before committing any migration:

- [ ] File starts with `/// <reference path="../pb_data/types.d.ts" />`
- [ ] No `options: {}` wrappers -- all field properties are direct
- [ ] Collection lookups use `app.findCollectionByNameOrId()`, no hardcoded IDs
- [ ] Field additions use `new Field()` constructor with `fields.add()`
- [ ] Schema iteration uses index-based loops, not `for...of`
- [ ] `cd pocketbase && go build .` passes
- [ ] `cd pocketbase && npm run lint` passes
- [ ] Number field min/max use `null` for no limit (not `0`)
