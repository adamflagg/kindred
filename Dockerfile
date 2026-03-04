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
# Wildcard copies branding.json (default) + branding.local.json (camp-specific) when available
# For local builds: run scripts/build/docker-build.sh (resolves symlinks before build)
# For CI: workflow copies real files from kindred-local before build
COPY config/branding*.json ../config/
RUN npm run build

# =============================================================================
# Stage 2: Go build - compile custom PocketBase with sync service
# =============================================================================
FROM golang:1.26 AS go-builder

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

# Single system-setup layer: user, packages, directories, ownership
# hadolint ignore=DL3008
RUN groupadd -r -g 1000 kindred && useradd -r -g kindred -u 1000 kindred \
    && apt-get update && apt-get install -y --no-install-recommends \
       curl supervisor \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /pb_data/bunk_requests /app/logs /app/csv_history /config \
               /app/.config/caddy /app/.local/share/caddy \
               /pb_public /pb_hooks /pb_migrations \
    && chown -R kindred:kindred /pb_data /app /config /pb_public /pb_hooks /pb_migrations
WORKDIR /app

# Stable binaries (--link = content-addressable, survives across code-only releases)
COPY --link --from=python-builder /app/.venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH"
ENV VIRTUAL_ENV="/app/.venv"

COPY --link --from=caddy:2 --chmod=755 /usr/bin/caddy /usr/local/bin/caddy
COPY --link --from=go-builder --chmod=755 /build/pocketbase /usr/local/bin/pocketbase

# Docker infrastructure (no --link or --chmod for system dirs: --chmod applies to
# auto-created parent dirs too, making /etc/caddy/ untraversable with 644)
COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY docker/supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY --chmod=755 docker/combined-entrypoint.sh /entrypoint.sh

# Application source (changes frequently, each independently cached via --link)
COPY --link --chown=1000:1000 config/ ./config/
COPY --link --chown=1000:1000 campminder/ ./campminder/
COPY --link --chown=1000:1000 api/ ./api/
COPY --link --chown=1000:1000 bunking/ ./bunking/

# PocketBase assets
COPY --link --chown=1000:1000 pocketbase/pb_hooks /pb_hooks
COPY --link --chown=1000:1000 pocketbase/pb_migrations /pb_migrations

# Frontend + local assets
COPY --link --chown=1000:1000 --from=frontend-builder /app/dist /pb_public
COPY --link --chown=1000:1000 local/ /pb_public/local/

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
LABEL org.opencontainers.image.description="Kindred cabin assignment system"
LABEL org.opencontainers.image.vendor="Kindred"
LABEL org.opencontainers.image.version="${VERSION}"
LABEL org.opencontainers.image.created="${BUILD_DATE}"
LABEL org.opencontainers.image.source="https://github.com/adamflagg/kindred"

ENTRYPOINT ["/entrypoint.sh"]
