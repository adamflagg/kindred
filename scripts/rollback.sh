#!/bin/bash
# Emergency rollback script for Kindred
# Usage: ./scripts/rollback.sh [version]
# If no version specified, rolls back to previous version

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

REGISTRY="ghcr.io"
USERNAME="adamflagg"

echo -e "${YELLOW}Emergency Rollback${NC}"
echo "===================="
echo ""

# Get version to rollback to
if [ -n "$1" ]; then
    # Version specified - this is the version we're rolling back FROM
    CURRENT_VERSION=$1
    echo "Rolling back from version: $CURRENT_VERSION"

    # Find the previous version
    PREVIOUS_VERSION=$(docker image ls | grep "$REGISTRY/$USERNAME/kindred" | grep -v "$CURRENT_VERSION" | grep -v "latest" | head -1 | awk '{print $2}')
else
    # No version specified - use last deployed version
    if [ -f ".last_deployed_version" ]; then
        PREVIOUS_VERSION=$(cat .last_deployed_version)
        echo "Rolling back to last deployed version: $PREVIOUS_VERSION"
    else
        echo -e "${RED}Error: No version specified and no .last_deployed_version file found${NC}"
        echo "Usage: $0 [version-to-rollback-from]"
        exit 1
    fi
fi

if [ -z "$PREVIOUS_VERSION" ] || [ "$PREVIOUS_VERSION" == "latest" ]; then
    echo -e "${RED}Error: No previous version found to rollback to${NC}"
    exit 1
fi

echo -e "${BLUE}Rolling back to version: $PREVIOUS_VERSION${NC}"
echo ""

# 1. Stop current containers
echo "Stopping current containers..."
docker compose down --remove-orphans

# 2. Retag image to latest
echo "Retagging image..."
docker tag "$REGISTRY/$USERNAME/kindred:$PREVIOUS_VERSION" "$REGISTRY/$USERNAME/kindred:latest" || {
    echo -e "${RED}Error: Version $PREVIOUS_VERSION not found${NC}"
    exit 1
}

# 3. Start services with previous version
echo "Starting services with previous version..."
docker compose up -d

# 4. Wait for services to be healthy
echo "Waiting for services to be healthy..."
sleep 15

# 5. Check health
HEALTHY=true

echo -n "Checking Caddy/API health... "
if curl -f -s http://localhost:8080/api/health > /dev/null; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗${NC}"
    HEALTHY=false
fi

echo -n "Checking PocketBase health... "
if curl -f -s http://localhost:8080/api/collections/_superusers > /dev/null 2>&1 || curl -f -s http://localhost:8090/api/health > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗${NC}"
    HEALTHY=false
fi

# 6. Update last deployed version
if [ "$HEALTHY" = true ]; then
    echo "$PREVIOUS_VERSION" > .last_deployed_version

    echo ""
    echo "===================="
    echo -e "${GREEN}Rollback successful!${NC}"
    echo "Now running version: $PREVIOUS_VERSION"
    echo ""
else
    echo ""
    echo "===================="
    echo -e "${RED}Rollback completed but some services are unhealthy${NC}"
    echo "Please check the logs:"
    echo "  docker compose logs"
    echo ""
    exit 1
fi
