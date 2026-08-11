# Migration Pre-Commit Checklist

Run through this before committing any migration file.

## Syntax

- [ ] File starts with `/// <reference path="../pb_data/types.d.ts" />`
- [ ] **No `options: {}` wrappers** anywhere in the file — all field properties are direct
- [ ] All `fields.add()` calls use `new Field({...})`, not plain objects
- [ ] No `fields.push()` — only `fields.add()`
- [ ] No `for...of` on `collection.fields` — use index-based loops or `getByName()`
- [ ] No `return app.save()` — just `app.save()`
- [ ] PocketBase filter rules have spaces around operators (`field = value`, not `field=value`)

## Field Properties

- [ ] Text fields: `min`, `max`, `pattern` are direct properties (not in `options`)
- [ ] Number fields: unbounded limits use `null`, not `0` (which means "max of zero")
- [ ] Select fields: `values` and `maxSelect` are direct properties
- [ ] Relation fields: `collectionId` looked up via `app.findCollectionByNameOrId()`, never hardcoded
- [ ] JSON fields: `maxSize` is a direct property

## Structure

- [ ] File named `1500000NNN_descriptive_name.js` with NNN sequential from latest existing migration
- [ ] Down migration (second argument to `migrate()`) reverses all changes
- [ ] Each collection `app.save()`'d immediately after its changes (not batched across collections)
- [ ] SQL queries use `.bind()` with named parameters (`{:param}`), never string interpolation

## Verification

- [ ] `cd pocketbase && go build .` passes
- [ ] Fresh DB test: delete `pb_data/` and verify schema creates correctly from all migrations
- [ ] If adding/removing a collection: check `scripts/setup/seed_from_prod.py` skip lists
- [ ] If modifying an enum: verify the migration actually updates existing values, not just the field definition — a changed `values` list leaves rows holding the old string
