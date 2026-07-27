# Consolidate Migrations — Edge Cases

Full detail for the cases the skill must handle. Spec §"Edge cases" is the
authoritative source; this is the working reference.

## 1. Multi-table migrations

Trim, don't delete. Write the trimmed version in place and add a cross-cutting
log entry so the remainder is queued for the other table's future round.

## 2. Data backfills

Drop if unreachable on a fresh DB (with a note). Flag for user confirmation if
reachable.

## 3. Built-in collections (e.g. `_pb_users_auth_`)

The merge target is the first migration **we** wrote that touches it. The merged
file uses `findCollectionByNameOrId(...)`, not `new Collection(...)`.

Note: `_pb_users_auth_` is currently skipped entirely — the gitignored
`*_updated_users.js` outlier makes clean consolidation impossible. Marked `[⏸]`
in the tracking doc.

## 4. Auto-generated PB UI migrations

Surface for user disposition; never auto-skip. See Step 3 in SKILL.md for the
default dispositions.

## 5. Verification failure

Abort with the diff written to the tracking doc. Override only on an explicit
user statement ("override verification: <reason>"), recorded in the per-table
section. Never silent-override.

## 6. Hardcoded collection IDs

Preserve verbatim in the merged CREATE (e.g. `id: "col_bunk_requests"`).
Subsequent migrations may reference them.

## 7. Indexes

Only the final index set appears in the merged CREATE.

## 8. Merged CREATE comments

The merged file must read like a fresh CREATE migration. **Do NOT** include
comments referencing absorbed/deleted file numbers — "From #1500000092", "added
in #095", consolidated-migration block headers, etc. Those filenames vanish once
the round ships and the references rot.

Keep functional comments only where they explain WHY a non-obvious value was
chosen ("max=200 because CampMinder caps name at 200"). The commit message and
the tracking-doc per-round detail block carry the historical context.

## 9. Collapsing `app.save()` calls — only when truly redundant

When the original CREATE used multiple `app.save()` calls, evaluate whether the
consolidated form still needs them. Four patterns:

### a. Self-referencing relation — NOT collapsible on PB v0.23

Original does `app.save(collection)`, then
`collection.fields.add(new Field({..., collectionId: SELF_ID}))`, then
`app.save(collection)` again.

It *looks* collapsible because `SELF_ID` is a hardcoded constant, but PB v0.23's
`app.save()` validates `relation.collectionId` against existing rows in
`_collections` at save time. The self-collection doesn't exist yet during the
first save, so a self-relation in the initial `fields:` array fails with
`"The relation collection doesn't exist"`.

**Keep the two-save pattern.** Empirically confirmed during the `bunk_requests`
round 1 attempt (PR #1243) — the harness rejected the collapsed form with that
exact error.

### b. Cross-collection refs with hardcoded ID — collapsible

When collection A's relation field references collection B's hardcoded ID, and B
is created in an earlier migration, the relation can sit in A's initial `fields:`
array. Validation passes because B already exists in `_collections`. This is the
only "hardcoded ID collapse" pattern that actually works on PB v0.23.

### c. Seed-data inserts — NOT collapsible

Original does `app.save(collection)`, then `new Record(collection)` followed by
`app.save(record)` per seed row. The `Record` constructor needs a saved
collection (it copies the schema by reference). **Keep multi-save.** Common for
`config`, `roles`, and other lookup-style tables.

### d. Cross-collection circular refs — NOT collapsible

Rare. Two collections reference each other via relation fields and neither can be
created with both fields populated. Keep both saves; document in the commit
message.

**In all four cases:** the verification harness must still pass after any
collapse. If a collapse breaks the diff (or PB rejects the save with a validation
error), restore the original multi-save structure.

## 10. Field order matters — match the final-state order

The harness compares JSON dumps of `_collections`, and PB serializes fields in
the order they were added or rearranged across all `fields.add()` /
`collection.fields = [...]` / initial-fields-array operations. The diff is
**order-sensitive**: a correctly merged CREATE with the same set of fields but a
different array order fails verification on a pure-ordering noise diff.

**Underlying invariant:** the merged CREATE must produce the same final field
order as the natural-build chain. That's all that matters, and the harness
verifies it.

### Default heuristic — preserve historical add sequence

When no reorder migration exists in the chain (the common case), the final order
is just chronological add order. If the chain was:

- `#018` CREATE: fields A, B, C, …, `created`, `updated` (initial array)
- `#018` second save: add `merged_into` (self-relation)
- `#092`: add `disposition_reason`, `resolution_method`
- `#095`: add `source_fragment`

…the merged CREATE produces final order `A, B, C, …, created, updated,
merged_into, disposition_reason, resolution_method, source_fragment`.

In practice: original initial-array fields stay in the initial array; fields added
by later migrations go in `fields.add()` calls in the second (or later) save, in
the order their original migrations ran. Don't shove everything into the initial
fields array even if it would technically work — the field order drifts from the
comparison DB and the harness flags it.

### When the chain contains a manual reorder (PB admin UI auto-gen)

Reordering columns in PB's admin UI generates a `<timestamp>_updated_<table>.js`
migration that rewrites `collection.fields` to a new order. With one of these in
the chain, "historical add sequence" is **not** the right answer — the
*post-reorder* order is. Default disposition is **fold into the merged CREATE**
(Step 3).

To fold a reorder cleanly, arrange fields in the merged CREATE's initial-fields
array (and any subsequent `fields.add()` calls) so the resulting JSON dump matches
the reordered final state. PB's `fields.add()` always appends, so a self-relation
added in a second save (per 9a) lands AFTER anything in the initial array. If the
user's reorder placed the self-relation mid-list, two saves can't reproduce it —
the merged CREATE needs a third save that explicitly rearranges via
`collection.fields = [...]`. The harness reports exactly which fields drifted;
iterate until it passes.

**Fallback:** if folding a reorder gets too gnarly for a round (self-relation
mid-array, multiple interleaved reorders), set disposition to "leave alone" for
that file and pick it up in a later round. Record the deferral in the tracking
doc's auto-gen disposition table with a brief reason.

### Field removal preserves relative order

`removeByName()` deletes the field from the array entirely; remaining fields keep
their relative order. A field dropped by a later migration just disappears from
the merged CREATE's initial fields array without renumbering anything else.

### Verification always wins

Whatever heuristic you apply, the harness compares JSON dumps. Miss the order and
`schemas differ` fires with a diff naming the misplaced fields. Never silent.

Discovered during `bunk_requests` round 1 (2026-05-08): the first merged CREATE
put the three new text fields in the initial fields array, producing the right SET
of fields but the wrong ORDER.

## Gitignore for auto-gen migrations is narrow — intentionally

Only `*_updated_users.js` is excluded; users-collection edits are per-deployment
local state. Every other `*_updated_<table>.js` IS tracked, committed, and
shipped — those are intentional admin-UI edits the user wants applied everywhere.
Default disposition for those is **fold into merged CREATE** (Step 3).

**Do not propose broadening the gitignore.**
