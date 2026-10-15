# Seeding Dev Database from Production

Load production data into your local dev environment while keeping dev auth working.

## How It Works

1. `start_dev.sh` creates a clean dev DB with correct superuser, OAuth, and migrations
2. The seed script ATTACHes a prod DB copy and copies **only data tables** (persons, attendees, bunks, etc.)
3. System/auth tables (`_superusers`, `_collections`, `users`, `_migrations`, etc.) are never touched

This means your dev login credentials stay intact while you get real production data.

## Steps

### 1. Start dev services (creates clean dev DB)

```bash
./scripts/start_dev.sh
```

Wait for PocketBase to initialize, then stop services (Ctrl+C) or leave them running.

### 2. Place the prod database

Copy your production `data.db` to `pocketbase/pb_data/data-prod.db`:

```bash
cp /path/to/prod/data.db pocketbase/pb_data/data-prod.db
```

If you also have WAL/SHM files, copy those too — the script handles cleanup:

```bash
cp /path/to/prod/data.db-wal pocketbase/pb_data/data-prod.db-wal
cp /path/to/prod/data.db-shm pocketbase/pb_data/data-prod.db-shm
```

### 3. Run the seed script

```bash
uv run python scripts/setup/seed_from_prod.py
```

Or preview first (report only, nothing modified):

```bash
uv run python scripts/setup/seed_from_prod.py --dry-run
```

### 4. Verify

```bash
# Check data is present
sqlite3 pocketbase/pb_data/data.db "SELECT COUNT(*) FROM persons;"

# Check auth is untouched
sqlite3 pocketbase/pb_data/data.db "SELECT email FROM _superusers;"
# Should show: admin@camp.local

# Login at http://localhost:8090/_/ with dev credentials
```

## Custom paths

```bash
uv run python scripts/setup/seed_from_prod.py \
    --dev-db path/to/data.db \
    --prod-db path/to/data-prod.db
```

## What gets copied

Every application data table (any table whose name does not start with `_` or `sqlite_`, and is not `users`), for example `persons`, `attendees`, `bunks`, `bunk_assignments`, `camp_sessions`, `config`, etc.

## What stays untouched

| Table | Why |
|-------|-----|
| `_superusers` | Dev admin credentials |
| `_collections` | Schema definitions with OAuth config |
| `_externalAuths`, `_authOrigins`, `_mfas`, `_otps` | Auth session state |
| `_migrations` | Migration tracking |
| `_params` | PocketBase internal config |
| `users` | OAuth user records (re-created on first login) |
| `sqlite_stat*` | SQLite internal stats |

## Schema mismatches

If prod and dev differ (from migration drift), **the script fails by default**. A dropped column or table silently seeding as empty hid a real bug (#1338), so drift is a hard error:

- **Extra tables or columns in prod** (removed migrations): reported as `WARNING`, then the run stops
- **Extra tables or columns in dev** (new migrations): reported the same way
- **Common tables**: copied with an explicit column list

Re-run with `--allow-skip` when the drift is intentional. The script then warns and carries on: shared columns are copied and drifted columns or tables are skipped.

```bash
uv run python scripts/setup/seed_from_prod.py --allow-skip
```

## Worktree usage

In a worktree, `new.sh` seeds the DB from main. To test with real data, copy `data-prod.db` into the worktree's `pocketbase/pb_data/` directory and run the script there.
