# PocketBase Migration Patterns (v0.23.0+) — READ THIS FIRST

> **MANDATORY**: Before writing ANY PocketBase migration, you MUST review this section. PocketBase v0.23+ changed how field properties are defined. The old `options: {}` wrapper pattern is silently ignored — the field uses PB's DEFAULT cap (5000 chars for text, 1 MB for json) instead of your declared value. PB then REJECTS over-cap writes with a validation error (it does NOT truncate), so the live schema silently diverges from what the migration says — a hard-to-diagnose integrity bug.

## Field Type Reference (v0.23+ Syntax)

**CRITICAL**: Most field types require properties as DIRECT fields, NOT inside `options: {}`.

| Field Type | Properties | Correct Syntax |
|------------|------------|----------------|
| `text` | `min`, `max`, `pattern` | `{ type: "text", name: "x", min: 0, max: 100000, pattern: "" }` |
| `number` | `min`, `max`, `onlyInt` | `{ type: "number", name: "x", min: 0, max: 100, onlyInt: true }` |
| `select` | `values`, `maxSelect` | `{ type: "select", name: "x", values: ["a","b"], maxSelect: 1 }` |
| `relation` | `collectionId`, `cascadeDelete`, `minSelect`, `maxSelect` | `{ type: "relation", name: "x", collectionId: col.id, maxSelect: 1 }` |
| `bool` | (none needed) | `{ type: "bool", name: "x" }` |
| `json` | `maxSize` | `{ type: "json", name: "x", maxSize: 2000000 }` |
| `file` | `maxSelect`, `maxSize`, `mimeTypes`, `thumbs` | `{ type: "file", name: "x", maxSelect: 1, maxSize: 5242880 }` |
| `date` | `min`, `max` | `{ type: "date", name: "x", min: "", max: "" }` |
| `autodate` | `onCreate`, `onUpdate` | `{ type: "autodate", name: "x", onCreate: true, onUpdate: true }` |
| `url` | `exceptDomains`, `onlyDomains` | `{ type: "url", name: "x" }` |
| `email` | `exceptDomains`, `onlyDomains` | `{ type: "email", name: "x" }` |
| `editor` | `maxSize`, `convertUrls` | `{ type: "editor", name: "x", maxSize: 0, convertUrls: false }` |

## WRONG vs CORRECT Examples

```javascript
// ❌ WRONG - options wrapper is IGNORED in v0.23+, field gets DEFAULT 5000 char limit!
{
  type: "text",
  name: "value",
  options: { min: null, max: 100000, pattern: "" }  // IGNORED!
}

// ✅ CORRECT - direct properties are applied
{
  type: "text",
  name: "value",
  min: 0,
  max: 100000,
  pattern: ""
}
```

```javascript
// ❌ WRONG - select values in options wrapper
{
  type: "select",
  name: "status",
  options: { values: ["active", "inactive"], maxSelect: 1 }  // IGNORED!
}

// ✅ CORRECT - direct properties
{
  type: "select",
  name: "status",
  values: ["active", "inactive"],
  maxSelect: 1
}
```

## Creating New Collections

Use dynamic collection lookups for relation fields - never hardcode collection IDs:

```javascript
migrate((app) => {
  // Dynamic lookups for relations
  const personsCol = app.findCollectionByNameOrId("persons")

  const collection = new Collection({
    name: "my_collection",
    type: "base",
    listRule: '@request.auth.id != ""',
    // ... other rules
    fields: [
      // Relation field - all properties DIRECT, not in options
      {
        type: "relation",
        name: "person",
        required: true,
        presentable: false,
        collectionId: personsCol.id,  // Dynamic lookup
        cascadeDelete: false,
        minSelect: null,
        maxSelect: 1
      },
      // Select field - values/maxSelect are DIRECT properties
      {
        type: "select",
        name: "status",
        required: true,
        values: ["active", "inactive"],
        maxSelect: 1
      },
      // Text field - min/max/pattern are DIRECT properties
      {
        type: "text",
        name: "name",
        required: true,
        min: 0,
        max: 200,
        pattern: ""
      },
      // Number field - min/max/onlyInt are DIRECT properties
      {
        type: "number",
        name: "year",
        required: true,
        min: 2010,
        max: 2100,
        onlyInt: true
      },
      // JSON field - maxSize is DIRECT property
      {
        type: "json",
        name: "metadata",
        required: false,
        maxSize: 2000000
      }
    ],
    indexes: [...]
  });

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("my_collection");
  app.delete(collection);
});
```

## Adding Fields to Existing Collections

Use `new Field()` constructor and `fields.add()` - plain objects don't work:

```javascript
migrate((app) => {
  const collection = app.findCollectionByNameOrId("existing_collection");

  // CORRECT: Use new Field() constructor with DIRECT properties
  collection.fields.add(new Field({
    type: "text",
    name: "description",
    required: false,
    presentable: false,
    min: 0,
    max: 50000,
    pattern: ""
  }));

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("existing_collection");
  collection.fields.removeByName("description");
  app.save(collection);
});
```

## Common Mistakes to Avoid

| Wrong | Right | Consequence of Wrong |
|-------|-------|---------------------|
| `options: { min: 0, max: 100000 }` for text | `min: 0, max: 100000` (direct) | Silent 5000-char default cap; over-cap writes rejected (declared limit never applied) |
| `options: { values: [...] }` for select | `values: [...]` (direct) | Empty enum, validation fails |
| `collectionId` inside `options: {}` | `collectionId` as direct property | Relation breaks |
| `collection.fields.push({...})` | `collection.fields.add(new Field({...}))` | Field not added |
| Hardcoded collection IDs | `app.findCollectionByNameOrId("name").id` | Breaks on fresh DB |
| `for...of` on fields | Index-based `for` loop | "object is not iterable" error |
| `return app.save()` | `app.save()` (no return needed) | May cause issues |
| `min: null, max: null` for text | `min: 0, max: 0` (0 → PB default 5000-char cap, NOT unlimited) | N/A — both normalize to the 5000 default for text |
| `min: 0, max: 0` for number | `min: null, max: null` (null = no limit for number) | `max: 0` enforced as literal maximum of 0, rejects all positive values |

## Migration Checklist

Before committing any migration:

- [ ] **No `options: {}` wrappers** for text, number, select, relation, json, file fields
- [ ] **All field properties are direct** (min, max, values, collectionId, etc.)
- [ ] **Dynamic collection lookups** using `app.findCollectionByNameOrId()`
- [ ] **`go build .`** passes in pocketbase/
- [ ] **Fresh DB test** - delete pb_data/ and verify schema creates correctly
- [ ] **Seed script updated** — if adding/removing a collection, verify `scripts/setup/seed_from_prod.py` handles it (auto-discovered, but check skip lists)

**Enum update workaround**: If migration applies but enum values unchanged, use `scripts/fix_request_type_enum.py` to update schema JSON directly.

**Schema iteration**: Use index-based `for` loops, NOT `for...of` (causes "object is not iterable").

## Migration Consolidation

When `pb_migrations/` accumulates many modify-migrations for the same table, run the `consolidate-migrations` skill (tracked in this repo at `.claude/skills/consolidate-migrations/`) to fold them into the table's original CREATE migration. Each round is empirically verified by spinning up two scratch DBs (one with the proposed merged set, one with the current set) and diffing their `_collections` schemas — the merge is rejected if it would change the table's shape.

Skill artifacts:
- Tracking doc (gitignored): `docs/plans/migration-consolidation.md` — backlog, per-round history, multi-table cross-cutting findings
- Verification harness: `scripts/dev/verify-consolidation.sh` (orchestrator), `scripts/dev/migration-schema-diff.sh` (canonical schema dump + diff)
- Spec: `docs/superpowers/specs/2026-05-08-migration-consolidation-design.md`

Cleanup mechanism: PB v0.23 has a built-in `migrate history-sync` subcommand (`RemoveMissingAppliedMigrations` in `core/migrations_runner.go`) that DELETEs every `_migrations` row whose file is no longer on disk. `pocketbase/main.go` registers an `OnServe` hook that calls this on every server boot, so prod's `_migrations` self-heals after each consolidation merge. Idempotent — no-op on clean DBs.

Numbering: gaps may appear in `pb_migrations/` numbering after consolidation. Per CLAUDE.md "PocketBase Migration Numbering Rule", new migrations must use a number greater than the highest existing filename on `origin/main` — never fill consolidation gaps.
