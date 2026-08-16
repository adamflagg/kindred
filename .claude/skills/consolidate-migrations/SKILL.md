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

Collapses every modify-migration touching one PocketBase table into the table's
original CREATE migration. Verified empirically by spinning up two scratch DBs
(proposed set + current set) and diffing their `_collections` schemas. Each round
produces a net REDUCTION in `pb_migrations/` file count — no helper files added.

**Reference files (read when you reach the relevant step):**

| File | When |
|------|------|
| `reference/edge-cases.md` | Step 6 onward — multi-save collapsing, field-order rules, multi-table trims, built-in collections |
| `reference/templates.md` | Steps 9–11 — tracking-doc entry, commit message, PR body |

Spec: `docs/superpowers/specs/2026-05-08-migration-consolidation-design.md`

## Convention: the tracking doc lives in the main repo

Never in worktrees. Always resolve the absolute path before reading or writing:

```bash
MAIN_REPO=$(dirname "$(git rev-parse --git-common-dir)")
TRACKING_DOC="$MAIN_REPO/docs/plans/migration-consolidation.md"
```

`git rev-parse --git-common-dir` returns the canonical `.git` directory whether
you're in a worktree or the main repo. Use `$TRACKING_DOC` for **all** Read and
Write calls — worktree copies are stale snapshots and edits there are lost on
cleanup.

If `$TRACKING_DOC` doesn't exist, the bootstrap PR should have seeded it. Tell the
user to run the seed step; do NOT create it from scratch here.

## Prerequisites

Assumes the bootstrap PR has shipped. Stop and tell the user if any are missing:

- `scripts/dev/migration-schema-diff.sh` (on `main`)
- `scripts/dev/verify-consolidation.sh` (orchestrator, on `main`)
- `pocketbase/main.go` OnServe hook calling `migrate history-sync` (on `main`)
- `docs/plans/migration-consolidation.md` (tracking doc, gitignored)

## Step 0: Reconcile pending PRs, compress prior rounds

### 0a. Reconcile `[⏳]` IN PROGRESS entries against actual PR state

Scan per-table sections for `[⏳] IN PROGRESS` entries. Each cites a PR number.
Resolve each via `gh pr view <PR#> --json state,mergeCommit`:

| PR state | Action |
|----------|--------|
| `MERGED` | Flip backlog row and per-table header to `[x] DONE <merge-date>`, header to `(PR #<N> merged)`. Detail block stays full — Step 0b compresses it next invocation once `origin/main` propagates. |
| `OPEN` | Leave unchanged; still pending review or merge. |
| `CLOSED` (unmerged) | Revert backlog row to `[ ]`. Delete the per-table detail block (local work is gone). Append a one-line entry under "Cross-cutting findings" recording the abandoned attempt with date and PR link. |

If an `[⏳]` entry has no PR number (round interrupted before Step 11), prompt the
user: keep, finish, or discard.

### 0b. Compress completed rounds whose deletions landed on `origin/main`

For any `[x] DONE` round whose absorbed-file deletions are present on
`origin/main` (verify with
`git log origin/main -- pocketbase/pb_migrations/<filename>` returning a delete
commit), compress that round's detail block to a single line — format in
`reference/templates.md`. Detail is recoverable from the PR's git diff.
Cross-cutting findings stay in their dedicated section regardless.

## Step 1: Read the tracking doc

```bash
cat "$TRACKING_DOC"
```

Note backlog statuses, in-progress rounds, auto-gen disposition, cross-cutting
findings.

## Step 2: List candidate tables

```bash
cd "$MAIN_REPO/pocketbase/pb_migrations"
for f in *.js; do
  matches=$(grep -oE '"[a-z][a-z0-9_]+"' "$f" | sort -u | tr -d '"')
  for tbl in $matches; do
    echo "$tbl|$f"
  done
done | awk -F'|' '{count[$1]++} END {for (t in count) if (count[t] > 1) print count[t], t}' | sort -rn | head -30
```

The grep is **intentionally noisy** — it emits every quoted snake_case-ish token
with no filtering. A narrower grep (only `findCollectionByNameOrId("...")`) missed
indirect-lookup files like `1500000074_rbac_tier1_rules.js`, where the table name
lives in an array iterated by a `setRules()` helper. Breadth is the point; you
filter by eye.

Ignore obvious non-tables (`bunk_with`, `not_bunk_with`, rule strings) and
cross-reference the backlog. Skip tables marked `[x] DONE` or `[⏳] IN PROGRESS` —
the latter is locked behind an open PR (see Step 0a).

**Re-tally before locking in a candidate.** The raw count includes files that
merely *reference* the table via a relation field (`collectionId: someTableCol.id`)
and files where the name appears in a comment, log message, or select-value enum.
Re-classify by hand, counting only files whose mutations actually target this
table. Classification table in Step 5.

## Step 3: Surface auto-generated PB UI migrations

```bash
ls "$MAIN_REPO/pocketbase/pb_migrations" | awk -F_ '{print $1}' \
  | awk 'length($1) >= 10 && $1+0 > 1700000000'
```

For any file printed, check the disposition table in the tracking doc. If absent,
ask the user: fold into the merged CREATE, leave alone, or investigate later.
Record the answer.

**`*_updated_users.js` → leave alone by default.** Gitignored per existing repo
convention: per-deployment local state from PB's admin UI, not migration code we
own. Don't fold, don't delete. The narrow users-only gitignore is intentional —
do not propose extending it.

**`*_updated_<other-table>.js` → fold into merged CREATE by default.** These are
tracked, committed, shipped autogen migrations from intentional admin-UI edits.
Same treatment as any hand-written modify migration; the autogen file is deleted.

## Step 4: User picks the table

Hold for user input. Don't auto-pick. If the user says "you choose," suggest the
highest re-tallied count from Step 2.

## Step 4a: Create a worktree for this round

Every round happens in a worktree, even if invoked from `~/kindred`.

```bash
WORKTREE_NAME="consolidate-${TABLE}-$(date +%Y%m%d)"
"$MAIN_REPO/scripts/worktree/new.sh" "$WORKTREE_NAME"
WORKTREE_DIR="$MAIN_REPO/.worktrees/$WORKTREE_NAME"
```

All filesystem writes from Step 7 onward target `$WORKTREE_DIR/...`, never
`$MAIN_REPO/...`. The tracking doc is the only artifact in `$MAIN_REPO`.

If that worktree name exists, append `-$(date +%H%M)` and retry.

## Step 5: Walk the chosen table's migration chain

For table T, enumerate every file that mutates T and classify each:

| Mutation kind | Detection |
|---------------|-----------|
| Field add | `collection.fields.add(new Field(...))` after `findCollectionByNameOrId("T")` |
| Field remove | `collection.fields.removeByName(...)` |
| Field property edit | `field.values = ...`, `field.max = ...` on a field of T |
| Rule change | `collection.<list\|view\|create\|update\|delete>Rule = ...` |
| Index change | `collection.indexes = [...]`, `addIndex`, `removeIndex` |
| Data backfill | `app.db().newQuery("UPDATE T ...")` or `INSERT INTO T` |
| Seed insert | `app.save(record)` against T (typically config-style tables) |
| **Indirect mutation via array** | File defines an array containing `"T"` and iterates it through a helper that runs schema/rule changes. **Easy to miss with literal-string greps** — see the enumeration command below. |

```bash
grep -lE '"T"' "$WORKTREE_DIR/pocketbase/pb_migrations"/*.js
```

For each file printed, inspect the surrounding control flow to decide whether T is
actually mutated, merely referenced (relation `collectionId`), or just mentioned
in a comment/log/unrelated string.

Build an in-memory ordered mutation log. Note files that touch *other* tables —
those get **trimmed**, not deleted.

## Step 6: Build the merged CREATE in memory

Take the original CREATE as base and apply mutations in order. Collapse:

- add field X + later drop X → no field
- add field X + later change `X.max` / `X.required` → field with final value
- rule changes → final rule wins
- index changes → final index set
- backfills unreachable on a fresh DB → drop (with note)
- backfills reachable → flag for user confirmation
- seed inserts against config-style tables → fold into merged `up()`

Preserve the original collection ID verbatim (e.g. `id: "col_bunk_requests"`).

**Read `reference/edge-cases.md` before writing the merged file** — multi-save
collapsing (§9) and field ordering (§10) are where rounds actually fail.

**Filename invariant — load-bearing for prod boot.** The merged CREATE MUST keep
the *exact* basename of the original CREATE: same timestamp, name, extension.
Prod's `_migrations` table keys on filename; the original CREATE's row is what
makes PB skip the merged file on boot. A renamed merged CREATE looks like a
never-applied migration, PB tries to re-create the existing collection, and boot
crashes with a unique-constraint error. The OnServe history-sync hook only
*removes* orphan rows for deleted files; it does not suppress new ones. Never bump
the timestamp, never rename for cosmetics, never split into a new file.

## Step 7: Empirical schema-diff verification

```bash
SCRATCH=$(mktemp -d -t pb-consolidate-XXXX)
trap 'rm -rf "$SCRATCH"' EXIT INT TERM

mkdir -p "$SCRATCH/proposed"
cp "$WORKTREE_DIR"/pocketbase/pb_migrations/*.js "$SCRATCH/proposed/"

# With Write/Edit tools, using the in-memory mutation log:
#   1) replace base CREATE with the merged version
#   2) delete absorbed files from $SCRATCH/proposed/
#   3) trim multi-table files in place

"$WORKTREE_DIR/scripts/dev/verify-consolidation.sh" \
  "$SCRATCH/proposed" \
  "$WORKTREE_DIR/pocketbase/pb_migrations"
```

Exit 0 → Step 8. Exit 1 → drift: save the diff to the tracking doc under that
table's "Verification failed" section (timestamped), abort the round, exit
non-zero. The user re-invokes after fixing the merged CREATE.

**Override path:** only if the user explicitly says "override verification:
<reason>". Record the rationale in the per-table section. Never silent-override.

## Step 8: Write changes to the working tree

Mirror the verified operations to the real `pb_migrations/` dir:

1. Replace the base CREATE with the merged version — **same filename as
   `origin/main`** (see Step 6). Verify:
   ```bash
   git -C "$WORKTREE_DIR" ls-tree origin/main pocketbase/pb_migrations/ \
     | grep -q " $(basename "$BASE_CREATE")$" \
     || { echo "merged CREATE filename drifted from origin/main — abort"; exit 1; }
   ```
2. `rm` fully-absorbed migration files — no helper migration needed; the OnServe
   history-sync hook cleans orphan `_migrations` rows on next prod boot.
3. Write trimmed versions of multi-table files in place.

## Step 9: Update the tracking doc — mark IN PROGRESS

The local work is done but the PR doesn't exist yet. Mark the table `[⏳] IN
PROGRESS` so future invocations know it's locked behind a pending PR. Templates
and the rationale for `[⏳]` over `[x]`: `reference/templates.md`.

## Step 10: Print summary

Summary table format: `reference/templates.md`. Print it, then proceed directly to
Step 11 — do NOT stop and ask.

After the PR merges and prod restarts, the OnServe hook calls `migrate
history-sync` on first boot, removing orphan `_migrations` rows for absorbed
files. Fresh deploys see it as a no-op.

## Step 11: Commit, push, open PR

Commit message, PR body, and the tracking-doc PR-number update: see
`reference/templates.md`. All git operations run from `$WORKTREE_DIR`.

## Step 12: Auto-invoke scan-it

```
Skill tool: scan-it <PR#>
```

scan-it runs the internal review chain plus CodeRabbit findings, dedupes, and
presents a table. Hold for user input on which findings to action.

If the user accepts as-is or says "handle it", invoke `handle-it` to enable
auto-merge, monitor CI, and clean up the worktree.
