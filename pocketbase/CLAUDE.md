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

**MANDATORY:** `docs/reference/pocketbase-migrations.md`. PocketBase v0.23 changed field property syntax; using the old `options: {}` wrapper causes **silent data truncation**.

### Numbering rule

New migrations MUST use a number greater than the highest filename on `origin/main`:

```bash
HIGHEST=$(git ls-tree -r origin/main pocketbase/pb_migrations/ \
  | awk '{print $4}' | grep -oE '15000[0-9]{5}' | sort -u | tail -1)
NEXT=$((HIGHEST + 1))
```

Do not backfill gaps left by past consolidation runs — those numbers are "burned" to preserve a monotonically increasing record. Once merged to `main`, the file is frozen; if a competing PR landed and took your number, bump above the new HEAD.

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

Pre-push runs: `go build`, `golangci-lint` (config: `.golangci.yml`), `pb-js-lint` (ESLint on `pb_hooks/`/`pb_migrations/` JS).

**Fresh-worktree gotcha:** if `pb-js-lint` exits 2 with an ESLint config error, `pocketbase/node_modules` is empty. Fix: `cd pocketbase && npm install`.

## Logging

```go
import "github.com/camp/kindred/pocketbase/logging"
logging.Init("pocketbase")
```

Format: `2026-01-06T14:05:52Z [pocketbase] LEVEL message key=value...`. `LOG_LEVEL=INFO` (default) suppresses health-check noise; `DEBUG` for verbose.

## Sync invariants

1. **Sync order matters:** sessions → attendees → persons → bunks → plans → assignments → requests
2. **Year-aware:** sync filters by `CAMPMINDER_SEASON_ID` env var (set in `.env`; see "Year invariant" above)
3. **Sessions 1–4 run sequentially** with independent history
4. **WAL checkpoint required** after database modifications
5. **Family-camp data syncs alongside summer data** — summer-camp views must filter `session_type` against the configured valid-summer-session-types list

See `docs/architecture/sync-layer.md` before adding or modifying sync jobs.

## DB file access

Don't `Read` `pb_data/data.db`, `*.db-wal`, or `*.db-shm` as files — they're binary and reading mid-write shows inconsistent state. To inspect:

```bash
sqlite3 pb_data/data.db ".schema collection_name"
sqlite3 pb_data/data.db "SELECT count(*) FROM persons WHERE year = 2026"
```

For data CRUD, prefer the HTTP API (auth pattern in `CLAUDE.local.md`).
