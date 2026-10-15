# CLI Commands Reference

This document provides a comprehensive reference for all command-line tools and scripts in Kindred.

## Table of Contents
- [Development Environment](#development-environment)
- [Data Synchronization](#data-synchronization)
- [Testing & Quality Assurance](#testing--quality-assurance)
- [Database Management](#database-management)
- [Deployment & Production](#deployment--production)
- [Configuration & Setup](#configuration--setup)
- [Diagnostics & Analysis](#diagnostics--analysis)
- [Frontend Development](#frontend-development)

## Development Environment

### Start Full Development Environment
```bash
./scripts/start_dev.sh
```
Starts all development services including PocketBase, frontend dev server, and any required background services.

### Create Admin User
```bash
./scripts/create_admin.sh
```
Creates an admin user for PocketBase using credentials from `.env` file.

### Testing PocketBase API from CLI

Most collections require authentication. To test API queries from the command line:

```bash
# Get admin token (PocketBase 0.23.0+ uses _superusers collection)
TOKEN=$(curl -s -X POST "http://127.0.0.1:8090/api/collections/_superusers/auth-with-password" \
  -H "Content-Type: application/json" \
  -d '{"identity":"admin@camp.local","password":"campbunking123"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

# Use token in subsequent requests
curl -s "http://127.0.0.1:8090/api/collections/bunk_assignments/records?filter=year%20%3D%202025&perPage=5" \
  -H "Authorization: $TOKEN" | python3 -m json.tool

# Filter by relation field
curl -s "http://127.0.0.1:8090/api/collections/bunk_assignments/records?filter=person.cm_id%20%3D%201000001&expand=person,session,bunk" \
  -H "Authorization: $TOKEN"
```

**Note**: Filter syntax requires URL encoding for spaces (`%20`). PocketBase supports filtering by relation fields like `person.cm_id`.

## Data Synchronization

### Process Bunk Requests (Modular Pipeline)
```bash
uv run python -m bunking.sync.bunk_request_processor.process_requests --session all [OPTIONS]

Options:
  --year YEAR          Year to process (default: 2025 — pass it explicitly)
  --session S          Required: 'all' for every bunking session, or a session cm_id
  --source-field F     Field(s) to process, repeatable (default: all fields)
  --test-limit N       Process only N requests for testing
  --clear-existing     Clear existing requests first
  --force              Clear 'processed' flags first (same logic as the Go API)
  --dry-run            Run without saving to database
  --debug / --trace    Debug / very verbose logging
```
Three-phase AI pipeline, run directly for debugging. The Go sync does not call this CLI: it calls
FastAPI's `POST /api/internal/process-requests`, which runs the same pipeline. Processes the
AI-assisted fields (bunk_with, not_bunk_with, bunking_notes, internal_notes).

### Sync Sibling Relationships
```bash
uv run python scripts/sync/sync_sibling_relationships.py
```
Syncs sibling data from CampMinder to establish family relationships.

### Rebuild Database (Interactive)
```bash
uv run python scripts/db/rebuild_database.py
```
Interactive database rebuild with prompts for each step.

### Rebuild Database (Automated)
```bash
uv run python scripts/sync/rebuild_database_auto.py
```
Non-interactive version of the rebuild above; it takes no options.

## Testing & Quality Assurance

### Quick Pre-Commit Checks
```bash
lefthook run pre-commit                                   # Formatters (staged files)
lefthook run pre-push                                     # Full lint + test suite
```
Lefthook hooks run automatically on commit/push. To run manually:
- `pre-commit`: Formatters on staged files (prettier, ruff format, gofmt)
- `pre-push`: Full linters + tests in parallel

**Setup:** `./scripts/setup-git-hooks.sh` (run once after cloning)

### Full Test Suite
```bash
./scripts/ci/run_all_tests.sh
```
Comprehensive test suite including:
- All Python tests with coverage
- Frontend tests with coverage
- Docker build verification
- Integration tests
- Performance benchmarks

**Run before production deployments!**

### Run Specific Python Tests
```bash
uv run pytest tests/path/to/test_file.py [OPTIONS]

Options:
  -v              Verbose output
  --tb=short      Shorter traceback format
  --cov=MODULE    Coverage for specific module
  -x              Stop on first failure
```

### Bunking-Specific Tests
```bash
uv run python tests/unit/sync/run_all_bunking_tests.py
```
Runs all tests related to bunking logic and solver operations.

### Audit Tests
```bash
uv run python tests/unit/sync/audit_tests.py
```
Analyzes the test suite and categorizes tests by CI suitability.

## Database Management

### Reset and Migrate
```bash
./scripts/reset_and_migrate.sh
```
Resets database to clean state and runs all migrations.

### Reset Migrations Only
```bash
./scripts/reset_migrations.sh
```
Clears migration history (useful for consolidating migrations).

### Full System Reset
```bash
./scripts/full_reset.sh
```
**WARNING**: Complete system reset including:
- Database deletion
- Migration reset
- Cache clearing
- State file removal

### Force WAL Checkpoint
```bash
uv run python scripts/db/force_wal_checkpoint.py
```
Forces SQLite Write-Ahead Log checkpoint (reduces database file size).

### Generate Schema Snapshot
```bash
uv run python scripts/db/generate_snapshot_migration.py
```
Creates a PocketBase migration snapshot of current schema.

## Deployment & Production

Deployment uses the GitHub Actions CD and Release workflows. See `docs/reference/git-workflow.md` (release process) and `docs/guides/docker-deployment.md`.

```bash
# Deploy from host machine (for CI/CD pipelines)
./scripts/deploy-bunking-from-host.sh
```

## Configuration & Setup

### Configure OAuth2
```bash
uv run python scripts/setup/configure_pocketbase_oauth.py
```
Configures PocketBase OAuth2 settings from environment variables.

### Update Solver Configuration
Solver weights live in the PocketBase `config` collection; edit them in **Manage › Config**
(see `docs/guides/solver-configuration.md`). There is no CLI for them.

## Diagnostics & Analysis

### Objective Sensitivity
```bash
uv run python scripts/analyze_objective_sensitivity.py
```
See `docs/reference/objective-sensitivity.md`.

### Request Statistics
```bash
uv run python scripts/request_stats.py   # raw CampMinder rows vs processed requests
```

## Frontend Development

Run these from `frontend/`.

### Start Development Server
```bash
npm run dev
```
Starts Vite development server with hot module replacement.
- Default: <http://localhost:3000> (a worktree gets its own port from `new.sh`)
- Proxies API requests to PocketBase

### Build Production Bundle
```bash
npm run build
```
Creates optimized production build in `dist/` directory.

### Type Checking
```bash
npm run type-check
```
Runs TypeScript compiler to check for type errors.

### Run Tests
```bash
npm run test              # Watch mode (vitest)
npm run test:run          # One-shot run
npm run test:coverage     # With coverage report
```

### Generate TypeScript Types
```bash
npm run generate-types        # PocketBase schema → pocketbase-types.ts
npm run generate:api-types    # FastAPI OpenAPI → types/api-generated/
npm run generate:all-types    # both
```

## Common Workflows

### Daily Development
```bash
# Start environment
./scripts/start_dev.sh

# Make changes...

# Before committing (hooks run automatically, or manually):
lefthook run pre-commit                                   # Formatters (staged files)
lefthook run pre-push                                     # Full lint + test suite

# Commit
git add -A
git commit -m "feat: your change"
git push
```

### Processing New Bunk Requests
```bash
# Usual path: through the Go API (handles auth, files the run under the season)
curl -X POST "http://127.0.0.1:8090/api/custom/sync/process-requests?year=2026" -H "Authorization: $TOKEN"   # bunking.manage user token

# Directly, for debugging: all sessions
uv run python -m bunking.sync.bunk_request_processor.process_requests --year 2026 --session all

# Test with limited requests
uv run python -m bunking.sync.bunk_request_processor.process_requests --year 2026 --session all --test-limit 10 --debug
```

### Production Deployment
```bash
# Full test suite
./scripts/ci/run_all_tests.sh

# Deploy via GitHub Actions Release workflow
# GitHub -> Actions -> Release -> Run workflow

# Monitor logs
docker compose logs -f
```

### Database Maintenance
```bash
# Regular maintenance
uv run python scripts/db/force_wal_checkpoint.py

# After major changes
./scripts/reset_and_migrate.sh

# Complete rebuild
uv run python scripts/sync/rebuild_database_auto.py
```

## Environment Variables

Key environment variables used by scripts:
- `CAMPMINDER_API_KEY` - CampMinder API authentication
- `CAMPMINDER_CLIENT_ID` - CampMinder client identifier  
- `CAMPMINDER_SEASON_ID` - Optional override of the primary season (it otherwise rolls over on Oct 15 Pacific)
- `POCKETBASE_URL` - PocketBase API endpoint
- `POCKETBASE_ADMIN_EMAIL` - Admin credentials
- `POCKETBASE_ADMIN_PASSWORD` - Admin credentials
- `AI_PROVIDER` - AI provider (`openai`; `mock` for tests)
- `AI_API_KEY` - AI provider API key
- `AI_MODEL` - Model name (e.g. `gpt-5-nano`)

See [Configuration Reference](./configuration.md) for complete list.

## Exit Codes

Standard exit codes used by scripts:
- `0` - Success
- `1` - General error
- `2` - Configuration error
- `3` - Connection error
- `4` - Data validation error
- `5` - Test failure

## Tips & Best Practices

1. **Run Python through `uv run`** (uv manages the virtualenv)
2. **Run quick checks** before every commit
3. **Use --debug flag** when troubleshooting
4. **Check logs**: `docker compose logs <service>`, or the dev server's terminal output
5. **Backup database** before major operations
6. **Use test limits** when testing new sync logic
7. **Monitor memory usage** for large operations
8. **Force WAL checkpoint** after bulk operations

## Related Documentation

- [Configuration Reference](./configuration.md) - All configuration options
- [Staff Guides](../guides/staff/) - UI and workflow guides
- [Troubleshooting](../guides/troubleshooting.md) - Common issues and solutions