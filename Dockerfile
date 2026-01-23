# Build arguments (passed from CI/CD)
ARG VERSION=dev
ARG BUILD_DATE
ARG ADMIN_USER

# =============================================================================
# Stage 1: Frontend build
# =============================================================================
FROM node:25-alpine AS frontend-builder

# Pass version info to frontend build
ARG VERSION
ARG BUILD_DATE
ARG ADMIN_USER
ENV VITE_APP_VERSION=${VERSION}
ENV VITE_APP_BUILD_DATE=${BUILD_DATE}
ENV ADMIN_USER=${ADMIN_USER}

WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
# Copy branding config so Vite can inject it (vite.config.local.ts loads from ../config/)
# Uses wildcards to gracefully handle missing files (git-crypt locked or not present)
COPY config/branding*.json ../config/
RUN npm run build

# =============================================================================
# Stage 2: Go build - compile custom PocketBase with sync service
# =============================================================================
FROM golang:1.25 AS go-builder

# Using Debian-based image to match final python:3.13-slim (glibc compatibility)
# hadolint ignore=DL3008
RUN apt-get update && apt-get install -y --no-install-recommends git gcc && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY pocketbase/go.mod pocketbase/go.sum ./
RUN go mod download
COPY pocketbase/ ./

# CGO_ENABLED=1 required for SQLite support
# -ldflags="-s -w" strips debug info for smaller binary
RUN CGO_ENABLED=1 GOOS=linux go build -ldflags="-s -w" -o pocketbase .

# =============================================================================
# Stage 3: Python dependencies build (uv for fast, reproducible installs)
# =============================================================================
FROM python:3.14-slim AS python-builder

# Install uv (single static binary, ~15MB)
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Use cache mounts for apt - content excluded from layer hash for reproducibility
# hadolint ignore=DL3008
RUN --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    --mount=type=cache,target=/var/cache/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends gcc g++

WORKDIR /app

# Copy dependency files
COPY pyproject.toml uv.lock ./

# Install dependencies using uv (production only, no dev deps, no project install)
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project

# =============================================================================
# Stage 4: Final runtime image - Combined Caddy + PocketBase + FastAPI
# =============================================================================
FROM python:3.14-slim
# Use fixed UID/GID 1000 (standard first non-root user) for predictable volume permissions
# Can be overridden via docker-compose user: directive with PUID/PGID env vars
RUN groupadd -r -g 1000 kindred && useradd -r -g kindred -u 1000 kindred
WORKDIR /app
# hadolint ignore=DL3008
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    wget \
    supervisor \
    procps \
    && rm -rf /var/lib/apt/lists/*

# 1. PYTHON DEPS (copy venv from uv builder)
COPY --from=python-builder /app/.venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH"
ENV VIRTUAL_ENV="/app/.venv"

# 2. STABLE CONFIG
COPY --from=caddy:2 /usr/bin/caddy /usr/local/bin/caddy
COPY docker/Caddyfile /etc/caddy/Caddyfile
RUN chmod 644 /etc/caddy/Caddyfile && caddy validate --config /etc/caddy/Caddyfile
COPY --chown=kindred:kindred config/ ./config/
COPY --chown=kindred:kindred campminder/ ./campminder/
RUN mkdir -p /pb_data/bunk_requests /app/logs /app/csv_history /config

# 3. API + DOCKER
COPY --chown=kindred:kindred api/ ./api/
COPY docker/supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY docker/combined-entrypoint.sh /entrypoint.sh
RUN chmod 755 /entrypoint.sh

# 4. BUNKING
COPY --chown=kindred:kindred bunking/ ./bunking/

# 5. POCKETBASE
COPY --chown=kindred:kindred pocketbase/pb_hooks /pb_hooks
COPY --chown=kindred:kindred pocketbase/pb_migrations /pb_migrations
COPY --from=go-builder /build/pocketbase /usr/local/bin/pocketbase
RUN chmod +x /usr/local/bin/pocketbase

# 6. FRONTEND
COPY --chown=kindred:kindred --from=frontend-builder /app/dist /pb_public
# Copy local assets (logos) - CI ensures local/ exists (empty if not unlocked)
# See: .github/workflows/cd.yml "Prepare local assets" step
COPY --chown=kindred:kindred local/ /pb_public/local/

# Verify local assets aren't git-crypt encrypted (would start with "GITCRYPT" header)
# This catches builds where git-crypt wasn't unlocked before building
# hadolint ignore=DL4006
RUN for f in /pb_public/local/assets/*; do \
      [ -f "$f" ] && head -c 8 "$f" 2>/dev/null | grep -q "^.GITCRYPT" && \
        echo "ERROR: $f is git-crypt encrypted. Run 'git-crypt unlock' first." && exit 1; \
    done; true

# Create Caddy config/data directories and set ownership for writable directories
# (skip .venv - it's read-only)
RUN mkdir -p /app/.config/caddy /app/.local/share/caddy && \
    chown -R kindred:kindred /pb_data /app/logs /app/csv_history /app/.config /app/.local /config
USER kindred

EXPOSE 8080

ENV HOME=/app
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV IS_DOCKER=true
ENV POCKETBASE_URL=http://127.0.0.1:8090
ENV LOG_LEVEL=INFO
ENV TZ=UTC

HEALTHCHECK --interval=15s --timeout=10s --retries=5 --start-period=45s \
    CMD curl -f http://127.0.0.1:8080/health || exit 1

ARG VERSION=latest
ARG BUILD_DATE

LABEL org.opencontainers.image.title="Kindred"
LABEL org.opencontainers.image.description="Kindred cabin assignment system - Combined container (Caddy + PocketBase + FastAPI)"
LABEL org.opencontainers.image.vendor="Kindred"
LABEL org.opencontainers.image.version="${VERSION}"
LABEL org.opencontainers.image.created="${BUILD_DATE}"
LABEL org.opencontainers.image.source="https://github.com/adamflagg/kindred"

ENTRYPOINT ["/entrypoint.sh"]
