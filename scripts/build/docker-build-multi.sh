#!/bin/bash
# Build all multi-container Docker images locally
#
# This script resolves symlinks (via docker-build.sh) for images that need
# kindred-local files (caddy needs local/assets for frontend), then builds
# all 4 container images.
#
# Usage: ./scripts/build/docker-build-multi.sh [--no-cache]

set -e
cd "$(dirname "$0")/../.."

NO_CACHE=""
if [ "${1:-}" = "--no-cache" ]; then
  NO_CACHE="--no-cache"
fi

echo "=== Building multi-container images ==="
echo ""

echo "--- kindred-pocketbase ---"
docker build $NO_CACHE -f docker/Dockerfile.pocketbase -t kindred-pocketbase:local .
echo ""

echo "--- kindred-api ---"
docker build $NO_CACHE -f docker/Dockerfile.api -t kindred-api:local .
echo ""

echo "--- kindred-init ---"
docker build $NO_CACHE -f docker/Dockerfile.init -t kindred-init:local .
echo ""

echo "--- kindred-caddy (with symlink resolution) ---"
./scripts/build/docker-build.sh $NO_CACHE -f docker/Dockerfile.caddy -t kindred-caddy:local .
echo ""

echo "=== All images built ==="
docker images --format "table {{.Repository}}:{{.Tag}}\t{{.Size}}" | grep kindred
