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

## Error Handling in Data Migrations

Data migrations that check "does this row already exist?" wrap the lookup in a
`try/catch` because `findFirstRecordByFilter` **throws** on the expected no-match
path (`sql: no rows in result set`) — it does not return null. The convention is
to **catch only the lookup, and keep the mutating op (`save`/`delete`) outside the
catch** so a genuine DB error surfaces instead of being reinterpreted as "not
found":

```js
// CORRECT — catch scopes the lookup only; the mutation is outside it
let record
try {
  record = app.findFirstRecordByFilter("config", `config_key = "${key}"`)
} catch {
  // already gone — findFirstRecordByFilter throws on no match
}
if (record) app.delete(record)   // real delete errors (FK, perms) still surface
```

For the seed/ensure-exists shape, the same rule applies — the `app.save(record)`
that runs after the `if (existing) return` guard hits the same DB one line later,
so a genuine failure is not masked, only deferred by a line:

```js
let existing
try {
  existing = app.findFirstRecordByFilter("config", `config_key = "${key}"`)
} catch {
  existing = null
}
if (existing) return
// ...build record...
app.save(record)   // surfaces a real DB error here
```

**Why not a narrow `isNotFoundError(err)` helper?** PocketBase's JSVM throws a
plain Go error *string*, not a structured error with `.status === 404`, so
narrowing means brittle substring matching on an internal message. Combined with
the fact that migration filters are static string literals (a malformed filter
fails deterministically on the first apply everywhere, including CI) and that the
mutating op surfaces real errors one line later, the broad catch is acceptable.
`pb_migrations/` files are also evaluated in isolation with no shared-import
mechanism, so a "shared helper" would be duplicated into every file. Decision
recorded in #1731 (Formalize the existing convention; do not retrofit).

**Do not** put the mutation *inside* the catch — that swallows FK/permission/
runtime errors on the write itself, which are real failures you want to see.

### When the broad catch stops being safe: a loop guarded by `continue`

**The ruling above holds for the shape it was written for.** Every example in
this section pairs the catch with a mutating call that runs immediately after
it — `app.delete()`, `app.save()` — so a real DB failure (not just "no rows")
still surfaces, just one line later than the lookup that hid it. That is the
"mutating op surfaces real errors one line later" argument from #1731, and it
is correct for that shape.

It does not hold when the catch's failure path is `continue` inside a loop
rather than an adjacent mutating call. Nothing runs after a `continue` for
that iteration — a broadly-caught real error (a corrupted index, the DB gone
away) is indistinguishable from "this row legitimately doesn't exist yet,"
and the loop moves on as if the lookup had succeeded.
`recomputeCachedPermissions` in
`pocketbase/pb_migrations/1500000154_drop_lodging_phi_permission.js` (#2323)
is this shape: each iteration looks up a role or a user by id inside a loop,
and a broad catch there would let a real failure silently write a
too-small `cached_permissions` blob instead of aborting.

`1500000135_lodging_availability_no_scenario.js` (#2001, merged 2026-08-04 —
four weeks after #1731 closed) hit the same problem from the other
direction: its `refuseIfPopulated` guard treats an unreadable table as
grounds to proceed with a destructive column drop unless the failure is
narrowed first, so a broad catch there would turn "the DB is unreachable"
into "the table is empty, go ahead." Both migrations independently landed on
a narrow check against the literal substring `"no rows in result set"`, with
everything else propagated as a thrown error (`1500000135` wraps it with
`{ cause: err }` for context; `1500000154` rethrows it directly via a shared
`isNotFoundError(err)` helper local to that file) so the migration — and the
boot it runs during — aborts instead of continuing on a false "not found."

**Current guidance:** keep the broad catch for the immediate
lookup-then-mutate shape above — do not retrofit it there, per #1731. For a
catch whose failure path is `continue`, or anything else that is not an
adjacent mutating call, narrow it with an `isNotFoundError(err)` check on
`"no rows in result set"` and re-throw everything else. The "no
shared-import mechanism between `pb_migrations/` files" reason from #1731
still applies — each migration defines its own copy of the helper rather
than importing one, same as `1500000135` and `1500000154` both do.

One asymmetry worth flagging rather than fixing here: `1500000154`'s
`findRoleBySlug` re-throws a non-not-found error (fails closed — aborts the
migration), while the `1500000130` helper it mirrors swallowed every error
unconditionally and returned `null` (failed safe — the rule change proceeds
even if the role lookup broke for an unrelated reason). The narrower
behavior is the one to write going forward; `1500000130` is not being
revisited for it.

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

## Renumbering a migration you have already applied locally

The numbering rule tells you to bump above HEAD when a competing PR takes your number. Do that **before you first boot the branch.** If you renumber a migration your dev database has already applied, that database is now broken in a way nothing else in this repo will catch — and `scripts/dev/verify-migration-history.sh` exists because of it (kindred#2245).

### The mechanism

`_migrations` keys on the **exact filename**. PocketBase's `isMigrationApplied` (`core/migrations_runner.go:265-275`) is a `WHERE file = ?` lookup, so `1500000146_foo.js` is unapplied no matter what row `1500000144_foo.js` has. Renaming an applied migration makes PB see a brand new one:

- an **ALTER** migration silently re-runs
- a **CREATE** migration fails the boot with `Collection name must be unique (case insensitive)` — an error naming neither the file nor the cause

**history-sync is not what breaks this, and believing it is will send you to the wrong place.** `apis.Serve` runs `RunAllMigrations()` and returns on error at `apis/serve.go:66-70`, before the router is built and before `OnServe` fires — so on a *failing* boot, history-sync never runs at all. What it does is erase the evidence on every *successful* boot: `RemoveMissingAppliedMigrations` is `DELETE FROM _migrations WHERE file NOT IN (on-disk names)`, so any boot taken while the renamed file is absent from your branch removes the old row. Afterwards `_migrations` looks perfectly clean and the only remaining signal is that a collection exists which no applied migration created.

There is a second, quieter half. If the file's **content** also changed after you applied it — a stripped field, a changed rule — that edit never reaches your database either, for the same filename-keyed reason. You end up with a schema that exists in no other database and in no version of the file on `main`. The fresh-DB verifiers (`verify-consolidation.sh`, `verify-lodging-schema.sh`) run against empty throwaway databases and cannot observe it.

### Recovery

**Work out which case you are in first. Do not skip this — the two fixes are different, and the obvious one destroys data.**

```bash
# Find the old name and diff it against the new file
git log --all --diff-filter=A --oneline -- 'pocketbase/pb_migrations/*_<slug>.js'
git show <old-sha>:pocketbase/pb_migrations/<OLD>_<slug>.js \
  | diff - pocketbase/pb_migrations/<NEW>_<slug>.js
```

**Case 1 — content identical (a pure renumber).** Your database already holds exactly what the new file creates. Record the new name as applied; nothing needs to run:

```bash
sqlite3 pocketbase/pb_data/data.db \
  "INSERT OR IGNORE INTO _migrations (file, applied)
   VALUES ('<NEW>_<slug>.js', strftime('%s','now')*1000000);"
```

**Case 2 — content differs.** Your database carries a schema that exists nowhere else, and only a re-apply converges it. **What you do next depends on whether the migration CREATEs or ALTERs, and getting that backwards destroys data.**

**Case 2a — the migration CREATEs the collections.** These are the ones that fail the boot outright. **Count rows before you drop anything:**

```bash
sqlite3 'file:pocketbase/pb_data/data.db?mode=ro' 'SELECT count(*) FROM <collection>;'
```

- **All zero** → drop the collections **that this migration creates**, then boot normally.
- **Any non-zero** → **do not drop.** Export first, or reseed the dev database from a prod snapshot. "Drop the collection and re-run" is the recipe that works on an empty table and silently destroys a populated one.

**Case 2b — the migration ALTERs an existing collection.** ⛔ **Do not drop anything.** The collection it targets was created by a *different, earlier* migration that is still recorded as applied — so dropping it destroys that migration's work and a normal boot will **not** recreate it, because PocketBase already believes it ran.

An ALTER in this state has silently re-run rather than failed, so the damage is usually nil: the convention here is idempotent `fields.add()`, which converges toward whatever the file declares. Verify rather than assume — compare the live column set against the file:

```bash
sqlite3 'file:pocketbase/pb_data/data.db?mode=ro' \
  "SELECT fields FROM _collections WHERE name='<collection>';" | python3 -m json.tool | grep '"name"'
```

If it matches the migration's declaration, record the new filename as applied per Case 1 and move on. If it does not — the usual cause is a field the file *removed*, which no re-run can undo — hand-drop that field, or reseed the dev database. There is no automatic recovery for a removal.

**Re-apply by booting the server** (`./scripts/start_dev.sh`) rather than by hand. Migrations run from `apis.Serve` at `apis/serve.go:66-70`, so a normal boot applies them.

> ⚠️ **Do not pass `--migrationsDir` to `pocketbase migrate up`.** `main.go:203-209` hands `migrationsDir` to `jsvm.MustRegister` while it still holds its `""` default — cobra does not parse argv until `app.Start()` runs, much later. An explicitly-passed directory is therefore ignored and **JS migrations are silently skipped**, which reads as "nothing to apply". The unflagged default resolves correctly; leave it alone.

### Why an idempotent CREATE is the wrong fix

The tempting fix is a skip-if-exists guard on the `CREATE`. It is worse than the failure it prevents. The boot would succeed, `_migrations` would record the migration as applied, and a divergent schema would stay in place permanently with nothing left to reveal it. Prod and CI apply from scratch and would never show the difference.

Note the asymmetry, because it does not condemn idempotency in general: an idempotent `fields.add()` on an ALTER **converges** toward the file's declaration — it adds what is missing. A skip-if-exists CREATE **diverges** — it accepts whatever shape is already there. Keep the former; it is the documented convention. Reject the latter.
