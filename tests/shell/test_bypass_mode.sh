#!/bin/bash
# Test bypass authentication mode

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$PROJECT_ROOT"

echo "Testing Bypass Mode Authentication"
echo "=================================="

# Cleanup any existing containers
echo "Cleaning up existing containers..."
docker compose -f docker-compose.bypass.yml down -v 2>/dev/null || true

# Start services
echo "Starting services in bypass mode..."
docker compose -f docker-compose.bypass.yml up -d

# Wait for services to be ready
echo "Waiting for services to start..."
sleep 10

# Check PocketBase
echo -n "Checking PocketBase health... "
if curl -f -s "http://localhost:8091/api/health" > /dev/null; then
    echo "✓ OK"
else
    echo "✗ FAILED"
    docker compose -f docker-compose.bypass.yml logs pocketbase
    exit 1
fi

# Check Solver API
echo -n "Checking Solver API health... "
if curl -f -s "http://localhost:8001/health" > /dev/null; then
    echo "✓ OK"
else
    echo "✗ FAILED"
    docker compose -f docker-compose.bypass.yml logs solver
    exit 1
fi

# Test auth endpoint
echo -n "Testing auth endpoint... "
response=$(curl -s "http://localhost:8001/api/user/me")
if echo "$response" | grep -q "DevAdmin"; then
    echo "✓ DevAdmin user active"
    echo "Response: $response"
else
    echo "✗ Auth not working"
    echo "Response: $response"
    exit 1
fi

# Test solver docs
echo -n "Testing API docs access... "
if curl -f -s "http://localhost:8001/docs" > /dev/null; then
    echo "✓ OK"
else
    echo "✗ FAILED"
fi

echo
echo "Bypass mode test completed successfully!"
echo

# Show running containers
echo "Running containers:"
docker compose -f docker-compose.bypass.yml ps

echo
echo "To stop services: docker compose -f docker-compose.bypass.yml down"