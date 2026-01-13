#!/bin/bash
# Test production authentication mode with simulated OIDC headers

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$PROJECT_ROOT"

echo "Testing Production Mode Authentication (Simulated OIDC)"
echo "====================================================="

# Create test environment file
cat > .env.test << EOF
AUTH_MODE=production
OIDC_ENABLED=true
ADMIN_GROUP_NAME=admin
POCKETBASE_ADMIN_EMAIL=admin@camp.local
POCKETBASE_ADMIN_PASSWORD=campbunking123
POCKETBASE_URL=http://bunking-pocketbase:8090
EOF

# Cleanup any existing containers
echo "Cleaning up existing containers..."
docker compose -f docker-compose.production-test.yml --env-file .env.test down -v 2>/dev/null || true

# Start services
echo "Starting services in production mode..."
docker compose -f docker-compose.production-test.yml --env-file .env.test up -d

# Wait for services to be ready
echo "Waiting for services to start..."
sleep 15

# Check PocketBase
echo -n "Checking PocketBase health... "
if curl -f -s "http://localhost:8093/api/health" > /dev/null; then
    echo "✓ OK"
else
    echo "✗ FAILED"
    docker compose -f docker-compose.production-test.yml --env-file .env.test logs bunking-pocketbase
    exit 1
fi

# Check Solver API
echo -n "Checking Solver API health... "
if curl -f -s "http://localhost:8003/health" > /dev/null; then
    echo "✓ OK"
else
    echo "✗ FAILED"
    docker compose -f docker-compose.production-test.yml --env-file .env.test logs bunking-solver
    exit 1
fi

# Test without headers (should fail)
echo -n "Testing auth without headers... "
response_code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:8003/api/user/me")
if [ "$response_code" = "401" ]; then
    echo "✓ 401 Unauthorized (as expected)"
else
    echo "✗ Unexpected status code: $response_code"
fi

# Test with regular user headers
echo -n "Testing auth with user headers... "
response=$(curl -s \
    -H "X-Forwarded-User: testuser" \
    -H "X-Forwarded-Email: test@example.com" \
    -H "X-Forwarded-Groups: users" \
    -H "X-Forwarded-Name: Test User" \
    "http://localhost:8003/api/user/me")
    
if echo "$response" | grep -q "testuser"; then
    echo "✓ User authenticated"
    echo "Response: $response"
else
    echo "✗ Auth failed"
    echo "Response: $response"
fi

# Test with admin headers
echo -n "Testing auth with admin headers... "
admin_response=$(curl -s \
    -H "X-Forwarded-User: adminuser" \
    -H "X-Forwarded-Email: admin@example.com" \
    -H "X-Forwarded-Groups: admin,users" \
    -H "X-Forwarded-Name: Admin User" \
    "http://localhost:8003/api/user/me")
    
if echo "$admin_response" | grep -q '"is_admin":true'; then
    echo "✓ Admin authenticated"
else
    echo "✗ Admin auth failed"
    echo "Response: $admin_response"
fi

# Test admin endpoint access with admin headers
echo -n "Testing admin endpoint with admin headers... "
admin_endpoint=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "X-Forwarded-User: adminuser" \
    -H "X-Forwarded-Email: admin@example.com" \
    -H "X-Forwarded-Groups: admin,users" \
    "http://localhost:8003/admin/settings")
    
if [ "$admin_endpoint" = "200" ] || [ "$admin_endpoint" = "404" ]; then
    echo "✓ Admin access allowed"
else
    echo "✗ Unexpected status: $admin_endpoint"
fi

# Test admin endpoint access with regular user headers (should fail)
echo -n "Testing admin endpoint with user headers... "
user_admin=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "X-Forwarded-User: testuser" \
    -H "X-Forwarded-Email: test@example.com" \
    -H "X-Forwarded-Groups: users" \
    "http://localhost:8003/admin/settings")
    
if [ "$user_admin" = "403" ]; then
    echo "✓ Admin access denied (as expected)"
else
    echo "✗ Unexpected status: $user_admin"
fi

echo
echo "Production mode test completed!"
echo

# Show running containers
echo "Running containers:"
docker compose -f docker-compose.production-test.yml --env-file .env.test ps

# Cleanup
echo
echo "Cleaning up..."
docker compose -f docker-compose.production-test.yml --env-file .env.test down
rm -f .env.test

echo "Test completed."