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

### Start PocketBase with OAuth
```bash
./scripts/start_pocketbase_with_oauth.sh
```
Starts PocketBase with OAuth2 configuration automatically applied from environment variables.

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
curl -s "http://127.0.0.1:8090/api/collections/bunk_assignments/records?filter=person.cm_id%20%3D%2011444220&expand=person,session,bunk" \
  -H "Authorization: $TOKEN"
```

**Note**: Filter syntax requires URL encoding for spaces (`%20`). PocketBase supports filtering by relation fields like `person.cm_id`.

## Data Synchronization

### Process Bunk Requests (Modular Pipeline)
```bash
./venv/bin/python -m bunking.sync.bunk_request_processor.process_requests [OPTIONS]

Options:
  --year YEAR      Year to process (default: from config)
  --session N      Session number (0=all, 1-4=specific)
  --test-limit N   Process only N requests for testing
  --dry-run        Run without saving to database
  --debug          Enable debug logging
```
Three-phase AI pipeline called by Go orchestrator. Processes AI-assisted fields (bunk_with, not_bunk_with, bunking_notes, internal_notes).

### Sync Sibling Relationships
```bash
./venv/bin/python scripts/sync/sync_sibling_relationships.py
```
Syncs sibling data from CampMinder to establish family relationships.

### Rebuild Database (Interactive)
```bash
./venv/bin/python scripts/sync/rebuild_database.py
```
Interactive database rebuild with prompts for each step.

### Rebuild Database (Automated)
```bash
./venv/bin/python scripts/sync/rebuild_database_auto.py [OPTIONS]

Options:
  --year YEAR      Specific year to rebuild (default: current year)
  --all-years      Rebuild all years
  --skip-backup    Skip database backup
```
Automated complete database rebuild from CampMinder data.

### Three-Phase Request Processor
```bash
./venv/bin/python bunking/sync/bunk_request_processor/process_requests.py [OPTIONS]

Options:
  --phase PHASE    Run specific phase (parse/validate/store)
  --session-id ID  Process specific session
  --force          Force reprocessing
```
Advanced three-phase processing pipeline for bunk requests.

## Testing & Quality Assurance

### Quick Pre-Commit Checks
```bash
./scripts/ci/quick_check.sh
```
Runs fast checks including:
- Python linting (ruff)
- TypeScript type checking
- Go formatting and linting
- Basic smoke tests

**Always run before committing!**

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
./venv/bin/python -m pytest scripts/test/TEST_FILE.py [OPTIONS]

Options:
  -v              Verbose output
  --tb=short      Shorter traceback format
  --cov=MODULE    Coverage for specific module
  -x              Stop on first failure
```

### Bunking-Specific Tests
```bash
./venv/bin/python scripts/test/run_all_bunking_tests.py
```
Runs all tests related to bunking logic and solver operations.

### Audit Tests
```bash
./venv/bin/python scripts/test/audit_tests.py
```
Runs data integrity audits and validation checks.

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
./venv/bin/python scripts/force_wal_checkpoint.py
```
Forces SQLite Write-Ahead Log checkpoint (reduces database file size).

### Generate Schema Snapshot
```bash
./venv/bin/python scripts/generate_snapshot_migration.py
```
Creates a PocketBase migration snapshot of current schema.

## Deployment & Production

### Deploy to Production
```bash
./scripts/deploy_production.sh
```
Deploys to production with safety checks:
- Runs tests
- Builds Docker images
- Creates backup
- Performs health checks
- Automatic rollback on failure

### Rollback Deployment
```bash
./scripts/rollback.sh
```
Emergency rollback to previous deployment version.

### Deploy from Host
```bash
./scripts/deploy-bunking-from-host.sh
```
Deploy from host machine (for CI/CD pipelines).

### Wait for Health
```bash
./scripts/wait_for_healthy.sh [CONTAINER_NAME] [TIMEOUT]
```
Waits for container health checks to pass.

## Configuration & Setup

### Prepare for New Year
```bash
./venv/bin/python scripts/prepare_for_new_year.py YEAR

Example:
  python scripts/prepare_for_new_year.py 2026
```
Updates configuration for new camp year.

### Configure OAuth2
```bash
./venv/bin/python scripts/configure_pocketbase_oauth.py
```
Configures PocketBase OAuth2 settings from environment variables.

### Update Solver Configuration
```bash
./venv/bin/python scripts/update_solver_fairness_config.py [OPTIONS]

Options:
  --priority-weight VALUE    Update priority weight
  --fairness-weight VALUE    Update fairness weight
  --reset                    Reset to defaults
```

### Enable Public Read Access
```bash
./venv/bin/python scripts/setup/enable_public_read_access.py
```
Enables public read access for specified collections.

## Diagnostics & Analysis

### Schema Diagnostics
```bash
./venv/bin/python scripts/diagnostic_tool_v2.py [OPTIONS]

Options:
  --collections    List all collections
  --fields         Show field details
  --indexes        Show database indexes
  --validate       Validate schema integrity
```

### Analyze Attendees
```bash
./venv/bin/python scripts/sync/analyze_attendees.py [OPTIONS]

Options:
  --session-id ID  Analyze specific session
  --stats          Show statistics
  --duplicates     Find duplicate records
```

### Test API Differences
```bash
./venv/bin/python scripts/test_person_api_differences.py
```
Compares CampMinder API responses for consistency.

### Example Analysis
```bash
./venv/bin/python scripts/example_analysis.py
```
Runs example data analysis for demonstration purposes.

## Frontend Development

### Start Development Server
```bash
npm run dev
```
Starts Vite development server with hot module replacement.
- Default: http://localhost:5173
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
npm run test              # Run tests
npm run test:watch        # Watch mode
npm run test:coverage     # With coverage report
```

### Generate TypeScript Types
```bash
npm run generate-types
```
Generates TypeScript types from PocketBase schema.

## Common Workflows

### Daily Development
```bash
# Start environment
./scripts/start_dev.sh

# Make changes...

# Before committing
./scripts/ci/quick_check.sh

# Commit
git add -A
git commit -m "feat: your change"
git push
```

### Processing New Bunk Requests
```bash
# Process all sessions with modular pipeline (called by Go orchestrator)
./venv/bin/python -m bunking.sync.bunk_request_processor.process_requests --session 0

# Or specific session
./venv/bin/python -m bunking.sync.bunk_request_processor.process_requests --session 1

# Test with limited requests
./venv/bin/python -m bunking.sync.bunk_request_processor.process_requests --test-limit 10 --debug
```

### Production Deployment
```bash
# Full test suite
./scripts/ci/run_all_tests.sh

# Deploy if tests pass
./scripts/deploy_production.sh

# Monitor logs
docker compose logs -f
```

### Database Maintenance
```bash
# Regular maintenance
./venv/bin/python scripts/force_wal_checkpoint.py

# After major changes
./scripts/reset_and_migrate.sh

# Complete rebuild
./venv/bin/python scripts/sync/rebuild_database_auto.py
```

## Environment Variables

Key environment variables used by scripts:
- `CAMPMINDER_API_KEY` - CampMinder API authentication
- `CAMPMINDER_CLIENT_ID` - CampMinder client identifier  
- `CAMPMINDER_SEASON_ID` - Current camp season
- `POCKETBASE_URL` - PocketBase API endpoint
- `POCKETBASE_ADMIN_EMAIL` - Admin credentials
- `POCKETBASE_ADMIN_PASSWORD` - Admin credentials
- `AI_PROVIDER` - AI provider (openai/anthropic/ollama)
- `OPENAI_API_KEY` - OpenAI API key (if using)
- `ANTHROPIC_API_KEY` - Anthropic API key (if using)

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

1. **Always use virtual environment** for Python scripts
2. **Run quick checks** before every commit
3. **Use --debug flag** when troubleshooting
4. **Check logs** in `logs/` directory for details
5. **Backup database** before major operations
6. **Use test limits** when testing new sync logic
7. **Monitor memory usage** for large operations
8. **Force WAL checkpoint** after bulk operations

## Related Documentation

- [Configuration Reference](./configuration.md) - All configuration options
- [Staff Guides](../guides/staff/) - UI and workflow guides
- [Troubleshooting](../guides/troubleshooting.md) - Common issues and solutions