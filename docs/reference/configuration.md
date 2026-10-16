# Configuration Reference

Where Kindred's configuration lives, and the environment variables that matter.

Configuration comes from three places:

1. **Environment variables** (`.env`): secrets, service wiring, deployment. This file's main subject.
2. **The PocketBase `config` collection**: runtime values staff can edit, such as solver weights. See [Runtime Configuration (Database)](#runtime-configuration-database).
3. **Code constants**: values nobody tunes at runtime, for example the AI confidence thresholds. See [AI Configuration](#ai-configuration).

[`.env.example`](../../.env.example) is the maintained list of every variable, with comments. Copy it to `.env` and fill it in. When the two disagree, `.env.example` wins.

## Table of Contents
- [Environment Variables (.env)](#environment-variables-env)
- [Runtime Configuration (Database)](#runtime-configuration-database)
- [AI Configuration](#ai-configuration)
- [Docker Configuration](#docker-configuration)
- [Frontend Configuration](#frontend-configuration)
- [Configuration Precedence](#configuration-precedence)
- [Troubleshooting Configuration](#troubleshooting-configuration)

## Environment Variables (.env)

The `.env` file holds secrets and deployment settings. Secrets managers work too (Infisical, Doppler); the start scripts detect them through `scripts/env-provider.sh`.

**Applying changes:** `docker compose restart` does not re-read `.env`. After editing it, run `docker compose up -d`, which recreates any container whose environment changed. In local development, restart `./scripts/start_dev.sh`.

### CampMinder API Configuration
```bash
# Required for sync
CAMPMINDER_API_KEY=your-api-key-here
CAMPMINDER_PRIMARY_KEY=your-primary-subscription-key
CAMPMINDER_SECONDARY_KEY=your-secondary-subscription-key
CAMPMINDER_CLIENT_ID=your-client-id

# Optional: pin the primary season (2017-2050). Leave unset.
# CAMPMINDER_SEASON_ID=2026
```

The season needs no variable. It rolls over by itself at the start of Oct 15 in Pacific time (`pocketbase/sync/year.go`), and sync covers that season and the one before it. `CAMPMINDER_SEASON_ID` pins the season when set; an empty value counts as unset, and an invalid or out-of-range value is an error. `docker-compose.yml` passes the variable through (empty when absent from `.env`), and `docker-compose.local.yml` now does the same, so local Docker follows the rule unless you pin a year.

### PocketBase Configuration
```bash
# Kindred's SERVICE superuser, used by the solver and sync services to authenticate
POCKETBASE_ADMIN_EMAIL=kindred-service@kindred.invalid
POCKETBASE_ADMIN_PASSWORD=secure-password-here

# Service location (defaults suit local development)
POCKETBASE_URL=http://127.0.0.1:8090
POCKETBASE_PORT=8090
```

The standard PocketBase image needs the superuser created by hand on first run; `.env.example` shows the command. Use IPv4 (`127.0.0.1`, not `localhost`) for inter-service addresses. `DEV_POCKETBASE_EMAIL` and `DEV_POCKETBASE_PASSWORD` are local-development defaults that appear only in `.env.example`.

### AI Provider Configuration
```bash
# Supported: openai (production), mock (tests)
AI_PROVIDER=openai
AI_API_KEY=your-ai-api-key
AI_MODEL=gpt-5-nano
```

These three variables are the whole provider surface (`bunking/config/loader.py`). `provider_factory.py` supports `openai` and `mock` only; any other value, including `anthropic` or `ollama`, raises "Unsupported provider". Thresholds and processing behavior are not environment variables; see [AI Configuration](#ai-configuration).

### Jotform Configuration
```bash
# Required (secret): Adult-weekend Jotform pull (kindred#2759)
# When unset, the nightly job is skipped and "Pull now" fails fast.
# Read by the pocketbase service.
JOTFORM_API_KEY=your-jotform-api-key-here

# Optional: API endpoint override for enterprise accounts
# Default: https://api.jotform.com
# JOTFORM_API_BASE=https://<team>.jotform.com/API
```

### Google Sheets Export (Optional)
```bash
GOOGLE_SHEETS_ENABLED=false
GOOGLE_DRIVE_FOLDER_ID=            # Exports folder
GOOGLE_DRIVE_ROSTER_FOLDER_ID=     # SEPARATE folder for family-facing Family Camp rosters
GOOGLE_SERVICE_ACCOUNT_KEY_FILE=/config/google_sheets.json
```

The roster export refuses to run when `GOOGLE_DRIVE_ROSTER_FOLDER_ID` is blank, and never falls back to `GOOGLE_DRIVE_FOLDER_ID`. Roster workbooks carry family contact details, and Drive folder sharing is their privacy control. The setup steps are in `.env.example`.

### Feedback Intake (Optional)
```bash
# Fine-grained PAT scoped to the feedback repo
GITHUB_FEEDBACK_TOKEN=
GITHUB_FEEDBACK_REPO=
```

### Authentication Configuration
```bash
# production: validate JWTs from the OIDC provider
# bypass: always DevAdmin (development only; refused inside Docker unless explicitly permitted)
AUTH_MODE=production

# Users in this OIDC group get is_admin=true. Read by PocketBase.
ADMIN_GROUP_NAME=admin

# Comma-separated CORS origins for FastAPI (no wildcards in production)
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
```

`ALLOWED_ORIGINS_REGEX` is the pipe-separated, regex-escaped form Caddy uses for its own CORS matcher. Empty means CORS is off in Caddy. List explicit origins only: Caddy pairs `Allow-Credentials: true` with the reflected origin on a match, so a catch-all pattern would be a CORS vulnerability.

There is no session-secret or session-timeout variable: PocketBase issues and expires the auth tokens.

### OAuth2/OIDC Configuration
```bash
OIDC_ISSUER=https://auth.provider.com
OIDC_CLIENT_ID=your-oauth-client-id
OIDC_CLIENT_SECRET=your-oauth-secret
```

Only the issuer is needed. The init container (`docker/init-entrypoint.sh`) and the dev script (`scripts/setup/configure_pocketbase_oauth.py`) discover the authorize, token and userinfo endpoints from `{OIDC_ISSUER}/.well-known/openid-configuration`, then register them with PocketBase. There are no `OIDC_AUTH_URL`, `OIDC_TOKEN_URL` or `OIDC_USER_URL` settings; those names are only local variables inside those two scripts. The registered scopes are `openid`, `email`, `profile` and `groups` (set in `init-entrypoint.sh`, not configurable). PocketBase also verifies back-channel logout tokens against `OIDC_ISSUER`, and the logout endpoint answers 404 while it is unset.

**PKCE posture:** The OIDC client is registered as **confidential + PKCE**.
PocketBase v0.23+ supports PKCE on OAuth2 providers via the `pkce: true` field on
the provider config. This repo enables it in both client-registration paths:

- `docker/init-entrypoint.sh` (production init container)
- `scripts/setup/configure_pocketbase_oauth.py` (dev script run by `start_dev.sh`)

The IDP (Pocket ID, Authentik, Auth0, etc.) must also enforce PKCE on the client.
Confidential + PKCE is the recommended posture for server-side apps: the client
secret is never exposed to the browser, and PKCE adds protection against
authorization-code interception.

### Network & Deployment Configuration
```bash
# Docker deployment (docker-compose.yml)
IMAGE_TAG=latest
PROXY_NETWORK=web-proxy
APPDATA_DIR=/path/to/appdata
DOMAIN_NAME=yourdomain.com
SUB_BUNKING=bunking

# Timezone for the sync scheduler
TZ=America/Los_Angeles

# PocketBase admin UI IP allowlist (Caddy /_/* gate)
# REQUIRED. Space-separated CIDRs. No default — Caddy fails closed (403) and
# compose refuses to start if unset, so a missing/malformed value can't
# silently disable the gate. Use "0.0.0.0/0 ::/0" to explicitly opt into
# "open to all". Set to home/VPN ranges to restrict admin UI access without
# affecting user OAuth login (Caddy rewrites the OAuth completion redirect
# from /_/#/auth/oauth2-redirect-success to the kindred-served
# /oauth2-complete.html, so /_/* is no longer in the user login path).
#
# QUOTE THE VALUE: shell sources .env with `set -a`; an unquoted space breaks
# the parse and the second CIDR is interpreted as a command (silent gate
# bypass). Always quote.
ADMIN_ALLOWLIST="10.0.0.0/8 192.168.0.0/16"
```

`POCKETBASE_HOST` and `API_HOST` rename the backends Caddy proxies to (`docker/Caddyfile`); change them only if you rename containers. The backend ports are fixed there (8090 and 8000). The dev scripts read `FASTAPI_PORT` for the API's port, and `API_PORT` is read by nothing. For development, the Vite proxy reads `CADDY_PORT` and `POCKETBASE_PORT` (see [Frontend Configuration](#frontend-configuration)).

### Logging & Solver Workers
```bash
# Log levels: TRACE, DEBUG, INFO (default)
# TRACE: Very verbose low-level diagnostics (API params, SDK internals)
# DEBUG: Detailed diagnostics (AI prompts, resolution details)
# INFO:  Normal operation
LOG_LEVEL=INFO

# Compact format drops the app timestamp and source label (default: true; set false locally)
LOG_COMPACT=false

# OR-Tools parallel search workers (default 8)
SOLVER_NUM_WORKERS=8

# HTTP timeout, minutes, for the process-requests pipeline (default 120)
# PROCESS_REQUESTS_TIMEOUT_MINUTES=120
```

## Runtime Configuration (Database)

Runtime configuration is database-driven, not file-driven. Values live in the PocketBase `config` collection (created by `pb_migrations/1500000011_config.js`) and are grouped by `config_sections`. Admins edit them in **Manage > Config** (`/manage/config`, which redirects to `/manage/config/solver`).

Every valid key is declared in `CONFIG_SCHEMA` (`bunking/config/schema.py`) and read through `ConfigLoader` (`bunking/config/loader.py`). An unlisted key is rejected, and a required key missing from the database is an error: there are no hardcoded fallbacks for them.

The solver-facing keys include:

- `objective.source_multipliers.share_bunk_with`, `.do_not_share_with`, `.bunking_notes`, `.internal_notes`, `.socialize_preference`
- `objective.enable_first_boost`, `objective.mutual_request_boost`
- `constraint.age_spread.preferred_bonus`
- `constraint.level_progression.no_regression`, `constraint.level_progression.no_regression_penalty`
- `constraint.cabin_minimum_occupancy.penalty`
- `solver.auto_apply_enabled`, `solver.auto_apply_timeout`

Keep this list short; the full list, ranges, and the constants that are deliberately hardcoded (cabin capacity, grade and age spread caps) are in [Solver Configuration](../guides/solver-configuration.md) and `CONFIG_SCHEMA`.

## AI Configuration

There is no `config/ai_config.json`, and the `category='ai'` rows were dropped from the `config` table (`1500000109_drop_ai_configs.js`), because nothing read them. Today:

- **Provider, key and model** come from the environment: `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL` (see above).
- **Match and review thresholds** are the `CONFIDENCE_THRESHOLDS` constant in `bunking/sync/bunk_request_processor/core/constants.py` (for example `auto_accept` 0.95 and `resolved` 0.85). Changing one is a code change.
- **Name-resolution tuning** is the `smart_local_resolution.*` keys in the `config` table, shown under the Processing category in Manage > Config.

See `docs/architecture/bunk-request-pipeline.md` for how the pipeline uses them.

## Docker Configuration

Three compose files:

- `docker-compose.yml`: production. Four containers (pocketbase, init, api, caddy) from `ghcr.io/adamflagg/kindred-*:${IMAGE_TAG:-latest}` images; Caddy carries the Traefik labels and listens on 8080 behind the proxy network.
- `docker-compose.local.yml`: builds from the local Dockerfiles under `docker/` and publishes Caddy on port 8080. It defaults `AUTH_MODE` to `bypass` and leaves `CAMPMINDER_SEASON_ID` blank, so the season follows the Oct 15 rule.
- `docker-compose.ci.yml`: an override used with the production file in CI (`SKIP_CAMPMINDER=true`, `AUTH_MODE=bypass`, Caddy published on 8080).

```bash
# Production
docker compose up -d

# Local build
docker compose -f docker-compose.local.yml up -d --build

# CI-style
docker compose -f docker-compose.yml -f docker-compose.ci.yml up -d
```

`./scripts/local_docker_test.sh` builds, starts, tests and tears down the local stack. Deployment detail, including file permissions and the season override, is in [Docker Deployment](../guides/docker-deployment.md).

## Frontend Configuration

### Vite Configuration (frontend/vite.config.ts)

- The dev server listens on port 3000 and accepts external hosts (`host: true`).
- `/api` is proxied to Caddy at `http://127.0.0.1:${CADDY_PORT ?? 8080}`, which routes PocketBase paths to PocketBase and everything else to FastAPI. `/_` (the PocketBase admin UI) is proxied straight to `127.0.0.1:${POCKETBASE_PORT ?? 8090}`.
- Production builds split vendor code into named chunks (`vendor-react`, `vendor-query`, `vendor-dnd`, `vendor-graph`, `vendor-ui`) through `build.rolldownOptions`.
- Private overrides go in `frontend/vite.config.local.ts` (gitignored).
- `USE_DEFAULT_BRANDING=true` swaps in the generic branding instead of `config/branding.local.json`.
- `VITE_API_URL` and `VITE_POCKETBASE_URL` are no longer used.

### TypeScript Configuration (frontend/tsconfig.json)

Target and lib `ES2024`, bundler module resolution, `jsx: react-jsx`, the `@/*` alias for `./src/*`, and `strict` plus extra strictness flags (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature` and others). It is `noEmit`; Vite builds.

## Configuration Precedence

Each kind of value has one home, so there is little to override:

1. **Environment variables**: service wiring, secrets, the optional season pin. Set in `.env` and passed through compose.
2. **Database configuration** (`config` collection): runtime values, editable in Manage > Config.
3. **Code constants**: everything else, such as `bunking/solver/constants.py` and the AI thresholds.

Where a value has both an environment variable and a default (`LOG_LEVEL`, `CAMPMINDER_SEASON_ID`), the variable wins.

## Configuration Best Practices

1. **Never commit secrets**: use `.env`, or the private `kindred-local` repo for private config files.
2. **Document changes**: update this reference and `.env.example` when you add a variable.
3. **Do not add a knob nobody will tune**: prefer a constant. A new runtime key needs its schema entry, a seed migration, and a code read (see the solver guide).
4. **Quote values with spaces** in `.env` (`ADMIN_ALLOWLIST`).

## Troubleshooting Configuration

**A `.env` change did not take effect in Docker.** Run `docker compose up -d`, not `restart`.

**A config value is missing or rejected.** Check the key is in `CONFIG_SCHEMA` and seeded by a migration, then look at the row in Manage > Config.

**OAuth2 not working.** Check `OIDC_ISSUER`, `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET` are set, and that `{OIDC_ISSUER}/.well-known/openid-configuration` is reachable from the init container. `scripts/setup/configure_pocketbase_oauth.py` registers the provider in development.

More in [Troubleshooting](../guides/troubleshooting.md).

## Related Documentation

- [CLI Commands](./cli-commands.md) - Command-line tools
- [Solver Configuration](../guides/solver-configuration.md) - Runtime keys and hardcoded constants
- [Docker Deployment](../guides/docker-deployment.md) - Production configuration
- [Troubleshooting](../guides/troubleshooting.md) - Common issues and solutions
