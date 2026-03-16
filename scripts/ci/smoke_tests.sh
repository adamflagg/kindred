#!/bin/bash
# Production smoke tests for Kindred - quick health checks after deployment

set -e

# Colors for output
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../colors.sh
source "$SCRIPT_DIR/../colors.sh"

echo "Running smoke tests..."
echo "====================="

FAILED=0

# 1. Check API health endpoint (via Caddy)
echo -n "API health check (Caddy)... "
if curl -f -s http://localhost:8080/health > /dev/null; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗${NC}"
    FAILED=1
fi

# 2. Check PocketBase health (via Caddy)
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

# 6. Check database connectivity (via API endpoint that queries DB)
echo -n "Database connectivity... "
if curl -sf http://localhost:8080/api/collections/config/records > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗${NC}"
    FAILED=1
fi

# 7. Check memory usage (all containers in a single docker stats call)
echo "Memory usage check..."
TOTAL_MEM=0
while IFS= read -r line; do
    CONTAINER=$(echo "$line" | awk '{print $1}')
    MEM_RAW=$(echo "$line" | awk '{print $2}')
    if [[ "$MEM_RAW" == *"GiB"* ]]; then
        MEM=$(echo "$MEM_RAW" | sed 's/GiB//' | awk '{printf "%.0f", $1 * 1024}')
    elif [[ "$MEM_RAW" == *"MiB"* ]]; then
        MEM=$(echo "$MEM_RAW" | sed 's/MiB//' | awk '{printf "%.0f", $1}')
    else
        MEM=0
    fi
    echo -e "  ${CONTAINER}: ${MEM}MB"
    TOTAL_MEM=$((TOTAL_MEM + MEM))
done < <(docker stats --no-stream --format "{{.Name}} {{.MemUsage}}" kindred-pocketbase kindred-api kindred-caddy 2>/dev/null | sed 's|/.*||')

if [ "$TOTAL_MEM" -gt 0 ] && [ "$TOTAL_MEM" -lt 500 ]; then
    echo -e "${GREEN}✓ Total: ${TOTAL_MEM}MB${NC}"
elif [ "$TOTAL_MEM" -gt 0 ]; then
    echo -e "${RED}✗ Total: ${TOTAL_MEM}MB - high usage!${NC}"
    FAILED=1
else
    echo -e "${RED}✗ (could not determine)${NC}"
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
