#!/bin/bash
# Safe production deployment script for Kindred
# Includes all safety checks and automatic rollback on failure

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

REGISTRY="ghcr.io"
USERNAME="adamflagg"

# Check if we're in the right directory
if [ ! -f "docker-compose.yml" ]; then
    echo -e "${RED}Error: docker-compose.yml not found. Are you in the project root?${NC}"
    exit 1
fi

echo -e "${BLUE}Kindred Production Deployment${NC}"
echo "===================================="
echo "Started at: $(date)"
echo ""

# 1. Check for uncommitted changes
echo -n "Checking for uncommitted changes... "
if [ -n "$(git status --porcelain)" ]; then
    echo -e "${RED}✗${NC}"
    echo "You have uncommitted changes. Please commit or stash them first."
    git status --short
    exit 1
else
    echo -e "${GREEN}✓${NC}"
fi

# 2. Run full test suite
echo ""
echo -e "${BLUE}Running full test suite...${NC}"
if ! ./scripts/ci/run_all_tests.sh; then
    echo -e "${RED}Tests failed! Aborting deployment.${NC}"
    exit 1
fi

# 3. Build production images
echo ""
echo -e "${BLUE}Building production images...${NC}"
docker compose build --no-cache || {
    echo -e "${RED}Build failed! Aborting deployment.${NC}"
    exit 1
}

# 4. Tag images with timestamp
VERSION=$(date +%Y%m%d-%H%M%S)
echo ""
echo -e "${BLUE}Tagging images with version: $VERSION${NC}"

docker tag "$REGISTRY/$USERNAME/kindred:latest" "$REGISTRY/$USERNAME/kindred:$VERSION"

# Save current version for rollback
echo "$VERSION" > .last_deployed_version

# 5. Create backup of current data
echo ""
echo -e "${BLUE}Creating backup of current data...${NC}"
./scripts/backup_production.sh || echo -e "${YELLOW}Warning: Backup failed, but continuing...${NC}"

# 6. Clear caches
echo ""
echo -e "${BLUE}Clearing caches...${NC}"

# Clear nginx cache if it exists
if [ -d "/var/cache/nginx" ]; then
    echo "Clearing nginx cache..."
    sudo rm -rf /var/cache/nginx/*
fi

echo -e "${GREEN}✓ Caches cleared${NC}"

# 7. Deploy with zero downtime
echo ""
echo -e "${BLUE}Deploying new version...${NC}"

# Deploy the kindred service
echo "Updating kindred service..."
docker compose up -d --no-deps kindred

echo "Waiting for kindred to be healthy..."
./scripts/wait_for_healthy.sh kindred 30 || {
    echo -e "${RED}Kindred failed to start! Rolling back...${NC}"
    ./scripts/rollback.sh "$VERSION"
    exit 1
}

# 8. Run production smoke tests
echo ""
echo -e "${BLUE}Running smoke tests...${NC}"
if ! ./scripts/ci/smoke_tests.sh; then
    echo -e "${RED}Smoke tests failed! Rolling back...${NC}"
    ./scripts/rollback.sh "$VERSION"
    exit 1
fi

# 9. Clean up old images (keep last 3 versions)
echo ""
echo -e "${BLUE}Cleaning up old images...${NC}"
docker image ls | grep "$REGISTRY/$USERNAME/kindred" | sort -k2 -r | tail -n +4 | awk '{print $1":"$2}' | xargs -r docker image rm || true

# Success!
echo ""
echo "===================================="
echo -e "${GREEN}Deployment successful!${NC}"
echo "Version: $VERSION"
echo "Time: $(date)"
echo ""
echo "To rollback if needed: ./scripts/rollback.sh"
echo ""
