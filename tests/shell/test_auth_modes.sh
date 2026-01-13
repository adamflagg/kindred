#!/bin/bash
# Test all authentication modes for the Camp Bunking system

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test results
PASSED=0
FAILED=0

log_success() {
    echo -e "${GREEN}✓ $1${NC}"
    ((PASSED++))
}

log_error() {
    echo -e "${RED}✗ $1${NC}"
    ((FAILED++))
}

log_info() {
    echo -e "${YELLOW}ℹ $1${NC}"
}

# Function to wait for service to be healthy
wait_for_service() {
    local service=$1
    local url=$2
    local max_attempts=30
    local attempt=1

    log_info "Waiting for $service to be healthy..."
    
    while [ $attempt -le $max_attempts ]; do
        if curl -f -s "$url" > /dev/null 2>&1; then
            log_success "$service is healthy"
            return 0
        fi
        echo -n "."
        sleep 2
        ((attempt++))
    done
    
    echo
    log_error "$service failed to become healthy after $max_attempts attempts"
    return 1
}

# Function to test API endpoint
test_endpoint() {
    local name=$1
    local url=$2
    local expected_status=$3
    local headers=$4
    
    if [ -n "$headers" ]; then
        response=$(curl -s -o /dev/null -w "%{http_code}" $headers "$url")
    else
        response=$(curl -s -o /dev/null -w "%{http_code}" "$url")
    fi
    
    if [ "$response" = "$expected_status" ]; then
        log_success "$name returned $response"
    else
        log_error "$name returned $response (expected $expected_status)"
    fi
}

# Function to cleanup containers
cleanup() {
    log_info "Cleaning up containers..."
    cd "$PROJECT_ROOT"
    docker compose -f docker compose.bypass.yml down -v 2>/dev/null || true
    docker compose down -v 2>/dev/null || true
}

# Ensure cleanup on exit
trap cleanup EXIT

echo "========================================="
echo "Testing Authentication Modes"
echo "========================================="

# Test 1: Bypass Mode
echo
echo "Test 1: Bypass Mode"
echo "-----------------"

cd "$PROJECT_ROOT"
log_info "Starting services in bypass mode..."
docker compose -f docker compose.bypass.yml up -d

# Wait for services
wait_for_service "PocketBase" "http://localhost:8091/api/health"
wait_for_service "Solver API" "http://localhost:8001/health"

# Test endpoints
test_endpoint "Solver health check" "http://localhost:8001/health" "200"
test_endpoint "Solver docs" "http://localhost:8001/docs" "200"
test_endpoint "Auth status" "http://localhost:8001/api/auth/me" "200"

# Test solver API with bypass auth
log_info "Testing solver operation in bypass mode..."
response=$(curl -s "http://localhost:8001/api/auth/me")
if echo "$response" | grep -q "DevAdmin"; then
    log_success "Bypass auth working - DevAdmin user active"
else
    log_error "Bypass auth not working correctly"
fi

# Cleanup bypass mode
docker compose -f docker compose.bypass.yml down

# Test 2: Production Mode (Simulated)
echo
echo "Test 2: Production Mode (Simulated OIDC)"
echo "---------------------------------------"

# Create test .env file for production mode
cat > "$PROJECT_ROOT/.env.test" << EOF
AUTH_MODE=production
OIDC_ENABLED=true
ADMIN_GROUP_NAME=admin
POCKETBASE_ADMIN_EMAIL=admin@camp.local
POCKETBASE_ADMIN_PASSWORD=campbunking123
EOF

log_info "Starting services in production mode..."
docker compose --env-file .env.test up -d

# Wait for services
wait_for_service "PocketBase" "http://localhost:8090/api/health"
wait_for_service "Solver API" "http://localhost:8000/health"

# Test without headers (should fail)
test_endpoint "Auth without headers" "http://localhost:8000/api/auth/me" "401"

# Test with OIDC headers
OIDC_HEADERS='-H "X-Forwarded-User: testuser" -H "X-Forwarded-Email: test@example.com" -H "X-Forwarded-Groups: users" -H "X-Forwarded-Name: Test User"'
test_endpoint "Auth with user headers" "http://localhost:8000/api/auth/me" "200" "$OIDC_HEADERS"

# Test admin access
ADMIN_HEADERS=(
    -H "X-Forwarded-User: adminuser"
    -H "X-Forwarded-Email: admin@example.com"
    -H "X-Forwarded-Groups: admin,users"
    -H "X-Forwarded-Name: Admin User"
)
test_endpoint "Auth with admin headers" "http://localhost:8000/api/auth/me" "200" "${ADMIN_HEADERS[*]}"

# Test user info retrieval
log_info "Testing user info with production headers..."
response=$(curl -s "${ADMIN_HEADERS[@]}" "http://localhost:8000/api/auth/me")
if echo "$response" | grep -q "adminuser" && echo "$response" | grep -q '"is_admin":true'; then
    log_success "Production auth working - admin user recognized"
else
    log_error "Production auth not working correctly"
fi

# Cleanup
rm -f "$PROJECT_ROOT/.env.test"
docker compose down

# Summary
echo
echo "========================================="
echo "Test Summary"
echo "========================================="
echo -e "Passed: ${GREEN}$PASSED${NC}"
echo -e "Failed: ${RED}$FAILED${NC}"
echo

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}All authentication modes tested successfully!${NC}"
    exit 0
else
    echo -e "${RED}Some tests failed. Please check the output above.${NC}"
    exit 1
fi