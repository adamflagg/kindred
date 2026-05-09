---
name: consolidate-migrations
description: >
  Collapse one PocketBase table's migration chain into a single merged
  CREATE migration. Verifies via empirical 2-DB schema diff. PB v0.23's
  built-in `migrate history-sync` (auto-invoked on every server boot via
  the OnServe hook in pocketbase/main.go) self-heals prod's _migrations
  table — no per-round helper migrations needed. Triggers:
  "consolidate migrations", "merge migrations for <table>",
  "consolidate-it", or any similar request to reduce pb_migrations/ noise
  for one table.
---

# Consolidate Migrations — One Table At A Time

Collapses every modify-migration touching one PocketBase table into the
table's original CREATE migration. Empirically verified by spinning up two
scratch DBs (proposed set + current set) and diffing their `_collections`
schemas. Each round produces a net REDUCTION in `pb_migrations/` file
count — no helper migration files added.

## Convention

The tracking doc lives in the project's **main repo**, never in worktrees.
Always resolve the absolute path before reading or writing:

```bash
MAIN_REPO=$(dirname "$(git rev-parse --git-common-dir)")
TRACKING_DOC="$MAIN_REPO/docs/plans/migration-consolidation.md"
```

`git rev-parse --git-common-dir` returns the canonical `.git` directory
regardless of whether you're invoked from a worktree (where `.git` is a
file pointing into the main repo) or the main repo itself. Use
`$TRACKING_DOC` for **all** Read and Write calls — never a
worktree-relative path. Worktree copies are stale snapshots; edits there
are lost on cleanup.

If `$TRACKING_DOC` doesn't exist, the bootstrap PR for this skill should
have seeded it. Tell the user to run the seed step first; do NOT create
it from scratch in this skill.

Spec: `docs/superpowers/specs/2026-05-08-migration-consolidation-design.md`.

## Prerequisites

This skill assumes the bootstrap PR has shipped:
- `scripts/dev/migration-schema-diff.sh` (TDD'd, on `main`)
- `scripts/dev/verify-consolidation.sh` (orchestrator, on `main`)
- `pocketbase/main.go` OnServe hook calling `migrate history-sync` (on `main`)
- `docs/plans/migration-consolidation.md` (the tracking doc, gitignored)

If any are missing, stop and tell the user.

## Step 0: Compress prior-round detail blocks

Before starting a new round, scan per-table sections in the tracking doc.
For any "[x] DONE" round whose absorbed-file deletions are present in
`origin/main` (verified via `git log origin/main -- pocketbase/pb_migrations/<filename>` returning a delete commit), compress that round's full
detail block into a single line under the table's "Rounds (compressed
history)" log:

```markdown
- YYYY-MM-DD — round N — absorbed M files (#X, #Y, ...) into base #BBB — verified ✅
```

Remove the verbose detail block. Detail is recoverable from the
consolidation PR's git diff. Cross-cutting findings stay in their
dedicated section regardless.

## Step 1: Read tracking doc

```bash
cat "$TRACKING_DOC"
```

Note current backlog statuses, in-progress rounds, auto-gen disposition,
and cross-cutting findings.

## Step 2: List candidate tables

```bash
cd "$MAIN_REPO/pocketbase/pb_migrations"
for f in *.js; do
  # Catch BOTH literal lookups (findCollectionByNameOrId("foo")) AND
  # indirect lookups where the table name lives in an array iterated by
  # a loop variable (`const tables = ["foo", "bar"]; ... for (const name of tables) findCollectionByNameOrId(name)`).
  # The seed-time grep used to look only inside `findCollectionByNameOrId("...")`
  # and missed indirect-lookup files like 1500000074_rbac_tier1_rules.js
  # — that bug is what required adding the array-name fallback below.
  # Emit every quoted snake_case-ish token. Intentionally no filtering —
  # rule predicates and other non-tables get mixed in, and the user
  # eyeballs the ranked output below to ignore obvious non-tables. The
  # original narrower grep (only `findCollectionByNameOrId("...")` /
  # `name: "..."`) missed an indirect-lookup file (1500000074) where the
  # table name lives in an array iterated by a `setRules()` helper, so
  # we widened it to catch any quoted occurrence.
  matches=$(grep -oE '"[a-z][a-z0-9_]+"' "$f" | sort -u | tr -d '"')
  for tbl in $matches; do
    echo "$tbl|$f"
  done
done | awk -F'|' '{count[$1]++} END {for (t in count) if (count[t] > 1) print count[t], t}' | sort -rn | head -30
```

The grep above is intentionally noisy (catches every quoted snake_case-ish
token). Eyeball the top of the list, ignore obvious non-tables (`bunk_with`,
`not_bunk_with`, rule strings, etc.), and cross-reference against the
tracking doc's backlog. Filter out tables in `[x] DONE` status.

The user picks one, or you suggest the highest-count candidate not yet
started.

**Important — re-tally before locking in a candidate.** The raw count
above includes:
- files that merely *reference* the table via a relation field
  (`collectionId: someTableCol.id`)
- files where the table name appears as a string but isn't actually
  mutated (e.g., a comment, a log message, a select-value enum that
  happens to share a name)

Before committing to a round, re-classify each candidate file by hand:
count only files whose mutations actually target this table (`fields.add`,
`fields.removeByName`, `<rule> =`, index changes, data backfills, or a
loop body that calls `findCollectionByNameOrId(name)` where `name` was
sourced from an array containing this table). See Step 5 for the full
classification table.

## Step 3: Surface auto-generated PB UI migrations

```bash
ls "$MAIN_REPO/pocketbase/pb_migrations" | awk -F_ '{print $1}' \
  | awk 'length($1) >= 10 && $1+0 > 1700000000'
```

For any file printed, check the disposition table in the tracking doc.
If absent, ask the user:
- Fold into the merged CREATE (when this table is consolidated)?
- Leave alone (treat as untouchable)?
- Investigate later (re-surface next invocation)?

Record the disposition in the tracking doc.

**Default disposition for `*_updated_users.js`:** these files are gitignored
by existing repo convention (per `.gitignore`). They're per-deployment
local state from PB's admin UI, not migration code we own. The skill
should NOT fold them into merged CREATEs and should NOT delete them.
Each deployment maintains its own copy. Disposition defaults to "leave alone"
unless the user overrides explicitly. **The narrow gitignore (users-only)
is intentional.** Do not propose extending it to other tables.

**Default disposition for `*_updated_<other-table>.js`:** these are
**not** gitignored — they're tracked, committed, shipped autogen
migrations from intentional admin-UI edits (column reorder, field
add/edit, rule change, etc.). Default is **"fold into merged CREATE"**
during the next consolidation round for that table. The user wants
admin-UI edits compressed into the table's merged CREATE alongside the
rest of the chain — same treatment as any hand-written modify migration.
The reorder/edit ends up reflected in the final-state field order or
field properties of the merged CREATE; the autogen file is deleted.

## Step 4: User picks the table

Hold for user input. Don't auto-pick. If the user says "you choose,"
suggest the highest re-tallied count from Step 2.

## Step 4a: Create a worktree for this round

Every consolidation round happens in a worktree, never the main repo folder.
Even if the user invokes the skill from `~/kindred`, create a worktree.

```bash
WORKTREE_NAME="consolidate-${TABLE}-$(date +%Y%m%d)"
"$MAIN_REPO/scripts/worktree/new.sh" "$WORKTREE_NAME"
WORKTREE_DIR="$HOME/kindred-worktrees/$WORKTREE_NAME"
```

All filesystem writes from Step 7 onward target `$WORKTREE_DIR/...`, NEVER
`$MAIN_REPO/...`. The tracking doc is the only artifact in `$MAIN_REPO`
(gitignored, not branched).

If a worktree with that name already exists, append `-$(date +%H%M)` and retry.

## Step 5: Walk the chosen table's migration chain

For the chosen table T, enumerate every file that mutates T. For each,
classify:

| Mutation kind | Detection |
|---------------|-----------|
| Field add | `collection.fields.add(new Field(...))` after `findCollectionByNameOrId("T")` |
| Field remove | `collection.fields.removeByName(...)` |
| Field property edit | `field.values = ...`, `field.max = ...` etc. on a field of T |
| Rule change | `collection.<list\|view\|create\|update\|delete>Rule = ...` |
| Index change | `collection.indexes = [...]`, `addIndex`, `removeIndex` |
| Data backfill | `app.db().newQuery("UPDATE T ...")` or `INSERT INTO T` |
| Seed insert | `app.save(record)` against T (typically config-style tables) |
| **Indirect mutation via array** | File defines an array containing `"T"` and iterates it through a helper that runs schema/rule changes, e.g. `for (const name of tables) { setRules(name, ...) }`. **These are easy to miss with literal-string greps** — always also `grep -l '"T"'` (any quoted occurrence) and inspect the surrounding control flow. The bug that surfaced this rule was 1500000074_rbac_tier1_rules.js, which iterated 18 collections through a `setRules()` helper and was missed at seed time. |

Build an in-memory ordered mutation log. Note any files that touch
*other* tables too — those are multi-table and will be **trimmed**, not
deleted.

**Robust enumeration command** (assumes `$WORKTREE_DIR` was set in Step 4a):

```bash
# All files that mention T as a quoted string (catches indirect lookups
# through arrays that the literal `findCollectionByNameOrId("T")` grep
# would miss).
grep -lE '"T"' "$WORKTREE_DIR/pocketbase/pb_migrations"/*.js
```

Then for each file printed, eyeball the context to decide whether T is
actually mutated, merely referenced (relation `collectionId`), or just
mentioned in a comment / log / unrelated string.

## Step 6: Build the merged CREATE in memory

Take the original CREATE file as base. Apply mutations in order. Collapse:
- add field X + later drop X → no field
- add field X + later change X.max → field with final max
- add field X + later set X.required → field with final required
- rule changes → final rule wins
- index changes → final index set
- backfills classified as **unreachable** on fresh DB → drop (with note)
- backfills classified as **reachable** → flag for user confirmation
- seed inserts (against config-style tables) → fold into merged CREATE's `up()`

Preserve the original collection ID verbatim (e.g., `id: "col_bunk_requests"`).
Subsequent migrations may reference it.

**Filename invariant (load-bearing for prod boot).** The merged CREATE MUST
keep the *exact* basename of the original CREATE migration — same timestamp,
same name, same extension. Prod's `_migrations` table keys on filename: the
original CREATE's row is what makes PB skip the merged file on boot. A
renamed merged CREATE is seen as a never-applied migration, PB tries to
re-create the existing collection, and boot crashes with a unique-constraint
error. The OnServe history-sync hook only *removes* orphan rows for deleted
files; it does not suppress new files. Never bump the timestamp, never
rename for cosmetics, never split into a new file.

## Step 7: Empirical schema-diff verification

```bash
SCRATCH=$(mktemp -d -t pb-consolidate-XXXX)
trap 'rm -rf "$SCRATCH"' EXIT INT TERM

mkdir -p "$SCRATCH/proposed"
cp "$WORKTREE_DIR"/pocketbase/pb_migrations/*.js "$SCRATCH/proposed/"

# 1) Replace base CREATE with the merged version
# 2) Delete absorbed files from $SCRATCH/proposed/
# 3) Trim multi-table files (write trimmed versions in-place)
# (do these steps with Write/Edit tools using the in-memory mutation log)

"$WORKTREE_DIR/scripts/dev/verify-consolidation.sh" \
  "$SCRATCH/proposed" \
  "$WORKTREE_DIR/pocketbase/pb_migrations"
```

Exit 0: proceed to Step 8. Exit 1: drift detected. Save the diff output
to the tracking doc under that table's "Verification failed" section
(timestamped), abort the round, exit non-zero. The user re-invokes after
fixing the merged CREATE.

**Override path:** if the user explicitly states "override verification:
<reason>" in their next prompt, record the rationale in the per-table
section and proceed despite the diff. Never silent-override.

## Step 8: Write changes to the working tree

Once verification passes, mirror the same operations to the real
`pb_migrations/` dir (not the scratch dir):

1. Replace the base CREATE migration with the merged version — **same
   filename as origin/main** (see "Filename invariant" in Step 6). Verify:
   ```bash
   git -C "$WORKTREE_DIR" ls-tree origin/main pocketbase/pb_migrations/ \
     | grep -q " $(basename "$BASE_CREATE")$" \
     || { echo "merged CREATE filename drifted from origin/main — abort"; exit 1; }
   ```
2. Delete fully-absorbed migration files (`rm` them — no helper migration
   needed; the OnServe history-sync hook in `pocketbase/main.go` cleans
   the orphan `_migrations` rows automatically on next prod boot)
3. Trim multi-table migration files (write trimmed versions in-place)

## Step 9: Update the tracking doc

Append (or update) the per-table section:

```markdown
### <table> — [x] DONE <date>

**Rounds (compressed history):**
- <date> — round N — absorbed M files (#X, #Y, ...) into base #BBB — verified ✅
```

Add cross-cutting findings if anything novel surfaced (e.g., a
multi-table migration was trimmed and the remainder is queued for another
table's future round).

## Step 10: Print summary, hand back

| Field | Value |
|-------|-------|
| Table consolidated | T |
| Round number | N |
| Files absorbed | M (deleted) + K (trimmed multi-table) |
| Net migration count delta | -M (no new files) |
| Verification | ✅ schema match |
| PR draft message | "refactor(pb): consolidate $TABLE migrations (round N, -M files)" |

Stop. Do NOT auto-commit, do NOT push, do NOT open a PR. The user reviews
the working-tree changes manually and decides when/how to ship.

After the PR merges to main and prod restarts, the OnServe hook in
`pocketbase/main.go` automatically calls `migrate history-sync` on first
boot, removing orphan `_migrations` rows for the absorbed files. Fresh
deploys see this hook as a no-op.

## Edge cases the skill must handle

See spec §"Edge cases" for full detail. Quick reference:

1. **Multi-table migrations** — trim, don't delete; cross-cutting log entry.
2. **Data backfills** — drop if unreachable on fresh DB; flag if reachable.
3. **Built-in collections** (e.g., `_pb_users_auth_`) — merge target is the
   first migration WE wrote that touches it; merged file uses
   `findCollectionByNameOrId(...)` not `new Collection(...)`.
4. **Auto-generated PB UI migrations** — surface for user disposition,
   never auto-skip.
5. **Verification failure** — abort with diff written to tracking doc;
   override only with explicit user statement.
6. **Hardcoded collection IDs** — preserve verbatim in merged CREATE.
7. **Indexes** — only the final set in the merged CREATE.
8. **Merged CREATE comments** — the merged file reads like a fresh CREATE
   migration. Do NOT include comments referencing absorbed/deleted file
   numbers ("From #1500000092", "added in #095", consolidated-migrations
   block headers, etc.). Those filenames vanish after the round ships and
   the references rot. Keep functional comments only when they explain WHY
   a non-obvious value was chosen ("max=200 because CampMinder caps name
   at 200"). The commit message and tracking-doc per-round detail block
   carry the historical context.
9. **Collapse `app.save()` calls — only when truly redundant**

   When the original CREATE used multiple `app.save()` calls, evaluate
   whether the consolidated form still needs them. Four patterns to
   recognize:

   a. **Self-referencing relation (NOT collapsible on PB v0.23)** —
      original does `app.save(collection)` then `collection.fields.add(new
      Field({..., collectionId: SELF_ID}))` then `app.save(collection)`.
      It LOOKS collapsible because `SELF_ID` is a hardcoded constant, but
      PB v0.23's `app.save()` validates `relation.collectionId` against
      existing rows in `_collections` at save time. The self-collection
      doesn't exist yet during the first save, so a self-relation in the
      initial `fields:` array fails with `"The relation collection
      doesn't exist"`. **Keep the two-save pattern.** This was empirically
      confirmed during the bunk_requests round 1 attempt (PR #1243 + the
      bunk_requests consolidation): the harness rejected the collapsed
      form with the exact error above.

   b. **Cross-collection refs with hardcoded ID (collapsible)** — when
      collection A's relation field references collection B's hardcoded
      ID, AND B is created in an earlier migration, the relation can sit
      in A's initial `fields:` array. The validation passes because B
      already exists in `_collections`. This is the only "hardcoded ID
      collapse" pattern that actually works on PB v0.23.

   c. **Seed-data inserts (NOT collapsible)** — original does
      `app.save(collection)` then `new Record(collection)` followed by
      `app.save(record)` for each seed row. The Record constructor needs
      a saved collection (it copies the schema by reference). **Keep
      multi-save.** Pattern is common for `config`, `roles`, and other
      lookup-style tables.

   d. **Cross-collection circular refs (NOT collapsible)** — rare; two
      collections reference each other via relation fields and neither
      can be created with both fields populated. Keep both saves; document
      in the commit message.

   The verification harness must still pass after any collapse — if a
   collapse breaks the diff (or PB rejects the save with a validation
   error), restore the original multi-save structure.

10. **Field order matters — match the final-state order, however it was reached**

    The harness compares JSON dumps of `_collections`, and PB serializes
    fields in the order they were added (or rearranged) across all
    `fields.add()` / `collection.fields = [...]` / initial-fields-array
    operations. The diff is **order-sensitive**: a correctly merged
    CREATE that ends up with the same set of fields but a different
    array order fails verification with a noise diff even though the
    SQL schema is functionally identical.

    **Underlying invariant:** the merged CREATE must produce the same
    final field order as the natural-build chain. That's all that
    matters. The harness verifies it.

    **Default heuristic — preserve historical add sequence.** When no
    reorder migration exists in the chain (the common case), the final
    order is just the chronological add order. Concretely, if the chain
    was:
    - #018 CREATE: fields A, B, C, ..., created, updated (initial array)
    - #018 second save: add `merged_into` (self-relation)
    - #092: add `disposition_reason`, `resolution_method`
    - #095: add `source_fragment`

    Then the merged CREATE produces final order: `A, B, C, ..., created,
    updated, merged_into, disposition_reason, resolution_method,
    source_fragment` — matching the historical sequence. In practice:
    original initial-array fields stay in the initial array; fields
    added by later migrations are added via `fields.add()` calls in
    the second save (or a later save), in the order their original
    migrations ran. Don't shove everything into the initial fields
    array even if it would technically work — the resulting field order
    drifts from the comparison DB and the harness flags it.

    **When the chain contains a manual reorder (PB admin UI auto-gen).**
    Reordering columns in PB's admin UI generates a
    `<timestamp>_updated_<table>.js` migration that rewrites
    `collection.fields` to a new order. With one of these in the chain,
    "historical add sequence" is **not** the right answer — the
    *post-reorder* order is. The default disposition for these files is
    **fold into the merged CREATE** (see Step 3): the user's manual
    edits get compressed alongside hand-written modify migrations.

    To fold a reorder cleanly, arrange fields in the merged CREATE's
    initial-fields-array (and any subsequent `fields.add()` calls) so
    the resulting JSON dump matches the reordered final state. PB's
    `fields.add()` always appends to the end, so a self-relation added
    in a second save (per rule 9a) lands AFTER any fields you put in
    the initial array. If the user's reorder placed the self-relation
    in the middle of the field list, you cannot reproduce that order
    with two saves alone — the merged CREATE will need a third save
    that explicitly rearranges via `collection.fields = [...]`. The
    harness will tell you exactly which fields drifted; iterate until
    it passes.

    Fallback: if folding the reorder gets too gnarly for a particular
    round (e.g., self-relation positioned mid-array, or multiple
    interleaved reorders), set disposition to "leave alone" for that
    file and pick it up in a subsequent round. Record the deferral in
    the tracking doc's auto-gen disposition table with a brief reason.

    **Field removal preserves relative order.** PB's `removeByName()`
    deletes the field from the array entirely; remaining fields keep
    their relative order. So a field dropped by a later migration (e.g.,
    `source` dropped by #103) just disappears from the merged CREATE's
    initial fields array without renumbering anything else.

    **Verification always wins.** Whatever heuristic you apply, the
    harness compares JSON dumps. If you miss the order, `schemas differ`
    fires and the diff tells you exactly which fields are misplaced.
    Never silent.

    Discovered during the bunk_requests round 1 (2026-05-08) — the first
    merged CREATE put the three new text fields in the initial fields
    array, which produced the right SET of fields but the wrong ORDER,
    and the harness reported `schemas differ` on a pure-ordering diff.

    **Gitignore for auto-gen migrations is narrow — and intentionally so.**
    Only `*_updated_users.js` is excluded; users-collection edits are
    per-deployment local state. Every other `*_updated_<table>.js` IS
    tracked, committed, and shipped — those are intentional admin-UI
    edits the user wants applied everywhere. Default disposition for
    those is **fold into merged CREATE** (see Step 3). Do not propose
    broadening the gitignore.
