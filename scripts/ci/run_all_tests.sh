#!/bin/bash
# Comprehensive test suite for Kindred - runs all tests in stages
# Expected runtime: 15-20 minutes

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get project root
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$PROJECT_ROOT"

# Verify uv is available (manages Python environment)
if ! command -v uv &> /dev/null; then
    echo -e "${RED}Error: uv not found!${NC}"
    echo "Please install uv first: https://docs.astral.sh/uv/getting-started/installation/"
    exit 1
fi

# Timing
START_TIME=$(date +%s)

echo "Kindred Comprehensive Test Suite"
echo "======================================="
echo "Started at: $(date)"
echo ""

# Track failures
FAILED_STAGES=()

# Function to run a stage
run_stage() {
    local stage_name=$1
    local stage_cmd=$2

    echo -e "${BLUE}Stage: $stage_name${NC}"
    echo "-----------------------------------"

    local stage_start
    stage_start=$(date +%s)

    if eval "$stage_cmd"; then
        local stage_end
        stage_end=$(date +%s)
        local stage_duration=$((stage_end - stage_start))
        echo -e "${GREEN}✓ $stage_name completed in ${stage_duration}s${NC}"
    else
        FAILED_STAGES+=("$stage_name")
        echo -e "${RED}✗ $stage_name failed${NC}"
    fi
    echo ""
}

# Stage 1: Lint & Format (30s)
stage1_cmd() {
    echo "Checking Python formatting..."
    uv run ruff format --check . || return 1

    echo "Running Python linting..."
    uv run ruff check . || return 1

    echo "Running TypeScript checks..."
    (cd frontend && npm run type-check && npm run lint) || return 1

    echo "Running Go checks..."
    (cd pocketbase && go vet ./... && go build -o /dev/null ./...) || return 1

    echo "Checking Dockerfile syntax..."
    if command -v hadolint &> /dev/null; then
        hadolint Dockerfile || true  # Warning only
    else
        echo "hadolint not installed, skipping Dockerfile linting"
    fi

    return 0
}

# Stage 2: Unit Tests (2-3 min)
stage2_cmd() {
    echo "Running Python unit tests..."
    SKIP_POCKETBASE_TESTS=true \
        uv run pytest tests/unit/ -v --tb=short -q || return 1

    echo "Running Go unit tests..."
    (cd pocketbase && go test ./... -v) || return 1

    echo "Running frontend unit tests..."
    (cd frontend && npm run test -- --run) || return 1

    return 0
}

# Stage 3: Docker Tests (3-5 min)
stage3_cmd() {
    echo "Building Docker image..."

    # Build kindred (combined image)
    docker build -f Dockerfile -t kindred:test . || return 1
    echo "Kindred image built successfully"

    # Test that container starts
    echo "Testing container startup..."

    # Create test env file
    cat > .env.test << EOF
POCKETBASE_ADMIN_EMAIL=test@example.com
POCKETBASE_ADMIN_PASSWORD=testpassword123
SKIP_CAMPMINDER=true
AUTH_MODE=bypass
EOF

    # Start and stop quickly to verify it works
    docker compose -f docker-compose.yml --env-file .env.test up -d || return 1
    sleep 15

    # Check health
    curl -f http://localhost:8080/api/health || return 1

    docker compose down -v || return 1
    rm -f .env.test

    return 0
}

# Stage 4: Integration Tests (5-10 min)
stage4_cmd() {
    echo "Starting full test stack..."

    # Create test env file
    cat > .env.test << EOF
POCKETBASE_ADMIN_EMAIL=test@example.com
POCKETBASE_ADMIN_PASSWORD=testpassword123
SKIP_CAMPMINDER=true
AUTH_MODE=bypass
EOF

    # Start services
    docker compose -f docker-compose.yml --env-file .env.test up -d || return 1

    # Wait for services
    echo "Waiting for services to be ready..."
    for i in {1..30}; do
        if curl -s http://localhost:8080/api/health > /dev/null; then
            echo "Services are ready!"
            break
        fi
        echo -n "."
        sleep 2
    done
    echo ""

    # Run integration tests
    echo "Running API integration tests..."
    uv run pytest tests/integration/ -v --tb=short || return 1

    # Test auth modes
    echo "Testing authentication modes..."
    if [ -f ./tests/shell/test_bypass_mode.sh ]; then
        ./tests/shell/test_bypass_mode.sh || return 1
    fi

    # Cleanup
    docker compose down -v || return 1
    rm -f .env.test

    return 0
}

# Stage 5: Performance Tests (2-3 min)
stage5_cmd() {
    echo "Running performance benchmarks..."

    # Create test env file
    cat > .env.test << EOF
POCKETBASE_ADMIN_EMAIL=test@example.com
POCKETBASE_ADMIN_PASSWORD=testpassword123
SKIP_CAMPMINDER=true
AUTH_MODE=bypass
EOF

    # Start services
    docker compose -f docker-compose.yml --env-file .env.test up -d || return 1
    sleep 20

    # Run performance tests
    echo "Testing API response times..."
    if [ -f tests/performance/quick_load_test.py ]; then
        uv run python tests/performance/quick_load_test.py || return 1
    fi

    # Check image sizes
    echo "Checking Docker image sizes..."
    KINDRED_SIZE=$(docker image inspect kindred:test --format='{{.Size}}' 2>/dev/null || echo 0)

    KINDRED_MB=$((KINDRED_SIZE / 1048576))

    echo "Kindred image: ${KINDRED_MB}MB"

    if [ "$KINDRED_MB" -gt 1000 ]; then
        echo -e "${YELLOW}Warning: Kindred image is larger than 1GB${NC}"
    fi

    # Cleanup
    docker compose down -v || return 1
    rm -f .env.test

    return 0
}

# Run all stages
run_stage "1: Lint & Format" stage1_cmd
run_stage "2: Unit Tests" stage2_cmd
run_stage "3: Docker Tests" stage3_cmd
run_stage "4: Integration Tests" stage4_cmd
run_stage "5: Performance Tests" stage5_cmd

# Summary
END_TIME=$(date +%s)
TOTAL_TIME=$((END_TIME - START_TIME))
TOTAL_MINUTES=$((TOTAL_TIME / 60))
TOTAL_SECONDS=$((TOTAL_TIME % 60))

echo "======================================="
echo "Test Suite Summary"
echo "======================================="
echo "Total time: ${TOTAL_MINUTES}m ${TOTAL_SECONDS}s"
echo ""

if [ ${#FAILED_STAGES[@]} -eq 0 ]; then
    echo -e "${GREEN}All tests passed!${NC}"
    echo "The code is ready for deployment."
    exit 0
else
    echo -e "${RED}Failed stages:${NC}"
    for stage in "${FAILED_STAGES[@]}"; do
        echo "  - $stage"
    done
    echo ""
    echo "Please fix the issues before deploying."
    exit 1
fi
