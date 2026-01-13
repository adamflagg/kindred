# Kindred

Kindred finds campers who belong together and places them in the right cabins.

A cabin assignment system that puts relationships first. Using constraint satisfaction and social network analysis, it finds campers who are kindred — compatible, connected, belonging together — and builds cabin communities where friendships thrive.

[![CI](https://github.com/adamflagg/kindred/actions/workflows/ci.yml/badge.svg)](https://github.com/adamflagg/kindred/actions/workflows/ci.yml)
[![CD](https://github.com/adamflagg/kindred/actions/workflows/cd.yml/badge.svg?event=release)](https://github.com/adamflagg/kindred/actions/workflows/cd.yml)

## Quick Start

```bash
git clone https://github.com/adamflagg/kindred.git
cd kindred
./scripts/start_dev.sh
```

- App: http://localhost:8080 (via Caddy)
- PocketBase Admin: http://localhost:8080/_/
- Vite Dev Server: http://localhost:3000 (HMR)

## Features

- **Constraint solver**: OR-Tools optimization respecting age, grade, and friend requests
- **Drag-and-drop interface**: Visual cabin management
- **Scenario planning**: Test changes before applying
- **CampMinder sync**: Automated data synchronization
- **Historical data**: View past years for returning campers

## Architecture

```
CampMinder API → Go Sync → PocketBase ← React Frontend
                               ↓
                         FastAPI Solver
```

| Component | Technology |
|-----------|------------|
| Database | PocketBase (Go + SQLite) |
| Solver | FastAPI + Google OR-Tools |
| Frontend | React 19, TypeScript, Tailwind |
| Sync | Go services with layered dependencies |

## Requirements

- Python 3.12+
- Node.js 22+
- Go 1.24+
- Ubuntu 24.04 LTS (or compatible)

## Development

```bash
# Start services
./scripts/start_dev.sh

# Quick checks before commit
./scripts/ci/quick_check.sh

# Full test suite
./scripts/ci/run_all_tests.sh

# Frontend
cd frontend && npm run dev

# Sync data
curl -X POST http://localhost:8090/api/custom/sync/daily
```

## Configuration

Copy `.env.example` to `.env` and configure:

```bash
# CampMinder API (required for sync)
CAMPMINDER_API_KEY=your-api-key
CAMPMINDER_PRIMARY_KEY=your-subscription-key
CAMPMINDER_CLIENT_ID=your-client-id
CAMPMINDER_SEASON_ID=2025

# PocketBase admin
POCKETBASE_ADMIN_EMAIL=admin@camp.local
POCKETBASE_ADMIN_PASSWORD=your-password

# AI parsing (required for bunk requests)
AI_API_KEY=your-openai-key

# OIDC auth (production)
OIDC_ISSUER=https://your-oidc-provider.com
OIDC_CLIENT_ID=your-client-id
OIDC_CLIENT_SECRET=your-secret
```

See `.env.example` for full configuration options.

## Testing

```bash
# Python
pytest tests/

# Go
cd pocketbase && go test ./...

# Frontend
cd frontend && npm test
```

CI runs linting and tests on every push. CD builds Docker images on version tags (`v*`).

## Deployment

```bash
# Preview release (shows suggested version and changelog)
./scripts/release.sh --dry-run

# Create release (validates, tags, pushes)
./scripts/release.sh

# After CD workflow completes (~15 min):
docker compose pull && docker compose up -d
```

The release script uses [git-cliff](https://git-cliff.org/) to analyze commits and suggest semver versions automatically.

## Documentation

- [Development Guide](docs/guides/development.md)
- [Architecture Overview](docs/architecture/overview.md)
- [Sync Operations](docs/guides/sync-operations.md)
- [CLI Reference](docs/reference/cli-commands.md)
- [Full Index](docs/README.md)

## Contributing

1. Follow the [Development Guide](docs/guides/development.md)
2. Write tests for new features
3. Run `./scripts/ci/quick_check.sh` before committing
4. Submit pull requests for review

## License

AGPL-3.0-or-later — See [LICENSE](LICENSE) for details.

**Nonprofits and educational institutions:** Free to use.

**Commercial licensing:** Contact kindred@flagg.moi
