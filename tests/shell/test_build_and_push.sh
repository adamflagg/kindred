#!/bin/bash
# TDD Tests for build_and_push.sh
# These tests verify the script uses correct Dockerfile and image names

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BUILD_SCRIPT="$PROJECT_ROOT/scripts/docker/build_and_push.sh"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Test results
PASSED=0
FAILED=0

log_success() {
    echo -e "${GREEN}✓ $1${NC}"
    ((PASSED++)) || true
}

log_error() {
    echo -e "${RED}✗ $1${NC}"
    ((FAILED++)) || true
}

log_info() {
    echo -e "${YELLOW}ℹ $1${NC}"
}

echo "========================================="
echo "Testing build_and_push.sh"
echo "========================================="

# Test 1: Script should reference Dockerfile (not Dockerfile.api or Dockerfile.caddy)
echo
echo "Test 1: Dockerfile references"
echo "-----------------------------"

if grep -q "Dockerfile\.api" "$BUILD_SCRIPT"; then
    log_error "Script references Dockerfile.api (should use Dockerfile)"
else
    log_success "Script does not reference Dockerfile.api"
fi

if grep -q "Dockerfile\.caddy" "$BUILD_SCRIPT"; then
    log_error "Script references Dockerfile.caddy (should use Dockerfile)"
else
    log_success "Script does not reference Dockerfile.caddy"
fi

if grep -q '\-f Dockerfile ' "$BUILD_SCRIPT" || grep -q '\-f Dockerfile$' "$BUILD_SCRIPT"; then
    log_success "Script uses -f Dockerfile"
else
    log_error "Script should use -f Dockerfile for build"
fi

# Test 2: Script should build 'bunking' image (not bunking-api or bunking-caddy)
echo
echo "Test 2: Image name references"
echo "-----------------------------"

if grep -q "bunking-api" "$BUILD_SCRIPT"; then
    log_error "Script references bunking-api (should use bunking)"
else
    log_success "Script does not reference bunking-api"
fi

if grep -q "bunking-caddy" "$BUILD_SCRIPT"; then
    log_error "Script references bunking-caddy (should use bunking)"
else
    log_success "Script does not reference bunking-caddy"
fi

if grep -q '/bunking:' "$BUILD_SCRIPT"; then
    log_success "Script references bunking image"
else
    log_error "Script should reference /bunking: image name"
fi

# Test 3: Script should support semver tags
echo
echo "Test 3: Semver tag support"
echo "--------------------------"

# Check for semver pattern handling (stripping v prefix)
if grep -qE '\$\{.*#v\}|\$\{.*%v\}|#v\}|v\$' "$BUILD_SCRIPT" || grep -q 'strip.*v' "$BUILD_SCRIPT" || grep -qE "sed.*'s/^v//'" "$BUILD_SCRIPT"; then
    log_success "Script handles v prefix stripping for semver"
else
    log_error "Script should strip v prefix from semver tags (v0.7.0 -> 0.7.0)"
fi

# Check for minor version tag support (0.7 from 0.7.0)
if grep -qE 'cut.*-f1-2|MINOR.*TAG|minor.*tag' "$BUILD_SCRIPT"; then
    log_success "Script supports minor version tags"
else
    log_error "Script should create minor version tags (0.7 from 0.7.0)"
fi

# Test 4: Script should have --build-only option
echo
echo "Test 4: Build-only option"
echo "-------------------------"

if grep -q '\-\-build-only' "$BUILD_SCRIPT"; then
    log_success "Script supports --build-only flag"
else
    log_error "Script should support --build-only flag"
fi

# Test 5: Script should push to ghcr.io/adamflagg/kindred
echo
echo "Test 5: Registry configuration"
echo "------------------------------"

if grep -q 'ghcr.io' "$BUILD_SCRIPT"; then
    log_success "Script uses ghcr.io registry"
else
    log_error "Script should use ghcr.io registry"
fi

if grep -q 'adamflagg' "$BUILD_SCRIPT"; then
    log_success "Script uses adamflagg username"
else
    log_error "Script should use adamflagg username"
fi

# Summary
echo
echo "========================================="
echo "Test Summary"
echo "========================================="
echo -e "Passed: ${GREEN}$PASSED${NC}"
echo -e "Failed: ${RED}$FAILED${NC}"
echo

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}All build_and_push.sh tests passed!${NC}"
    exit 0
else
    echo -e "${RED}Some tests failed. Script needs to be fixed.${NC}"
    exit 1
fi
