# Kindred

**Kindred finds campers who belong together and places them in the right cabins** — and gives camps the analytics to understand their enrollment, retention, and community at a depth spreadsheets can't reach.

A relationship-first cabin assignment platform for summer camps, built on a constraint solver, a CampMinder data integration, and a full analytics suite.

<!-- TODO: hero screenshot — bunking UI with social graph overlay or scenario comparison -->
<!-- ![Kindred](docs/assets/hero.png) -->

---

## What Kindred Does

Kindred is organized into two main areas of the app:

### Summer Bunking

The core cabin assignment workflow for the main summer season.

- **Constraint solver** (Google OR-Tools) — respects age, grade, gender, cabin capacity, friend requests, and custom staff preferences
- **Drag-and-drop UI** — move campers between cabins with real-time validation, lock groups, and visual indicators for conflicts
- **Scenario planning & comparison** — fork the current assignment, experiment, and compare scenarios side-by-side before committing
- **Social network graph** — interactive Cytoscape visualization of friend requests across the camper population, by session/bunk/age group
- **Bunk request pipeline** — CSV upload → AI parsing (GPT-5-nano) → name disambiguation → reviewable request queue, with full pipeline debug traces and a prompt editor for tuning

<!-- TODO: screenshot — summer bunking drag-and-drop + social graph -->
<!-- ![Summer Bunking](docs/assets/summer-bunking.png) -->

### Camp Analytics

A full analytics dashboard for year-over-year operational insight. Organized into three sections:

- **Registration** — Overview, geography (heatmaps + drill-down by region/school), waitlist analysis, session availability, enrollment forecasting vs. budget goals, cancellations, and Day 1 readiness
- **Retention** — Returning-camper rates, session-flow Sankey diagrams, per-bunk retention, per-staff cabin cohort analysis
- **Trends** — Enrollment velocity week-over-week, cancellation velocity, phase-based progress tracking against prior years

<!-- TODO: screenshot — analytics forecast page or Sankey flow -->
<!-- ![Camp Analytics](docs/assets/analytics.png) -->

---

## Architecture

```text
CampMinder API  ──►  Go Sync Services  ──┐
                                         │
         React Frontend  ◄──────────────►│──►  4 Docker Containers
                                         │
                OR-Tools Solver  ◄───────┘
```

| Container | Port | Stack | Purpose |
|-----------|------|-------|---------|
| `kindred-caddy` | 8080 | Caddy + static build | Reverse proxy, frontend serving, TLS |
| `kindred-pocketbase` | 8090 | Go + SQLite | Database, auth (OIDC), CampMinder sync, RBAC |
| `kindred-api` | 8000 | Python 3.14 + FastAPI | Solver, analytics, social graph, scenarios |
| `kindred-init` | — | Go + shell | One-shot admin/OIDC bootstrap |

**Routing** follows an inverse pattern: Caddy routes explicit PocketBase paths (`/api/collections/*`, `/api/files/*`, `/api/realtime`, `/api/custom/*`, `/api/oauth2-redirect`); all other `/api/*` traffic goes to FastAPI. New FastAPI endpoints work automatically without Caddy config changes.

**Data integrity**: Cross-table relationships use PocketBase expandable relations (`expand=person,session,bunk`) for efficient joins, with CampMinder IDs retained alongside for sync lookups. Every CampMinder-sourced record is year-scoped so reused session IDs across years can never contaminate each other.

**Production deployment**: In production we put Caddy behind a separate edge proxy (Traefik + CrowdSec) that handles TLS, rate limiting, bot/WAF rules, and IP reputation. Caddy's role is reduced to internal routing; see [docs/guides/docker-deployment.md](docs/guides/docker-deployment.md).

---

## Tech Stack

- **Frontend**: React 19, TypeScript 5.8, Vite, Tailwind CSS, React Query, @dnd-kit, Cytoscape.js
- **Backend API**: Python 3.14+, FastAPI, Google OR-Tools, Pydantic v2
- **Database & Auth**: PocketBase (Go 1.26+) on SQLite (WAL), OIDC auto-discovery for SSO
- **Sync & Integrations**: Go services for CampMinder, Google Sheets/Drive, OpenAI (GPT-5-nano for bunk request parsing)
- **Infrastructure**: Docker, Caddy, GitHub Actions CI/CD, Trivy security scanning
- **Dev tooling**: `uv` for Python, `lefthook` for git hooks, ruff / mypy / golangci-lint / eslint / prettier

---

## Quick Start

```bash
git clone https://github.com/adamflagg/kindred.git
cd kindred
cp .env.example .env        # fill in credentials (see Configuration below)
./scripts/start_dev.sh
```

Once services are up:

- **App**: <http://localhost:8080> (Caddy, production-like routing)
- **Vite dev server**: <http://localhost:3000> (HMR for frontend development)
- **PocketBase Admin**: <http://localhost:8080/_/>

Trigger a CampMinder sync:

```bash
curl -X POST "http://localhost:8090/api/custom/sync/run?year=2025&service=all"
```

---

## Configuration

Environment variables live in `.env` (see `.env.example` for the full list):

```bash
# PocketBase admin bootstrap
POCKETBASE_ADMIN_EMAIL=admin@camp.local
POCKETBASE_ADMIN_PASSWORD=your-password

# AI (bunk request parsing & disambiguation)
AI_API_KEY=your-openai-key
AI_MODEL=gpt-5-nano
AI_PROVIDER=openai

# SSO (any OIDC provider: Pocket ID, Authentik, Auth0, Keycloak, etc.)
OIDC_ISSUER=https://your-oidc-provider.com
OIDC_CLIENT_ID=your-client-id
OIDC_CLIENT_SECRET=your-secret

# CampMinder sync
CAMPMINDER_SEASON_ID=2025
# (CampMinder API credentials as documented in .env.example)
```

Operational config (solver weights, AI thresholds, session hierarchy, budget goals) lives in the PocketBase `config` collection and is editable through the **Admin → Config** UI — not through static files.

---

## Testing

```bash
# Python
uv run pytest tests/
uv run pytest tests/ -k "keyword"

# Go
cd pocketbase && go test ./...

# Frontend
cd frontend && npx vitest run
```

Pre-push hooks (via `lefthook`) run type checks, linters, and fast unit tests. Run `./scripts/setup-git-hooks.sh` once after cloning to install them.

---

## Deployment

Production runs the four containers behind Traefik/CrowdSec. CI runs on every push (~2–3 min); CD builds and pushes Docker images on every merge to `main` (~10–15 min), tagged `latest` and `sha-<commit>`.

Releases are cut through **GitHub Actions → Release → Run workflow** — the workflow promotes existing `sha-<commit>` images to a version tag (e.g. `v1.2.0`), creates the git tag, and publishes a GitHub release. Auto-versioning uses [git-cliff](https://git-cliff.org/); an explicit version can be entered to override.

Pulling the latest images into a running deployment:

```bash
docker compose pull && docker compose up -d
```

See [docs/guides/docker-deployment.md](docs/guides/docker-deployment.md) for full production setup, including OIDC, reverse-proxy, and backup configuration.

---

## Documentation

- [Full documentation index](docs/README.md)
- [Modernization backlog](docs/reference/modernization-backlog.md) — what language/tooling features we're not yet using
- [Data model](docs/architecture/data-model.md)
- [Sync layer architecture](docs/architecture/sync-layer.md)
- [Bunk request pipeline](docs/architecture/bunk-request-pipeline.md)
- [Metrics module](docs/architecture/metrics-module.md)
- [Session types & bunking structure](docs/architecture/session-types.md)
- [Staff guides](docs/guides/staff/)
- [Solver configuration](docs/guides/solver-configuration.md)
- [CSV preparation](docs/guides/csv-preparation.md)
- [CLI reference](docs/reference/cli-commands.md)
- [Troubleshooting](docs/guides/troubleshooting.md)
- [CLAUDE.md](CLAUDE.md) — primary developer reference (architecture, conventions, quality standards)

---

## Contributing

1. Read [CLAUDE.md](CLAUDE.md) for conventions (commit scopes, TDD, worktree workflow)
2. Run `./scripts/setup-git-hooks.sh` once to install lefthook
3. Create a feature branch (or a worktree via `./scripts/worktree/new.sh <name>`)
4. Write tests first, then implementation
5. Open a pull request — CI must pass before merge (squash-only, no direct pushes to `main`)

---

## License

**AGPL-3.0-or-later** — see [LICENSE](LICENSE).

- **Nonprofits and educational institutions**: free to use.
- **Commercial licensing**: contact <kindred@flagg.moi>
