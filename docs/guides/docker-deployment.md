# Docker Production Deployment Guide

This guide explains how to deploy Kindred using Docker Compose in a production environment.

## Architecture Overview

The production deployment uses a **multi-container architecture** with 4 Docker containers:

```text
Traefik (external) ─┐
                    │
                    ▼
┌─────────────────────────────────────────────────────────┐
│  kindred-caddy :8080                                    │
│  Reverse proxy + frontend static files                  │
│  Routes via docker/Caddyfile                            │
├─────────────────────────────────────────────────────────┤
│  kindred-pocketbase :8090                               │
│  ├── /api/collections/* (Database API)                  │
│  ├── /api/custom/* (Go sync)                            │
│  └── /_/* (Admin UI)                                    │
├─────────────────────────────────────────────────────────┤
│  kindred-api :8000                                      │
│  ├── /api/solver/*                                      │
│  ├── /api/scenarios/*                                   │
│  ├── /api/social-graph/*                                │
│  └── /api/config                                        │
├─────────────────────────────────────────────────────────┤
│  kindred-init (one-shot)                                │
│  Admin user + OIDC setup on first run                   │
└─────────────────────────────────────────────────────────┘
```

| Container | Image | Technology | Purpose |
|-----------|-------|------------|---------|
| **kindred-caddy** | `ghcr.io/adamflagg/kindred-caddy` | Caddy (distroless) | Reverse proxy, frontend |
| **kindred-pocketbase** | `ghcr.io/adamflagg/kindred-pocketbase` | Go (distroless) | Database, auth, sync |
| **kindred-api** | `ghcr.io/adamflagg/kindred-api` | Python + Wolfi | Solver, social graphs |
| **kindred-init** | `ghcr.io/adamflagg/kindred-init` | Go + Wolfi | One-shot admin/OIDC setup |

## Prerequisites

- Docker and Docker Compose installed
- Traefik (or other reverse proxy) configured for HTTPS
- CampMinder API credentials
- AI provider API key (OpenAI)

## Configuration Setup

### 1. Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Edit `.env` with your values:
```env
# CampMinder API Credentials
CAMPMINDER_API_KEY=your_api_key_here
CAMPMINDER_PRIMARY_KEY=your_primary_key_here
CAMPMINDER_CLIENT_ID=337
CAMPMINDER_SEASON_ID=2025

# AI Provider Configuration
AI_PROVIDER=openai
AI_API_KEY=your_openai_api_key_here
AI_MODEL=gpt-4.1-mini

# PocketBase Admin (first-run setup)
POCKETBASE_ADMIN_EMAIL=admin@example.com
POCKETBASE_ADMIN_PASSWORD=secure_password_here

# OIDC (OAuth2 auto-discovery) - optional
OIDC_ISSUER=https://your-pocket-id.com
OIDC_CLIENT_ID=your-client-id
OIDC_CLIENT_SECRET=your-client-secret

# Docker deployment
IMAGE_TAG=latest
PROXY_NETWORK=web-proxy
APPDATA_DIR=/path/to/appdata
DOMAIN_NAME=yourdomain.com
SUB_BUNKING=bunking
TZ=America/Los_Angeles
```

### 2. Configuration Files

Configuration files are optional and use sensible defaults:

```bash
mkdir -p config
cp config/ai_config.json config/
cp config/bunking_config.json config/
```

- `config/ai_config.json` - AI processing settings, confidence thresholds
- `config/bunking_config.json` - Solver weights, cabin assignment rules

## Deployment

### 1. Pull and Start Services

```bash
# Pull latest images
docker compose pull

# Start all services
docker compose up -d

# Check logs
docker compose logs -f
```

### 2. Initial Setup

After first deployment:

1. Run initial data sync:
```bash
curl -X POST "http://localhost:8080/api/custom/sync/run?year=2025&service=all"
```

2. Access the application:
- Frontend: <https://bunking.yourdomain.com>
- PocketBase Admin: <https://bunking.yourdomain.com/_/>

## Service URLs (internal)

These are internal container ports. Access via Traefik in production:

- Caddy proxy: <http://localhost:8080> (main entry point)
- PocketBase: <http://kindred-pocketbase:8090> (internal network)
- FastAPI: <http://kindred-api:8000> (internal network)

## Routing

Caddy routes requests based on path patterns (see `docker/Caddyfile`):

**PocketBase routes (8090):**
- `/api/collections/*` - Database API
- `/api/files/*` - File uploads
- `/api/realtime` - WebSocket subscriptions
- `/api/custom/*` - Go sync endpoints
- `/api/oauth2-redirect` - OAuth callbacks
- `/_/*` - Admin UI

**FastAPI routes (8000):**
- `/api/solver/*` - Solver endpoints
- `/api/scenarios/*` - Scenario management
- `/api/social-graph/*` - Social network graphs
- `/api/config` - Configuration
- `/api/*` - All other API routes (catch-all)

**Frontend:**
- `/` - React app served as static files from Caddy

## Data Management

### Backup PocketBase Data

```bash
# Create backup
docker exec kindred-pocketbase \
  /usr/local/bin/pocketbase --dir=/pb_data backup create backup-$(date +%Y%m%d).zip

# Copy backup to host
docker cp kindred-pocketbase:/pb_data/backups/ ./backups/
```

### Sync Schedules

Syncs are managed via Go scheduler in PocketBase. Trigger manually:

```bash
# Full daily sync (sessions, persons, bunks, attendees, requests)
curl -X POST "http://localhost:8080/api/custom/sync/run?year=2025&service=all"

# Specific sync
curl -X POST "http://localhost:8080/api/custom/sync/sessions"
curl -X POST "http://localhost:8080/api/custom/sync/attendees"
```

## Health Checks

```bash
# Check all service status
docker compose ps

# Test health (via Caddy - validates entire stack)
curl http://localhost:8080/health

# Test individual services
docker exec kindred-api curl -s http://127.0.0.1:8000/health
```

## Docker Images

Kindred uses **4 Docker images**:

| Image | Purpose |
|-------|---------|
| `ghcr.io/adamflagg/kindred-caddy` | Caddy reverse proxy + frontend static files |
| `ghcr.io/adamflagg/kindred-pocketbase` | PocketBase database + CampMinder sync |
| `ghcr.io/adamflagg/kindred-api` | FastAPI solver, metrics, social graphs |
| `ghcr.io/adamflagg/kindred-init` | One-shot admin user + OIDC configuration |

## CI/CD Workflow

### CI (runs on every push)
- Linting and type checking
- Unit tests
- Fast feedback (~2-3 minutes)

### CD (runs on version tags)
- Builds all 4 Docker images
- Security scanning with Trivy
- Integration testing (full multi-container stack)
- Pushes to GitHub Container Registry

### Creating a Release

Release via GitHub Actions: **Actions → Release → Run workflow**. Leave version empty for auto-bump, or enter a version to override.

### Pulling Images

```bash
# Pull all latest images
docker compose pull

# Pull specific version (Docker tags don't have 'v' prefix)
docker pull ghcr.io/adamflagg/kindred-caddy:1.2.0
docker pull ghcr.io/adamflagg/kindred-pocketbase:1.2.0
docker pull ghcr.io/adamflagg/kindred-api:1.2.0
docker pull ghcr.io/adamflagg/kindred-init:1.2.0
```

## Security

### Network Isolation

- Only port 8080 (Caddy) is exposed to Traefik
- Internal services communicate via Docker bridge network (`kindred-internal`)
- PocketBase and API containers are not directly accessible from outside
- Caddy and PocketBase containers are distroless (no shell)

### Authentication

- PocketBase OAuth2 auto-configures from OIDC_ISSUER
- All API routes require authentication
- Admin UI requires superuser credentials

### Best Practices

- Never commit `.env` files to version control
- Use Traefik for TLS termination
- Regularly update Docker images for security patches
- Set up automated backups for PocketBase data

## Troubleshooting

### Service Won't Start

1. Check logs: `docker compose logs` (or specific service: `docker compose logs kindred-api`)
2. Verify environment variables in `.env`
3. Ensure Traefik network exists: `docker network ls`

### Data Sync Failures

1. Verify CampMinder credentials in `.env`
2. Review sync logs: `docker compose logs kindred-pocketbase | grep sync`

### Routing Issues

1. Check all containers are healthy: `docker compose ps`
2. Check Caddy logs: `docker compose logs kindred-caddy`

### OAuth Not Working

1. Verify OIDC_ISSUER is accessible
2. Check redirect URI matches your domain
3. Review PocketBase logs: `docker compose logs kindred-pocketbase | grep oauth`
