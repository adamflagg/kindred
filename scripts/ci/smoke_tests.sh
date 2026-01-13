#!/bin/bash
# Production smoke tests for Kindred - quick health checks after deployment

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

echo "Running smoke tests..."
echo "====================="

FAILED=0

# 1. Check API health endpoint (via Caddy)
echo -n "API health check (Caddy)... "
if curl -f -s http://localhost:8080/api/health > /dev/null; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗${NC}"
    FAILED=1
fi

# 2. Check API docs
echo -n "API docs... "
if curl -f -s http://localhost:8080/api/docs > /dev/null; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗${NC}"
    FAILED=1
fi

# 3. Check PocketBase health (via Caddy)
echo -n "PocketBase health check... "
if curl -f -s http://localhost:8080/api/collections/_superusers > /dev/null 2>&1 || curl -f -s http://localhost:8090/api/health > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗${NC}"
    FAILED=1
fi

# 4. Check frontend
echo -n "Frontend health check... "
if curl -f -s http://localhost:8080/ > /dev/null; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗${NC}"
    FAILED=1
fi

# 5. Test basic API functionality
echo -n "API sessions endpoint... "
RESPONSE=$(curl -s -w "\n%{http_code}" http://localhost:8080/api/sessions || true)
HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "401" ]; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗ (HTTP $HTTP_CODE)${NC}"
    FAILED=1
fi

# 6. Check database connectivity
echo -n "Database connectivity... "
if docker exec kindred python -c "import os; from bunking.db import get_pb_client; pb = get_pb_client(); print('OK')" 2>/dev/null | grep -q "OK"; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗${NC}"
    FAILED=1
fi

# 7. Check memory usage
echo -n "Memory usage check... "
KINDRED_MEM=$(docker stats --no-stream --format "{{.MemUsage}}" kindred | cut -d'/' -f1 | tr -d ' ' | sed 's/MiB//' | sed 's/GiB/*1024/' | bc 2>/dev/null | cut -d'.' -f1)
if [ -n "$KINDRED_MEM" ] && [ "$KINDRED_MEM" -lt 500 ]; then
    echo -e "${GREEN}✓ (${KINDRED_MEM}MB)${NC}"
else
    echo -e "${RED}✗ (${KINDRED_MEM}MB - high usage!)${NC}"
    FAILED=1
fi

echo "====================="
if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}All smoke tests passed!${NC}"
    exit 0
else
    echo -e "${RED}Some smoke tests failed!${NC}"
    exit 1
fi
