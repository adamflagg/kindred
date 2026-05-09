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
  matches=$(grep -oE 'findCollectionByNameOrId\("[^"]+"|new Collection\(\{[^}]*name: "[^"]+"' "$f" | grep -oE '"[a-z_]+"' | sort -u)
  for tbl in $matches; do echo "$tbl|$f"; done
done | awk -F'|' '{count[$1]++} END {for (t in count) if (count[t] > 1) print count[t], t}' | sort -rn | head -10
```

Cross-reference against the tracking doc's backlog. Filter out tables in
`[x] DONE` status. The user picks one, or you suggest the highest-count
candidate not yet started.

**Important:** The raw count above includes migrations that merely
*reference* the table via a relation field. Before locking in a candidate,
re-tally by inspecting each file: count only files whose mutations
actually target this table (`fields.add`, `fields.removeByName`,
`<rule> =`, index changes, data backfills against this table).

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
Each deployment maintains its own. Disposition defaults to "leave alone"
unless the user overrides explicitly.

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

Build an in-memory ordered mutation log. Note any files that touch
*other* tables too — those are multi-table and will be **trimmed**, not
deleted.

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

1. Replace the base CREATE migration with the merged version
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
   whether the consolidated form still needs them. Three patterns to
   recognize:

   a. **Self-referencing relation (collapsible)** — original does
      `app.save(collection)` then `collection.fields.add(new Field({...,
      collectionId: SELF_ID}))` then `app.save(collection)`. With a
      hardcoded collection-ID constant defined before the constructor,
      the self-relation can move into the initial `fields:` array.
      **Collapse to one save.**

   b. **Seed-data inserts (NOT collapsible)** — original does
      `app.save(collection)` then `new Record(collection)` followed by
      `app.save(record)` for each seed row. The Record constructor needs
      a saved collection (it copies the schema by reference). **Keep
      multi-save.** Pattern is common for `config`, `roles`, and other
      lookup-style tables.

   c. **Cross-collection circular refs (NOT collapsible)** — rare; two
      collections reference each other via relation fields and neither
      can be created with both fields populated. Keep both saves; document
      in the commit message.

   The verification harness must still pass after any collapse — if a
   collapse breaks the diff, restore the original multi-save structure.
