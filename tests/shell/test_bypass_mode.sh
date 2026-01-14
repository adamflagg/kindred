#!/bin/bash
# Test bypass authentication mode using docker-compose.local.yml
# The local compose file already has AUTH_MODE=bypass as default

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$PROJECT_ROOT"

echo "Testing Bypass Mode Authentication"
echo "=================================="

# Cleanup any existing containers
echo "Cleaning up existing containers..."
docker compose -f docker-compose.local.yml down -v 2>/dev/null || true

# Start services (AUTH_MODE defaults to bypass in docker-compose.local.yml)
echo "Starting services in bypass mode..."
docker compose -f docker-compose.local.yml up -d

# Wait for services to be ready using health check
echo "Waiting for services to start..."
for i in {1..30}; do
    if curl -f -s "http://localhost:8080/health" > /dev/null 2>&1; then
        echo ""
        echo "Services ready!"
        break
    fi
    echo -n "."
    sleep 2
done

# Check unified container health (Caddy at 8080)
echo -n "Checking container health... "
if curl -f -s "http://localhost:8080/health" > /dev/null; then
    echo "✓ OK"
else
    echo "✗ FAILED"
    docker compose -f docker-compose.local.yml logs kindred
    exit 1
fi

# Check PocketBase through Caddy
echo -n "Checking PocketBase health... "
if curl -f -s "http://localhost:8080/api/health" > /dev/null; then
    echo "✓ OK"
else
    echo "✗ FAILED"
    docker compose -f docker-compose.local.yml logs kindred
    exit 1
fi

# Check Solver API through Caddy
echo -n "Checking Solver API health... "
if curl -f -s "http://localhost:8080/api/solver/health" > /dev/null; then
    echo "✓ OK"
else
    echo "✗ FAILED"
    docker compose -f docker-compose.local.yml logs kindred
    exit 1
fi

# Test auth endpoint (bypass mode should return bypass user)
echo -n "Testing auth endpoint... "
response=$(curl -s "http://localhost:8080/api/user/me")
if echo "$response" | grep -qi "bypass"; then
    echo "✓ Bypass user active"
    echo "Response: $response"
else
    echo "✗ Auth not working (expected bypass user in bypass mode)"
    echo "Response: $response"
    exit 1
fi

# Test solver docs
echo -n "Testing API docs access... "
if curl -f -s "http://localhost:8080/api/docs" > /dev/null; then
    echo "✓ OK"
else
    echo "✗ FAILED (docs may not be enabled in production mode)"
fi

echo
echo "Bypass mode test completed successfully!"
echo

# Show running containers
echo "Running containers:"
docker compose -f docker-compose.local.yml ps

echo
echo "To stop services: docker compose -f docker-compose.local.yml down"