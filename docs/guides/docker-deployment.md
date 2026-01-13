# Docker Production Deployment Guide

This guide explains how to deploy Kindred using Docker Compose in a production environment.

## Architecture Overview

The production deployment uses a **single-container architecture**:

```
Traefik (external) ─┐
                    │
                    ▼
┌────────────────────────────────────────────────────────┐
│  bunking container                                     │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Caddy :8080 (reverse proxy, main entry point)   │  │
│  │  └── Routes via docker/Caddyfile                 │  │
│  ├──────────────────────────────────────────────────┤  │
│  │  PocketBase :8090                                │  │
│  │  ├── Frontend (/)                                │  │
│  │  ├── /api/collections/*                          │  │
│  │  ├── /api/custom/* (sync)                        │  │
│  │  └── Admin (/_/*)                                │  │
│  ├──────────────────────────────────────────────────┤  │
│  │  FastAPI :8000                                   │  │
│  │  ├── /api/solver/*                               │  │
│  │  ├── /api/scenarios/*                            │  │
│  │  ├── /api/social-graph/*                         │  │
│  │  └── /api/config                                 │  │
│  └──────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┘
```

| Service | Port | Technology | Purpose |
|---------|------|------------|---------|
| **bunking** | 8080 | Caddy + Go + Python + SQLite | Combined container |

**bunking** runs all three services via supervisor:
- **Caddy (8080)**: Reverse proxy, routing (main entry point)
- **PocketBase (8090)**: Database, auth, CampMinder sync, embedded frontend
- **FastAPI (8000)**: Solver, social graphs, scenarios, validation

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
# Pull latest image
docker compose pull

# Start service
docker compose up -d

# Check logs
docker compose logs -f
```

### 2. Initial Setup

After first deployment:

1. Run initial data sync:
```bash
curl -X POST "http://localhost:8080/api/custom/sync/daily"
```

2. Access the application:
- Frontend: https://bunking.yourdomain.com
- PocketBase Admin: https://bunking.yourdomain.com/_/

## Service URLs (internal)

These are internal container ports. Access via Traefik in production:

- Caddy proxy: http://localhost:8080 (main entry point)
- PocketBase: http://127.0.0.1:8090 (internal)
- FastAPI: http://127.0.0.1:8000 (internal)

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
- `/` - React app served from PocketBase `/pb_public`

## Data Management

### Backup PocketBase Data

```bash
# Create backup
docker exec bunking \
  sqlite3 /pb_data/data.db ".backup /pb_data/backup-$(date +%Y%m%d).db"

# Copy backup to host
docker cp bunking:/pb_data/backup-*.db ./backups/
```

### Sync Schedules

Syncs are managed via Go scheduler in PocketBase. Trigger manually:

```bash
# Full daily sync (sessions, persons, bunks, attendees, requests)
curl -X POST "http://localhost:8080/api/custom/sync/daily"

# Specific sync
curl -X POST "http://localhost:8080/api/custom/sync/sessions"
curl -X POST "http://localhost:8080/api/custom/sync/attendees"
```

## Health Checks

```bash
# Check service status
docker compose ps

# Test health (via Caddy - validates entire stack)
curl http://localhost:8080/health

# Test internal services (from inside container)
docker exec bunking curl -s http://127.0.0.1:8090/api/health
docker exec bunking curl -s http://127.0.0.1:8000/health
```

## Docker Image

Kindred uses a **single Docker image**:

| Image | Purpose |
|-------|---------|
| `ghcr.io/adamflagg/kindred` | Combined Caddy + PocketBase + FastAPI |

## CI/CD Workflow

### CI (runs on every push)
- Linting and type checking
- Unit tests
- Fast feedback (~2-3 minutes)

### CD (runs on version tags)
- Builds Docker image
- Security scanning with Trivy
- Integration testing
- Pushes to GitHub Container Registry

### Creating a Release

```bash
# Preview what would be released
./scripts/release.sh --dry-run

# Create release (runs checks, creates tag, pushes)
./scripts/release.sh
```

### Pulling Image

```bash
# Pull latest image
docker pull ghcr.io/adamflagg/kindred:latest

# Pull specific version (Docker tags don't have 'v' prefix)
docker pull ghcr.io/adamflagg/kindred:1.2.0
```

## Security

### Network Isolation

- Only port 8080 (Caddy) is exposed to Traefik
- Internal services (PocketBase, FastAPI) communicate via localhost
- All external traffic routes through Caddy

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

1. Check logs: `docker compose logs bunking`
2. Verify environment variables in `.env`
3. Ensure Traefik network exists: `docker network ls`

### Data Sync Failures

1. Verify CampMinder credentials in `.env`
2. Check network connectivity: `docker exec bunking ping api.campminder.com`
3. Review sync logs: `docker compose logs bunking | grep sync`

### Routing Issues

1. Check container is healthy: `docker compose ps`
2. Verify Caddyfile syntax: `docker exec bunking caddy validate --config /etc/caddy/Caddyfile`
3. Test internal routing: `docker exec bunking curl -s http://127.0.0.1:8090/api/health`

### OAuth Not Working

1. Verify OIDC_ISSUER is accessible
2. Check redirect URI matches your domain
3. Review PocketBase logs: `docker compose logs bunking | grep oauth`
