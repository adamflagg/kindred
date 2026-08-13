# pocketbase/

Go service: SQLite DB, auth, CampMinder sync. Entry: `main.go`. Module: `github.com/camp/kindred/pocketbase`.

## Subpackages

| Dir | Purpose |
|-----|---------|
| `sync/` + `campminder/` | CampMinder API → PocketBase sync jobs |
| `rbac/` | Role / permission rules (distinct from FastAPI's `bunking/rbac/`) |
| `bunk_requests/`, `feedback/`, `google/`, `ratelimit/`, `logging/` | Feature packages |
| `pb_hooks/` | JS hooks executed by PocketBase v0.23 runtime |
| `pb_migrations/` | Schema source of truth — JS migrations |

## Migrations — read before writing any

**MANDATORY:** `docs/reference/pocketbase-migrations.md`. PocketBase v0.23 changed field property syntax; the old `options: {}` wrapper is **silently ignored** — fields fall back to PB defaults (text→5000 chars, json→1 MB) instead of your declared values, and over-cap writes are rejected (not truncated).

### Numbering rule

New migrations MUST use a number greater than the highest filename on `origin/main`:

```bash
HIGHEST=$(git ls-tree -r origin/main pocketbase/pb_migrations/ \
  | awk '{print $4}' | grep -oE '15000[0-9]{5}' | sort -u | tail -1)
NEXT=$((HIGHEST + 1))
```

Do not backfill gaps left by past consolidation runs — those numbers are "burned" to preserve a monotonically increasing record. Once merged to `main`, the file is frozen; if a competing PR landed and took your number, bump above the new HEAD.

⚠️ **Renumber BEFORE you first boot the branch, not after.** `_migrations` keys on the exact filename, so renaming a migration your dev database already applied makes PocketBase treat it as brand new: an ALTER silently re-runs and a CREATE fails the boot with `Collection name must be unique`. `scripts/dev/verify-migration-history.sh` catches it (and `start_dev.sh` runs it before every boot), but the recovery is manual and depends on whether the file's content changed too — see `docs/reference/pocketbase-migrations.md` § "Renumbering a migration you have already applied locally". Do not reach for the obvious drop-and-re-run; it destroys local data when the table is not empty.

### History-sync (why consolidation is safe)

`main.go` registers an `OnServe` hook that runs `migrate history-sync` on every server boot. It reconciles prod's `_migrations` table against the on-disk file list automatically — no per-round helper migrations needed when consolidating. Skill: `consolidate-migrations`.

### `pb_users_auth_` table

**Skip in consolidation rounds.** The gitignored `*_updated_users.js` outlier (e.g. `1769791931_updated_users.js`) makes clean consolidation impossible. Marked `[⏸]` in the tracking doc.

## Filter syntax — spaces around operators

PocketBase parses filters with strict whitespace requirements.

```text
✓ field = value          ✗ field=value
✓ field != ''            ✗ field!=''
✓ created >= '2026-01-01'
```

No spaces → silently returns wrong results. Applies to Go `dao.FindRecordsByFilter`, JS hooks, and HTTP `filter=` params.

## Spelling: "cancelled" (British)

Fields use British spelling: `cancelled_count`, `cancelled_at`. Allowed via `extra-words` in `.golangci.yml`. Don't "fix" to `canceled` — it'll break PocketBase column references.

## Year invariant

All CampMinder data tables include a required `year` field. **Cross-table relationships use CampMinder IDs, never PocketBase IDs.** Unique indexes include `year` (e.g., `person_id, year, session`).

Sync filters by `CAMPMINDER_SEASON_ID` from `.env`. Frontend year dropdown is display-only.

## Build & test

```bash
cd pocketbase && go build ./...
cd pocketbase && go test ./...
cd pocketbase && go test ./sync/...     # one package
```

**Add `-race` only when you mean it.** The race detector costs about **4.5x** here — measured
back-to-back on one machine, `sync` goes 60.8s → 298.2s and `lodging` 35.1s → 136.6s — because
there is exactly one `t.Parallel()` in the tree, so every test in a package runs serially.
Schema-heavy tests are worse than the average: the `TestLodgingAssignmentsSync*` slice is
~10x on its own. `sync` (297s) and `lodging` (143s) are
effectively the whole bill; the other nine packages total ~15s. Reach for `-race` when you
touch `sync/orchestrator.go`, `sync/api.go`, `sync/scheduler.go`, or anything else that spawns
a goroutine, and leave it off for the ordinary edit-test loop.

CI does run `-race` over everything, split across a four-way matrix so no single shard is the
critical path. To reproduce one shard locally:

```bash
python3 scripts/ci/go_test_shard.py --shard 0 --total 4 -- -race   # from the repo root
```

The sharder reads its inventory live from `go test -list` and fails a shard if any test it
selected produced no result, so a `-run` regex can't silently drop coverage. It runs `go test
-json` and reads the structured per-test events, so that check does not depend on `-v`; the
readable transcript is rebuilt from the stream. kindred#2281
tracks adding `t.Parallel()`, which would make the shards unnecessary.

Pre-push runs: `go build` and `pb-js-lint` (ESLint on `pb_hooks/`/`pb_migrations/` JS).

**`golangci-lint` is NOT in pre-push** — `.lefthook.yml` moved it to CI-only for speed, so a
clean push tells you nothing about Go lint and CI goes red afterwards. Run it yourself before
pushing Go changes:

```bash
cd pocketbase && golangci-lint run --config ../.golangci.yml   # config lives at the repo root
```

**Fresh-worktree gotcha:** if `pb-js-lint` exits 2 with an ESLint config error, `pocketbase/node_modules` is empty. Fix: `cd pocketbase && npm install`.

## Logging

```go
import "github.com/camp/kindred/pocketbase/logging"
logging.Init("pocketbase")
```

Format: `2026-01-06T14:05:52Z [pocketbase] LEVEL message key=value...`. `LOG_LEVEL=INFO` (default) suppresses health-check noise; `DEBUG` for verbose.

## Sync invariants

1. **Sync order matters.** `orderedJobs` in `sync/orchestrator.go` is the source of truth; the
   source phase runs `session_groups → sessions → attendees → persons → bunks → bunk_plans →
   bunk_assignments → staff → financial_transactions`, then the transform phase (derived tables),
   then `process_requests`. **`session_groups` runs first** — `sessions` reads it for the
   group-ID mapping, so a job inserted ahead of it sees no groups. Full phase table:
   `docs/architecture/sync-layer.md` § "Sync Dependencies".
2. **Year-aware:** sync filters by `CAMPMINDER_SEASON_ID` env var (set in `.env`; see "Year invariant" above)
3. **Sessions 1–4 run sequentially** with independent history
4. **WAL checkpoint required** after database modifications — this scopes to the Go sync layer (e.g. `forceWALCheckpoint()` in `family_camp_derived.go`); migrations don't need their own, since `runHistorySync` in `main.go` checkpoints on every boot after migrations apply (see `pb_migrations/*.js` in `.coderabbit.yaml`). The rationale is durability across a `docker stop`/`start`, not reader visibility. **One deliberate exception:** `sync_runs` (`sync/sync_runs.go`) — orchestrator telemetry read weeks later to fit a threshold, whose write path already swallows its own failures. Losing the last rows to an unclean shutdown costs a few points on a distribution of thousands, against a checkpoint on every one of ~100 writes a day. Nothing else in the sync layer is exempt
5. **Family-camp data syncs alongside summer data** — summer-camp views must filter `session_type` against the configured valid-summer-session-types list

Read before touching sync code:

| Doc | Covers |
|-----|--------|
| `docs/architecture/sync-layer.md` | Architecture, phase/job order, the add-a-new-sync-job checklist |
| `docs/reference/go-sync-patterns.md` | Service structure, `BaseSyncService`, idempotent upserts, orphan-deletion safety, year-scoped vs global collections |
| `docs/reference/sync-id-conventions.md` | `PopulateRelations`, composite keys, why data fields hold CampMinder IDs and relation fields hold PocketBase IDs |
| `docs/reference/family-camp-field-provenance.md` | Which form asks each family-camp housing field, the question families read, what the CampMinder API can and cannot tell you, and why the adult slots drift |
| `docs/reference/family-camp-grain-collapse.md` | The 26 sites where family-camp person answers collapse to household grain, what each discards, and how #2257 and its siblings map onto them |

## DB file access

Don't `Read` `pb_data/data.db`, `*.db-wal`, or `*.db-shm` as files — they're binary and reading mid-write shows inconsistent state. To inspect:

```bash
sqlite3 pb_data/data.db ".schema collection_name"
sqlite3 pb_data/data.db "SELECT count(*) FROM persons WHERE year = 2026"
```

For data CRUD, prefer the HTTP API (auth pattern in `CLAUDE.local.md`).
