#!/bin/bash
# Local Docker Test - Quick pre-release verification
# Builds, starts, tests, and cleans up the Docker container
#
# Usage: ./scripts/local_docker_test.sh [--keep]
#   --keep: Don't tear down after tests (useful for debugging)
#
# Expected runtime: 3-5 minutes

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get project root
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

# Parse arguments
KEEP_RUNNING=false
if [[ "$1" == "--keep" ]]; then
    KEEP_RUNNING=true
fi

# Cleanup function
cleanup() {
    if [[ "$KEEP_RUNNING" == "true" ]]; then
        echo -e "${YELLOW}Container kept running (--keep flag)${NC}"
        echo "To stop: docker compose -f docker-compose.local.yml down -v"
    else
        echo -e "${BLUE}Cleaning up...${NC}"
        docker compose -f docker-compose.local.yml down -v 2>/dev/null || true
    fi
}

# Always trap - cleanup function handles --keep logic
trap cleanup EXIT

# Timing
START_TIME=$(date +%s)

echo "Local Docker Test"
echo "======================================="
echo "Started at: $(date)"
echo ""

# Track failures
FAILED=0

# Step 1: Build
echo -e "${BLUE}Step 1: Building Docker image...${NC}"
echo "-----------------------------------"
if docker compose -f docker-compose.local.yml build; then
    echo -e "${GREEN}✓ Build successful${NC}"
else
    echo -e "${RED}✗ Build failed${NC}"
    exit 1
fi
echo ""

# Step 2: Start
echo -e "${BLUE}Step 2: Starting container...${NC}"
echo "-----------------------------------"
if docker compose -f docker-compose.local.yml up -d; then
    echo -e "${GREEN}✓ Container started${NC}"
else
    echo -e "${RED}✗ Failed to start container${NC}"
    exit 1
fi
echo ""

# Step 3: Wait for healthy
echo -e "${BLUE}Step 3: Waiting for container to be healthy...${NC}"
echo "-----------------------------------"
HEALTHY=false
for i in {1..60}; do
    if curl -sf http://localhost:8080/health > /dev/null 2>&1; then
        HEALTHY=true
        echo -e "${GREEN}✓ Container is healthy (${i}s)${NC}"
        break
    fi
    echo -n "."
    sleep 1
done
echo ""

if [[ "$HEALTHY" != "true" ]]; then
    echo -e "${RED}✗ Container failed to become healthy${NC}"
    echo "Container logs:"
    docker compose -f docker-compose.local.yml logs --tail=50
    exit 1
fi
echo ""

# Step 4: Run smoke tests
echo -e "${BLUE}Step 4: Running smoke tests...${NC}"
echo "-----------------------------------"
if ./scripts/ci/smoke_tests.sh; then
    echo -e "${GREEN}✓ Smoke tests passed${NC}"
else
    echo -e "${RED}✗ Smoke tests failed${NC}"
    FAILED=1
fi
echo ""

# Step 5: Additional health checks
echo -e "${BLUE}Step 5: Additional checks...${NC}"
echo "-----------------------------------"

# Check FastAPI health
echo -n "FastAPI health... "
if curl -sf http://localhost:8080/health > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗${NC}"
    FAILED=1
fi

# Check PocketBase
echo -n "PocketBase API... "
if curl -sf http://localhost:8080/api/collections/config/records > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗${NC}"
    FAILED=1
fi

# Check frontend
echo -n "Frontend... "
if curl -sf http://localhost:8080/ > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗${NC}"
    FAILED=1
fi

# Check image size
echo -n "Image size... "
KINDRED_SIZE=$(docker image inspect kindred:local --format='{{.Size}}' 2>/dev/null || echo 0)
KINDRED_MB=$((KINDRED_SIZE / 1048576))
if [ "$KINDRED_MB" -lt 1000 ]; then
    echo -e "${GREEN}✓ (${KINDRED_MB}MB)${NC}"
else
    echo -e "${YELLOW}⚠ (${KINDRED_MB}MB - large!)${NC}"
fi
echo ""

# Summary
END_TIME=$(date +%s)
TOTAL_TIME=$((END_TIME - START_TIME))
TOTAL_MINUTES=$((TOTAL_TIME / 60))
TOTAL_SECONDS=$((TOTAL_TIME % 60))

echo "======================================="
echo "Test Summary"
echo "======================================="
echo "Total time: ${TOTAL_MINUTES}m ${TOTAL_SECONDS}s"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}All tests passed!${NC}"
    echo "The Docker image is ready for deployment."
    exit 0
else
    echo -e "${RED}Some tests failed!${NC}"
    echo "Check the output above for details."
    exit 1
fi
