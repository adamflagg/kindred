#!/bin/bash
# Run integration and E2E tests against real PocketBase
#
# WHEN TO RUN:
#   - Before deploying to production
#   - After changing core interfaces (DataAccessContext, repositories, orchestrator)
#   - After major refactors to data flow
#   - When interface contract tests pass but you suspect runtime issues
#
# REQUIRES:
#   - PocketBase running on localhost:8090
#   - Real data in the database
#
# Usage:
#   ./scripts/ci/run_integration_tests.sh

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Colors
# shellcheck source=../colors.sh
source "$PROJECT_ROOT/scripts/colors.sh"
cd "$PROJECT_ROOT"

# Verify uv is available (manages Python environment)
if ! command -v uv &> /dev/null; then
    echo -e "${RED}Error: uv not found!${NC}"
    echo "Please install uv first: https://docs.astral.sh/uv/getting-started/installation/"
    exit 1
fi

# Check PocketBase is running
echo "Checking PocketBase..."
if ! curl -s http://127.0.0.1:8090/api/health > /dev/null 2>&1; then
    echo -e "${RED}Error: PocketBase not running on localhost:8090${NC}"
    echo "Start it with: ./scripts/start_dev.sh"
    exit 1
fi
echo -e "${GREEN}PocketBase is running${NC}"

echo ""
echo "=================================="
echo "Running Integration Smoke Tests"
echo "=================================="
SKIP_POCKETBASE_TESTS=false uv run pytest tests/integration/ -v --tb=short

echo ""
echo "=================================="
echo "Running CLI E2E Tests"
echo "=================================="
SKIP_POCKETBASE_TESTS=false PYTHONPATH="$PROJECT_ROOT" uv run pytest tests/e2e/ -v --tb=short

echo ""
echo -e "${GREEN}=================================="
echo "All integration tests passed!"
echo "==================================${NC}"
