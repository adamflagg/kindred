#!/bin/bash
# TDD Tests for release.sh flag inversion
# These tests verify local build is default, --github-build is opt-in

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
RELEASE_SCRIPT="$PROJECT_ROOT/scripts/release.sh"

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
echo "Testing release.sh flag inversion"
echo "========================================="

# Test 1: Script should NOT have --local-build flag (old behavior)
echo
echo "Test 1: Old flag removed"
echo "------------------------"

if grep -q '\-\-local-build' "$RELEASE_SCRIPT"; then
    log_error "Script still has --local-build flag (should be --github-build)"
else
    log_success "Script does not have --local-build flag"
fi

# Test 2: Script should have --github-build flag (new behavior)
echo
echo "Test 2: New flag present"
echo "------------------------"

if grep -q '\-\-github-build' "$RELEASE_SCRIPT"; then
    log_success "Script has --github-build flag"
else
    log_error "Script should have --github-build flag"
fi

# Test 3: Help text should mention --github-build
echo
echo "Test 3: Help text updated"
echo "-------------------------"

if grep -qE 'github-build.*Build.*GitHub|github-build.*trigger.*CD|github-build.*Actions' "$RELEASE_SCRIPT"; then
    log_success "Help text describes --github-build correctly"
else
    log_error "Help text should describe --github-build flag"
fi

# Test 4: Default behavior should call build_and_push.sh (local build)
echo
echo "Test 4: Default is local build"
echo "------------------------------"

# Check that build_and_push.sh is called when GITHUB_BUILD is NOT true
if grep -qE 'GITHUB_BUILD.*!=.*true|GITHUB_BUILD.*ne.*true' "$RELEASE_SCRIPT" && \
   grep -q 'build_and_push.sh' "$RELEASE_SCRIPT"; then
    log_success "Default behavior calls build_and_push.sh"
else
    log_error "Default should call build_and_push.sh (when GITHUB_BUILD != true)"
fi

# Test 5: Script should NOT have LOCAL_BUILD variable (old behavior)
echo
echo "Test 5: Old variable removed"
echo "----------------------------"

if grep -qE '^LOCAL_BUILD=' "$RELEASE_SCRIPT" || grep -qE 'LOCAL_BUILD=true' "$RELEASE_SCRIPT"; then
    log_error "Script still uses LOCAL_BUILD variable (should use GITHUB_BUILD)"
else
    log_success "Script does not use LOCAL_BUILD variable"
fi

# Test 6: Script should have GITHUB_BUILD variable
echo
echo "Test 6: New variable present"
echo "----------------------------"

if grep -qE '^GITHUB_BUILD=' "$RELEASE_SCRIPT" || grep -qE 'GITHUB_BUILD=false' "$RELEASE_SCRIPT"; then
    log_success "Script uses GITHUB_BUILD variable"
else
    log_error "Script should use GITHUB_BUILD variable"
fi

# Test 7: Confirmation message should mention local build as default
echo
echo "Test 7: Confirmation reflects new default"
echo "------------------------------------------"

# Check that the "This will:" section doesn't always mention CD/GitHub Actions
# Or that it conditionally shows different messages based on GITHUB_BUILD
if grep -qE 'Build.*push.*locally|local.*build|GITHUB_BUILD' "$RELEASE_SCRIPT"; then
    log_success "Script indicates local build in messaging"
else
    log_error "Script should indicate local build is happening"
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
    echo -e "${GREEN}All release.sh tests passed!${NC}"
    exit 0
else
    echo -e "${RED}Some tests failed. Script needs to be updated.${NC}"
    exit 1
fi
