---
name: pocketbase-migrations
description: Use when creating, modifying, or debugging PocketBase migrations (pb_migrations/*.js), adding/removing collection fields, or changing schema. Triggers on any schema change work.
---

# PocketBase Migration Skill (v0.23+)

`docs/reference/pocketbase-migrations.md` is the canonical reference and is mandatory reading per
`pocketbase/CLAUDE.md`. The gotchas below are the working copy kept next to the templates — if you
correct one, correct the doc too, or they drift.

## Workflow

1. **Pick the number from `origin/main`, not from your local tree.** A sibling PR may already have
   merged the number your working copy thinks is free, and the collision is only found at boot.

   ```bash
   HIGHEST=$(git ls-tree -r origin/main pocketbase/pb_migrations/ \
     | awk '{print $4}' | grep -oE '15000[0-9]{5}' | sort -u | tail -1)
   NEXT=$((HIGHEST + 1))
   ```

   Do not backfill gaps left by consolidation — those numbers are burned deliberately. And
   **renumber before you first boot the branch**: `_migrations` keys on the exact filename, so
   renaming a migration your dev DB already applied makes PocketBase treat it as brand new. Full
   rule and recovery: `pocketbase/CLAUDE.md` § "Numbering rule".
2. **Read reference files** below as needed for field syntax and patterns.
3. **Pick a template** from `templates/` that matches your task. Compose from it — don't generate from scratch.
4. **Write the migration** with both `up` and `down` functions.
5. **Run the checklist** in `checklist.md` before committing.

## Reference Files (read on demand)

| File | When to read |
|------|-------------|
| `reference/field-types.md` | Need exact property names for a field type |
| `reference/common-patterns.md` | Creating collections, adding fields, data migrations, rules, indexes |
| `reference/anti-patterns.md` | Debugging a migration that silently fails or behaves wrong |
| `checklist.md` | Before committing any migration |

## GOTCHAS — Read These First

These are real failures from this project. Every one caused bugs that were hard to diagnose.

### 1. `options: {}` wrapper is SILENTLY IGNORED (v0.23+)
The single most dangerous mistake. Properties inside `options: {}` are ignored without error. The field gets PocketBase defaults (e.g., 5000 char limit for text) even though your code looks correct.
```javascript
// WRONG — options wrapper silently ignored, field gets 5000 char default
{ type: "text", name: "notes", options: { min: 0, max: 100000 } }

// CORRECT — direct properties are applied
{ type: "text", name: "notes", min: 0, max: 100000, pattern: "" }
```

### 2. `collection.fields.push()` does nothing
PocketBase fields are not a plain array. You must use the `add()` method with `new Field()`.
```javascript
// WRONG — silently does nothing
collection.fields.push({ type: "text", name: "foo", min: 0, max: 200 })

// CORRECT
collection.fields.add(new Field({ type: "text", name: "foo", min: 0, max: 200, pattern: "" }))
```

### 3. `for...of` on fields causes "object is not iterable"
PocketBase field collections are not JS iterables. Use index-based loops.
```javascript
// WRONG — runtime error
for (const field of collection.fields) { ... }

// CORRECT
for (let i = 0; i < collection.fields.length; i++) {
  const field = collection.fields.getByIndex(i);
}
```

### 4. `min: 0, max: 0` means different things for text vs number
For **text** fields, `max: 0` means "unlimited". For **number** fields, `max: 0` means "maximum value of 0" — rejecting all positive numbers. Use `null` for unbounded number fields.
```javascript
// Text: max: 0 = unlimited (OK)
{ type: "text", name: "notes", min: 0, max: 0, pattern: "" }

// Number: max: 0 = BROKEN, rejects positive values
{ type: "number", name: "count", min: 0, max: 0 }

// Number: null = no limit (CORRECT)
{ type: "number", name: "count", min: null, max: null }
```

### 5. `return app.save()` can cause issues
Just call `app.save(collection)` without `return`.

### 6. Never hardcode collection IDs
Always use `app.findCollectionByNameOrId("name")`. Hardcoded IDs break on fresh databases.

### 7. Every migration file starts with the types reference
```javascript
/// <reference path="../pb_data/types.d.ts" />
```

### 8. Always write a `down` function
The second argument to `migrate()` is the reverse migration. For new collections, delete it. For added fields, remove them. For data migrations, reverse the transform.

### 9. PocketBase filter syntax requires spaces around operators
```javascript
// WRONG
col.listRule = '@request.auth.id!=""'

// CORRECT
col.listRule = '@request.auth.id != ""'
```
